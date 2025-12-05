// app.js - Agenda Incubadora IFPR/PMP
// Versão corrigida: mantive sua lógica e corrigi dois problemas principais:
// 1) Removi o bloco "upload" que estava fora do escopo (usava fotosInput/idEvento fora do submit) — causava ReferenceError/execução indevida.
// 2) Adicionei a função convertDataUrlIfHeic(...) (necessária para exibição/PDF) e garanti fallback seguro.
// NÃO removi a lógica de redução/heic/renumeração/filtros/PDF — apenas corrigi o que quebrou a execução.
// Substitua totalmente o app.js pelo conteúdo abaixo.

document.addEventListener("DOMContentLoaded", async () => {
  // ========= INICIALIZAÇÃO jsPDF (mais robusto) =========
  const jsPDF =
    (window.jspdf && window.jspdf.jsPDF) || window.jsPDF || null;

  if (!jsPDF) {
    console.warn(
      "jsPDF não encontrado. Verifique se o script do jsPDF está incluído ANTES do app.js."
    );
  }

  // ========= Firestore =========
  if (typeof firebase === "undefined" || !firebase.firestore) {
    console.error(
      "Firebase Firestore não encontrado. Verifique se os scripts do Firebase foram incluídos corretamente."
    );
    // Não prossegue sem Firestore
    return;
  }

  const db = firebase.firestore();

  // ========= Logos para PDFs (carregadas da pasta raiz do projeto) =========
  const logoPmpImg = new Image();
  logoPmpImg.src = "PMP.png";
  const logoIfprImg = new Image();
  logoIfprImg.src = "IFPR.png";
  const logoSebraeImg = new Image();
  logoSebraeImg.src = "Sebrae.png";

  // ========= CONSTANTE DO CDN DO HEIC2ANY (ajustado) =========
  // Lista de fontes conhecidas do heic2any.
  // As três primeiras são CDN que realmente existem; a última é opcional/local.
  const HEIC2ANY_SOURCES = [
    // jsDelivr (versão 0.0.4 do heic2any original)
    "https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js",
    // unpkg (mesma versão)
    "https://unpkg.com/heic2any@0.0.4/dist/heic2any.min.js",
    // cdnjs (versão 0.0.1, também funcional)
    "https://cdnjs.cloudflare.com/ajax/libs/heic2any/0.0.1/index.min.js",
    // opcional: arquivo local se você quiser hospedar em /vendor
    "/vendor/heic2any.min.js"
  ];

  // Tenta extrair a função correta do objeto global (várias formas de export)
  function getHeic2anyFromGlobal() {
    const g = window.heic2any || window.__heic2anyFn;

    if (!g) return null;

    if (typeof g === "function") return g;
    if (g && typeof g.default === "function") return g.default;
    if (g && typeof g.heic2any === "function") return g.heic2any;

    return null;
  }

  function ensureHeic2any() {
    // 1) Já temos a função resolvida e cacheada
    if (window.__heic2anyFn && typeof window.__heic2anyFn === "function") {
      return Promise.resolve(window.__heic2anyFn);
    }

    // 2) Já existe algo no global (por script carregado antes)
    const existing = getHeic2anyFromGlobal();
    if (existing) {
      window.__heic2anyFn = existing;
      return Promise.resolve(existing);
    }

    // 3) Já existe um carregamento em andamento? reaproveita a mesma Promise
    if (window.__heic2anyLoading) {
      return window.__heic2anyLoading;
    }

    // 4) Inicia um novo processo de carregamento
    window.__heic2anyLoading = new Promise(async (resolve, reject) => {
      for (const src of HEIC2ANY_SOURCES) {
        try {
          // Se for caminho local ("/vendor/...") e o global já existir,
          // apenas reaproveita (não precisa injetar script de novo)
          if (src.startsWith("/") && getHeic2anyFromGlobal()) {
            const fnLocal = getHeic2anyFromGlobal();
            if (fnLocal) {
              window.__heic2anyFn = fnLocal;
              resolve(fnLocal);
              return;
            }
          }

          // Carrega o script dinamicamente
          await new Promise((res, rej) => {
            const s = document.createElement("script");
            s.src = src;
            s.async = true;
            s.onload = () => res();
            s.onerror = () => rej(new Error("Falha ao carregar " + src));
            document.head.appendChild(s);
          });

          // Depois de carregar, tenta extrair a função do global
          const fn = getHeic2anyFromGlobal();
          if (fn) {
            window.__heic2anyFn = fn;
            resolve(fn);
            return;
          } else {
            console.warn(
              "[heic2any] Script carregado mas não encontrei export válido em",
              src
            );
          }
        } catch (err) {
          console.warn(
            "[heic2any] Falha ao carregar de",
            src,
            "-",
            err && err.message ? err.message : err
          );
          // Continua para o próximo src
        }
      }

      // Se chegou aqui, nenhuma fonte funcionou
      delete window.__heic2anyLoading;
      reject(
        new Error("Nenhuma fonte heic2any disponível (CDNs e /vendor falharam)")
      );
    });

    return window.__heic2anyLoading;
  }

  // ---------- converter diretamente um File HEIC -> JPEG dataURL ----------
  async function convertHeicFileToJpegDataUrl(file, options = { quality: 0.9 }) {
    // returns dataURL string (image/jpeg) or "" on failure
    try {
      if (!file) return "";
      // if it's not HEIC just return normal dataURL
      const name = (file.name || "").toLowerCase();
      const isHeic =
        (file.type && file.type.toLowerCase().includes("heic")) ||
        name.endsWith(".heic") ||
        name.endsWith(".heif");
      if (!isHeic) {
        // fallback: read file to dataURL
        return await blobToDataURL(file);
      }

      // ensure converter
      const heic = await ensureHeic2any();
      if (!heic) throw new Error("heic2any indisponível");

      // convert to jpeg blob
      const converted = await heic({
        blob: file,
        toType: "image/jpeg",
        quality: options.quality || 0.9,
      });
      const jpegBlob =
        converted instanceof Blob
          ? converted
          : Array.isArray(converted)
          ? converted[0]
          : converted;
      if (!jpegBlob) throw new Error("heic2any retornou vazio");

      // return dataURL
      const dataUrl = await blobToDataURL(jpegBlob);
      return dataUrl;
    } catch (err) {
      console.warn(
        "convertHeicFileToJpegDataUrl falhou:",
        err && err.message ? err.message : err
      );
      return "";
    }
  }

  // ---------- Atualize fileToCompressedDataUrl para usar convertHeicFileToJpegDataUrl quando for HEIC ----------
  async function fileToCompressedDataUrl(
    file,
    maxWidth = 1280,
    maxHeight = 720,
    quality = 0.6
  ) {
    return new Promise(async (resolve, reject) => {
      const processDataUrl = async (dataUrl) => {
        const img = new Image();
        img.onload = () => {
          try {
            let { width, height } = img;
            const ratio = Math.min(maxWidth / width, maxHeight / height, 1);
            const targetWidth = Math.round(width * ratio);
            const targetHeight = Math.round(height * ratio);
            const canvas = document.createElement("canvas");
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
            const out = canvas.toDataURL("image/jpeg", quality);
            resolve(out);
          } catch (errCanvas) {
            console.warn("Erro ao desenhar no canvas:", errCanvas);
            resolve(dataUrl); // fallback para original
          }
        };
        img.onerror = (e) => {
          reject(new Error("Falha ao carregar imagem para redimensionar: " + e));
        };
        img.crossOrigin = "anonymous";
        img.src = dataUrl;
      };

      try {
        // If HEIC file, try to convert first to dataURL jpeg
        if (isHeicFile(file)) {
          const convertedDataUrl = await convertHeicFileToJpegDataUrl(file, {
            quality: 0.9,
          });
          if (!convertedDataUrl) {
            // conversion failed — return empty so caller uses fallback
            return resolve("");
          }
          // then resize the converted dataURL
          return processDataUrl(convertedDataUrl);
        }

        // not HEIC — just read and resize
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = () => processDataUrl(reader.result);
        reader.readAsDataURL(file);
      } catch (err) {
        reject(err);
      }
    });
  }

  // tentar pré-carregar não bloqueante (melhora chance de conversão)
  ensureHeic2any().catch((e) => {
    console.warn(
      "heic2any pré-load falhou:",
      e && e.message ? e.message : e
    );
  });

  // ========= Utilitários para conversão de dataURLs/blobs =========

  function dataURLtoBlob(dataurl) {
    // dataurl: "data:[<mediatype>][;base64],<data>"
    const parts = dataurl.split(",");
    if (parts.length !== 2) {
      throw new Error("dataURL inválida");
    }
    const meta = parts[0];
    const b64 = parts[1];
    const mimeMatch = meta.match(/data:(.*?)(;base64)?$/);
    const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
    const byteString = atob(b64);
    const ia = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ia], { type: mime });
  }

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  }

  function isDataUrlHeic(src) {
    if (!src || typeof src !== "string") return false;
    const s = src.toLowerCase();
    if (s.startsWith("data:")) {
      return (
        s.startsWith("data:image/heic") ||
        s.startsWith("data:image/heif") ||
        s.includes("heic")
      );
    }
    // also check if the url ends with .heic/.heif
    return s.endsWith(".heic") || s.endsWith(".heif");
  }

  // ========= NOVOS HELPERS PARA REDUÇÃO E SALVAMENTO SEGURO =========
  // Não removi nada antigo, apenas adicionei helpers com nomes compatíveis.

  function imageBlobToDataUrl(blob) {
    return blobToDataURL(blob);
  }

  function dataUrlByteSize(dataUrl) {
    if (!dataUrl) return 0;
    const idx = dataUrl.indexOf(",");
    if (idx === -1) return 0;
    const b64 = dataUrl.substring(idx + 1);
    return Math.ceil((b64.length * 3) / 4);
  }

  function resizeDataUrl(dataUrl, maxWidth, maxHeight, quality = 0.8) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const ratio = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
          const w = Math.max(1, Math.round(img.width * ratio));
          const h = Math.max(1, Math.round(img.height * ratio));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          const out = canvas.toDataURL("image/jpeg", quality);
          resolve(out);
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = (e) =>
        reject(new Error("Falha ao carregar imagem para redimensionar: " + e));
      img.crossOrigin = "anonymous";
      img.src = dataUrl;
    });
  }

  async function shrinkDataUrlToLimit(originalDataUrl, options = {}) {
    const {
      maxBytes = 350 * 1024,
      startQuality = 0.85,
      minQuality = 0.35,
      qualityStep = 0.05,
      maxWidth = 1280,
      maxHeight = 960,
      downscaleStep = 0.9,
    } = options;

    let dataUrl = originalDataUrl;
    if (dataUrlByteSize(dataUrl) <= maxBytes) return dataUrl;

    let quality = startQuality;
    while (quality >= minQuality) {
      try {
        const shrunk = await resizeDataUrl(
          dataUrl,
          maxWidth,
          maxHeight,
          quality
        );
        if (dataUrlByteSize(shrunk) <= maxBytes) return shrunk;
        dataUrl = shrunk;
      } catch (err) {
        console.warn("Erro ao re-encodar com qualidade:", quality, err);
      }
      quality -= qualityStep;
    }

    let loops = 0;
    let currentMaxW = maxWidth;
    let currentMaxH = maxHeight;
    while (loops < 12) {
      currentMaxW = Math.max(100, Math.round(currentMaxW * downscaleStep));
      currentMaxH = Math.max(100, Math.round(currentMaxH * downscaleStep));
      quality = Math.max(
        minQuality,
        startQuality * Math.pow(downscaleStep, loops)
      );
      try {
        const shrunk = await resizeDataUrl(
          dataUrl,
          currentMaxW,
          currentMaxH,
          quality
        );
        if (dataUrlByteSize(shrunk) <= maxBytes) return shrunk;
        dataUrl = shrunk;
      } catch (err) {
        console.warn(
          "Erro ao reduzir dimensões:",
          currentMaxW,
          currentMaxH,
          err
        );
      }
      loops++;
    }

    // última tentativa: retorna a melhor que temos
    return dataUrl;
  }

  /* ---------- FUNÇÃO A: fileToReducedDataUrlForFirestore (mais agressiva) ---------- */
  async function fileToReducedDataUrlForFirestore(file, opts = {}) {
    const defaultOpts = {
      startMaxWidth: 1280,
      startMaxHeight: 960,
      startQuality: 0.8,
      maxBytes: 350 * 1024, // 350KB por padrão (ajuste se quiser)
      minQuality: 0.32,
      qualityStep: 0.05,
      maxWidth: 1200,
      maxHeight: 900,
      downscaleStep: 0.86,
      finalAggressiveMaxBytes: 1048000, // segurança: abaixo do limite de 1_048_576
    };
    const cfg = Object.assign({}, defaultOpts, opts);

    try {
      // 1) tenta compressão/resize "normal"
      const start = await fileToCompressedDataUrl(
        file,
        cfg.startMaxWidth,
        cfg.startMaxHeight,
        cfg.startQuality
      );

      // 2) shrink iterativo até cfg.maxBytes
      let reduced = await shrinkDataUrlToLimit(start, {
        maxBytes: cfg.maxBytes,
        startQuality: cfg.startQuality,
        minQuality: cfg.minQuality,
        qualityStep: cfg.qualityStep,
        maxWidth: cfg.maxWidth,
        maxHeight: cfg.maxHeight,
        downscaleStep: cfg.downscaleStep,
      });

      // 3) se ainda for muito grande, faz uma tentativa AGRESSIVA (mais downscale e menor qualidade)
      if (dataUrlByteSize(reduced) > cfg.finalAggressiveMaxBytes) {
        try {
          // opção: reduzir para largura 800 e qualidade 0.56 -> re-encodar e testar
          reduced = await resizeDataUrl(reduced, 800, 600, 0.56);
          if (dataUrlByteSize(reduced) > cfg.finalAggressiveMaxBytes) {
            reduced = await resizeDataUrl(reduced, 640, 480, 0.48);
          }
        } catch (errAgg) {
          console.warn(
            "Tentativa agressiva de reduzir image falhou:",
            errAgg
          );
        }
      }

      return reduced;
    } catch (err) {
      console.warn(
        "fileToReducedDataUrlForFirestore falhou, fallback para leitura direta:",
        err
      );
      try {
        // fallback simples: tentar ler direto como dataURL (pode ser grande)
        return await blobToDataURL(file);
      } catch (e) {
        console.error("Falha ao gerar dataURL via fallback:", e);
        return "";
      }
    }
  }

  // ---------- ADICIONEI: convertDataUrlIfHeic (necessário para exibir/converter dataURLs HEIC) ----------
  async function convertDataUrlIfHeic(src) {
    try {
      if (!src || typeof src !== "string") return src;
      // cache conversions
      window.__heicConvertedCache = window.__heicConvertedCache || {};
      if (window.__heicConvertedCache[src])
        return window.__heicConvertedCache[src];

      // If it's a data URL with HEIC
      if (isDataUrlHeic(src)) {
        // if heic2any available convert
        try {
          const heic = await ensureHeic2any();
          const blob = dataURLtoBlob(src);
          const converted = await heic({
            blob,
            toType: "image/jpeg",
            quality: 0.9,
          });
          const jpegBlob =
            converted instanceof Blob
              ? converted
              : (Array.isArray(converted) && converted.length
                  ? converted[0]
                  : converted);
          if (!jpegBlob) throw new Error("heic2any retornou vazio");
          const jpg = await blobToDataURL(jpegBlob);
          window.__heicConvertedCache[src] = jpg;
          return jpg;
        } catch (err) {
          console.warn("Falha ao converter dataURL HEIC:", err);
          return src;
        }
      }

      // If it's a URL ending with .heic/.heif
      if (
        typeof src === "string" &&
        (src.toLowerCase().endsWith(".heic") ||
          src.toLowerCase().endsWith(".heif"))
      ) {
        try {
          const resp = await fetch(src);
          if (!resp.ok) throw new Error("fetch falhou: " + resp.status);
          const blob = await resp.blob();
          const heic = await ensureHeic2any();
          const converted = await heic({
            blob,
            toType: "image/jpeg",
            quality: 0.9,
          });
          const jpegBlob =
            converted instanceof Blob
              ? converted
              : (Array.isArray(converted) && converted.length
                  ? converted[0]
                  : converted);
          if (!jpegBlob) throw new Error("heic2any retornou vazio (remoto)");
          const jpg = await blobToDataURL(jpegBlob);
          window.__heicConvertedCache[src] = jpg;
          return jpg;
        } catch (err) {
          console.warn("Falha ao buscar/convert .heic remoto:", err);
          return src;
        }
      }

      return src;
    } catch (err) {
      console.error("Erro em convertDataUrlIfHeic:", err);
      return src;
    }
  }

  // ========= RENUMERAR: ordena por data ASC (mais antigo = 1) =========
  async function renumerarEventosCodigoSequencial() {
    try {
      console.log(
        "Iniciando renumeração dos eventos (mais antigo = codigo 1)..."
      );

      // Busca TODOS os eventos, do mais antigo para o mais recente (asc)
      const snap = await db
        .collection("eventos")
        .orderBy("dataInicio", "asc")
        .get();

      if (snap.empty) {
        console.log("Nenhum evento encontrado para renumerar.");
        return 0;
      }

      let codigo = 1;
      let batch = db.batch();
      let ops = 0;
      const commits = [];

      snap.forEach((doc) => {
        batch.update(doc.ref, { codigo: codigo });
        codigo++;
        ops++;

        if (ops >= 450) {
          commits.push(
            batch.commit().catch((err) => {
              console.error(
                "Erro no commit parcial durante renumeração:",
                err
              );
            })
          );
          batch = db.batch();
          ops = 0;
        }
      });

      if (ops > 0) {
        commits.push(
          batch.commit().catch((err) => {
            console.error(
              "Erro no commit final durante renumeração:",
              err
            );
          })
        );
      }

      await Promise.all(commits);

      console.log("Renumeração concluída com sucesso! Total:", codigo - 1);
      return codigo - 1;
    } catch (err) {
      console.error("Erro ao renumerar eventos:", err);
      throw err;
    }
  }

  // ========= Detectar se códigos estão invertidos e corrigir (com confirmação) =========
  async function detectAndFixInvertedCodes() {
    try {
      const [mostRecentSnap, oldestSnap, maxCodigoSnap] = await Promise.all([
        db.collection("eventos").orderBy("dataInicio", "desc").limit(1).get(),
        db.collection("eventos").orderBy("dataInicio", "asc").limit(1).get(),
        db.collection("eventos").orderBy("codigo", "desc").limit(1).get(),
      ]);

      if (mostRecentSnap.empty || oldestSnap.empty) {
        console.log(
          "Não há eventos suficientes para avaliar ordenação de códigos."
        );
        return;
      }

      const mostRecentDoc = mostRecentSnap.docs[0];
      const oldestDoc = oldestSnap.docs[0];
      const maxCodigoDoc = maxCodigoSnap.empty
        ? null
        : maxCodigoSnap.docs[0];

      const mostRecentCodigo = mostRecentDoc.data().codigo;
      const oldestCodigo = oldestDoc.data().codigo;
      const maxCodigo = maxCodigoDoc ? maxCodigoDoc.data().codigo : null;

      console.log(
        "Detecção de códigos: mostRecentCodigo=",
        mostRecentCodigo,
        "oldestCodigo=",
        oldestCodigo,
        "maxCodigo=",
        maxCodigo
      );

      const likelyInverted =
        typeof mostRecentCodigo === "number" &&
        typeof oldestCodigo === "number" &&
        mostRecentCodigo < oldestCodigo;

      if (!likelyInverted) {
        console.log("Não parece haver inversão de códigos. Nada a fazer.");
        return;
      }

      const proceed = confirm(
        "Detectei que os códigos parecem estar invertidos (o evento mais recente possui código menor que o mais antigo).\n\n" +
          "Deseja renumerar TODOS os eventos agora para que o evento mais antigo receba código=1 e o mais recente receba o maior código?\n\n" +
          "ATENÇÃO: isso atualizará TODOS os documentos na coleção 'eventos'."
      );

      if (!proceed) {
        console.log("Usuário cancelou a renumeração automática.");
        return;
      }

      const total = await renumerarEventosCodigoSequencial();
      alert(
        "Renumeração automática concluída. Total de eventos renumerados: " +
          total
      );
    } catch (err) {
      console.error("Erro na detecção/correção de códigos:", err);
      alert("Erro ao verificar/renumerar códigos. Veja o console (F12).");
    }
  }

  // ========= Referências de elementos =========
  const form = document.getElementById("eventoForm");
  const fotosInput = document.getElementById("fotos");
  const dropArea = document.getElementById("dropArea");
  const novasFotosPreview = document.getElementById("novasFotosPreview");

  const filtroDe = document.getElementById("filtroDe");
  const filtroAte = document.getElementById("filtroAte");
  const btnFiltrar = document.getElementById("btnFiltrar");
  const btnLimparFiltro = document.getElementById("btnLimparFiltro");

  // filtro IS UI (se presente no index.html)
  const filterField = document.getElementById("filterField");
  const filterValue = document.getElementById("filterValue");
  const btnAplicarIs = document.getElementById("btnAplicarIs");
  const btnLimparIs = document.getElementById("btnLimparIs");

  const btnPdfCompleto = document.getElementById("btnPdfCompleto");
  const btnPdfSimples = document.getElementById("btnPdfSimples");

  const tabelaBody = document.querySelector("#tabelaEventos tbody");

  const campoEventoId = document.getElementById("eventoId");
  const campoCodigo = document.getElementById("codigo"); // campo Código na tela
  const formTituloModo = document.getElementById("formTituloModo");
  const btnSalvar = document.getElementById("btnSalvar");
  const btnCancelarEdicao = document.getElementById("btnCancelarEdicao");

  const fotosAtuaisWrapper = document.getElementById("fotosAtuaisWrapper");
  const fotosAtuaisDiv = document.getElementById("fotosAtuais");

  const btnToggleTema =
    document.querySelector(".toggle-tema") ||
    document.getElementById("btnToggleTema");

  let eventosCache = [];
  let eventoEmEdicaoId = null;

  // ========= HELPER: detectar HEIC/HEIF =========
  function isHeicFile(file) {
    if (!file) return false;
    const type = (file.type || "").toLowerCase();
    const name = (file.name || "").toLowerCase();
    return (
      type === "image/heic" ||
      type === "image/heif" ||
      name.endsWith(".heic") ||
      name.endsWith(".heif")
    );
  }

  // ========= THEME TOGGLE (CLARO / ESCURO) =========
  (function initTheme() {
    const html = document.documentElement;
    const temaSalvo = localStorage.getItem("agenda_tema") || "light";
    if (temaSalvo === "dark") {
      html.setAttribute("data-theme", "dark");
    } else {
      html.removeAttribute("data-theme");
    }

    if (btnToggleTema) {
      atualizarLabelBotaoTema();

      btnToggleTema.addEventListener("click", () => {
        const atual = html.getAttribute("data-theme");
        if (atual === "dark") {
          html.removeAttribute("data-theme");
          localStorage.setItem("agenda_tema", "light");
        } else {
          html.setAttribute("data-theme", "dark");
          localStorage.setItem("agenda_tema", "dark");
        }
        atualizarLabelBotaoTema();
      });
    }

    function atualizarLabelBotaoTema() {
      if (!btnToggleTema) return;
      const isDark = html.getAttribute("data-theme") === "dark";
      btnToggleTema.textContent = isDark ? "☀ Claro" : "🌙 Escuro";
    }
  })();

  // ========= Drag & Drop de fotos =========
  if (dropArea && fotosInput) {
    const preventDefaults = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };

    ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
      dropArea.addEventListener(eventName, preventDefaults, false);
    });

    ["dragenter", "dragover"].forEach((eventName) => {
      dropArea.addEventListener(eventName, () => {
        dropArea.classList.add("dragover");
      });
    });

    ["dragleave", "drop"].forEach((eventName) => {
      dropArea.addEventListener(eventName, () => {
        dropArea.classList.remove("dragover");
      });
    });

    dropArea.addEventListener("click", () => fotosInput.click());

    dropArea.addEventListener("drop", (e) => {
      const dt = e.dataTransfer;
      const files = dt.files;
      const dataTransfer = new DataTransfer();

      Array.from(files).forEach((file) => {
        if (file.type.startsWith("image/") || isHeicFile(file)) {
          dataTransfer.items.add(file);
        }
      });

      fotosInput.files = dataTransfer.files;
      atualizarPreviewNovasFotos();
    });

    fotosInput.addEventListener("change", atualizarPreviewNovasFotos);
  }

  // ========= Preview das novas fotos =========
  function atualizarPreviewNovasFotos() {
    if (!novasFotosPreview || !fotosInput) return;

    novasFotosPreview.innerHTML = "";
    const files = fotosInput.files;
    if (!files || !files.length) return;

    Array.from(files).forEach((file) => {
      const card = document.createElement("div");
      card.className = "foto-thumb";

      const legend = document.createElement("span");

      if (isHeicFile(file)) {
        const aviso = document.createElement("div");
        aviso.className = "foto-thumb__aviso";
        aviso.textContent = "HEIC – será convertido para JPG ao salvar";

        legend.textContent = file.name + " (HEIC)";
        card.appendChild(aviso);
        card.appendChild(legend);
      } else if (file.type.startsWith("image/")) {
        const img = document.createElement("img");
        img.className = "foto-thumb__img";
        img.alt = file.name;
        img.src = URL.createObjectURL(file);

        legend.textContent = file.name;
        card.appendChild(img);
        card.appendChild(legend);
      } else {
        legend.textContent = file.name + " (não é imagem)";
        card.appendChild(legend);
      }

      novasFotosPreview.appendChild(card);
    });
  }

  // ========= Helpers de formulário =========
  function toggleFormDisabled(flag) {
    if (!form) return;
    const elements = form.querySelectorAll("input, select, textarea, button");
    elements.forEach((el) => (el.disabled = flag));
  }

  function limparFormulario() {
    if (!form) return;

    form.reset();
    if (campoEventoId) campoEventoId.value = "";
    if (campoCodigo) {
      campoCodigo.value = "";
      campoCodigo.readOnly = false;
    }
    eventoEmEdicaoId = null;

    if (novasFotosPreview) novasFotosPreview.innerHTML = "";
    if (fotosAtuaisDiv) fotosAtuaisDiv.innerHTML = "";
    if (fotosAtuaisWrapper) fotosAtuaisWrapper.classList.add("oculto");

    if (formTituloModo)
      formTituloModo.textContent = "Cadastrar novo evento";
    if (btnSalvar) btnSalvar.textContent = "Salvar evento";
    if (btnCancelarEdicao) btnCancelarEdicao.classList.add("oculto");
  }

  if (btnCancelarEdicao) {
    btnCancelarEdicao.addEventListener("click", () => {
      limparFormulario();
    });
  }

  function preencherFormularioComEvento(ev) {
    const byId = (id) => document.getElementById(id);

    const evento = byId("evento");
    const local = byId("local");
    const endereco = byId("endereco");
    const dataInicio = byId("dataInicio");
    const dataFim = byId("dataFim");
    const horaInicio = byId("horaInicio");
    const horaFim = byId("horaFim");
    const formato = byId("formato");
    const participante = byId("participante");
    const pauta = byId("pauta");
    const comentario = byId("comentario");

    if (campoCodigo) {
      const cod =
        ev.codigo !== undefined && ev.codigo !== null
          ? ev.codigo
          : ev.idSequencial !== undefined && ev.idSequencial !== null
          ? ev.idSequencial
          : "";
      campoCodigo.value = cod;
      campoCodigo.readOnly = true;
    }

    if (evento) evento.value = ev.evento || "";
    if (local) local.value = ev.local || "";
    if (endereco) endereco.value = ev.endereco || "";
    if (dataInicio) dataInicio.value = ev.dataInicio || "";
    if (dataFim) dataFim.value = ev.dataFim || ev.dataInicio || "";
    if (horaInicio) horaInicio.value = ev.horaInicio || "";
    if (horaFim) horaFim.value = ev.horaFim || "";
    if (formato) formato.value = ev.formato || "Presencial";
    if (participante) participante.value = ev.participante || "";
    if (pauta) pauta.value = ev.pauta || "";
    if (comentario) comentario.value = ev.comentario || "";
  }

  // ========= Buscar fotos de um evento (para PDF) =========
  async function getFotosEvento(idEvento) {
    const fotos = [];
    try {
      const snap = await db
        .collection("eventos")
        .doc(idEvento)
        .collection("fotos")
        .get();

      // iterar de forma síncrona (await dentro do laço) para garantir conversões
      for (const docFoto of snap.docs) {
        const data = docFoto.data();
        const { dataUrl, url, legenda } = data;
        let src = dataUrl || url || "";
        if (!src) continue;

        // tenta converter se for dataURL HEIC ou link .heic
        try {
          src = await convertDataUrlIfHeic(src);
        } catch (err) {
          console.warn(
            "Falha ao converter foto do evento (seguindo com original):",
            err
          );
        }

        fotos.push({ src, legenda: legenda || "" });
      }
    } catch (err) {
      console.error("Erro ao buscar fotos do evento", err);
    }
    return fotos;
  }

  // ========= Fotos de um evento (já salvas) – MOSTRANDO E EXCLUINDO =========
  async function carregarFotosDoEvento(idEvento) {
    if (!fotosAtuaisDiv || !fotosAtuaisWrapper) return;

    fotosAtuaisDiv.innerHTML = "";

    try {
      const snap = await db
        .collection("eventos")
        .doc(idEvento)
        .collection("fotos")
        .get();

      if (snap.empty) {
        fotosAtuaisWrapper.classList.add("oculto");
        return;
      }

      fotosAtuaisWrapper.classList.remove("oculto");

      // iterar com for..of para permitir await convert
      for (const docFoto of snap.docs) {
        const { dataUrl, url, legenda } = docFoto.data();
        let src = dataUrl || url || "";
        if (!src) continue;

        try {
          src = await convertDataUrlIfHeic(src);
        } catch (err) {
          console.warn(
            "Falha ao converter foto para exibição (usando original):",
            err
          );
        }

        const card = document.createElement("div");
        card.className = "foto-thumb";

        const img = document.createElement("img");
        img.className = "foto-thumb__img";
        img.alt = legenda || "Foto do evento";
        img.src = src;

        const caption = document.createElement("span");
        caption.textContent = legenda || "";

        const btnExcluir = document.createElement("button");
        btnExcluir.type = "button";
        btnExcluir.textContent = "Excluir";
        btnExcluir.className = "btn secundario";
        btnExcluir.style.marginTop = "4px";
        btnExcluir.addEventListener("click", async () => {
          const ok = confirm("Excluir esta foto do evento?");
          if (!ok) return;
          try {
            await db
              .collection("eventos")
              .doc(idEvento)
              .collection("fotos")
              .doc(docFoto.id)
              .delete();
            card.remove();

            if (!fotosAtuaisDiv.querySelector(".foto-thumb")) {
              fotosAtuaisWrapper.classList.add("oculto");
            }
          } catch (err) {
            console.error("Erro ao excluir foto", err);
            alert("Erro ao excluir foto. Verifique o console.");
          }
        });

        card.appendChild(img);
        card.appendChild(caption);
        card.appendChild(btnExcluir);
        fotosAtuaisDiv.appendChild(card);
      }
    } catch (err) {
      console.error("Erro ao carregar fotos do evento", err);
    }
  }

  // ========= Abrir edição =========
  async function abrirEdicaoEvento(idEvento) {
    try {
      let ev = eventosCache.find((e) => e.id === idEvento);

      if (!ev) {
        const doc = await db.collection("eventos").doc(idEvento).get();
        if (!doc.exists) {
          alert("Evento não encontrado.");
          return;
        }
        ev = { id: doc.id, ...doc.data() };

        const cacheEv = eventosCache.find((e) => e.id === idEvento);
        if (cacheEv) {
          if (cacheEv.codigo !== undefined) ev.codigo = cacheEv.codigo;
          if (cacheEv.idSequencial !== undefined)
            ev.idSequencial = cacheEv.idSequencial;
        }
      }

      eventoEmEdicaoId = idEvento;
      if (campoEventoId) campoEventoId.value = idEvento;

      preencherFormularioComEvento(ev);

      if (formTituloModo) formTituloModo.textContent = "Editando evento";
      if (btnSalvar) btnSalvar.textContent = "Atualizar evento";
      if (btnCancelarEdicao)
        btnCancelarEdicao.classList.remove("oculto");

      await carregarFotosDoEvento(idEvento);

      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      console.error(err);
      alert("Erro ao carregar dados do evento para edição.");
    }
  }

  // ========= Salvar (criar/atualizar) evento + fotos =========
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      // ======= Upload novas fotos em base64 (com conversão HEIC -> JPG e redução) =======
if (fotosInput && fotosInput.files && fotosInput.files.length) {
  for (let file of fotosInput.files) {
    if (!file.type.startsWith("image/") && !isHeicFile(file)) continue;

    try {
      // Gera dataURL reduzido (max ~350KB por padrão)
      const reducedDataUrl =
        await fileToReducedDataUrlForFirestore(file);

      if (!reducedDataUrl) {
        console.warn("Imagem reduzida vazia, pulando:", file.name);
        continue;
      }

      // Cria thumbnail menor para preview (opcional)
      let thumbnail = reducedDataUrl;
      try {
        thumbnail = await resizeDataUrl(
          reducedDataUrl,
          420,
          320,
          0.65
        );
      } catch (thumbErr) {
        console.warn(
          "Falha ao criar thumbnail (usando reduzido):",
          thumbErr
        );
        thumbnail = reducedDataUrl;
      }

      // Salva APENAS os dataURLs reduzidos (evita salvar original HEIC grande)
      await db
        .collection("eventos")
        .doc(idEvento)
        .collection("fotos")
        .add({
          dataUrl: reducedDataUrl,
          thumbnail,
          legenda: file.name,
          criadaEm:
            firebase.firestore.FieldValue.serverTimestamp(),
        });

      console.log(
        "Foto salva (reduzida) no Firestore:",
        file.name
      );
    } catch (errImg) {
      console.error(
        "Erro ao processar/salvar imagem:",
        file.name,
        errImg
      );
      alert(
        "Erro ao processar a imagem '" +
          file.name +
          "'. Se for HEIC, tente exportar para JPG/PNG no celular ou computador."
      );
    }
  }
}
// ======= FIM BLOCO ATUALIZADO =======



      const campoEvento = document.getElementById("evento");
      if (!campoEvento || !campoEvento.value.trim()) {
        alert("Informe o tipo de evento.");
        return;
      }
      const eventoTipo = campoEvento.value.trim();

      const campoDataInicio = document.getElementById("dataInicio");
      const campoDataFim = document.getElementById("dataFim");

      const dataInicio = campoDataInicio ? campoDataInicio.value : "";
      const dataFimInput = campoDataFim ? campoDataFim.value : "";
      const dataFim = dataFimInput || dataInicio;

      const docEvento = {
        evento: eventoTipo,
        local: (document.getElementById("local")?.value || "").trim(),
        endereco:
          (document.getElementById("endereco")?.value || "").trim(),
        dataInicio,
        dataFim,
        horaInicio: document.getElementById("horaInicio")?.value || "",
        horaFim: document.getElementById("horaFim")?.value || "",
        formato: document.getElementById("formato")?.value || "",
        participante:
          (document.getElementById("participante")?.value || "").trim(),
        pauta: (document.getElementById("pauta")?.value || "").trim(),
        comentario:
          (document.getElementById("comentario")?.value || "").trim(),
        atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      };

      try {
        toggleFormDisabled(true);

        let idEvento;

        if (eventoEmEdicaoId) {
          // ATUALIZA: atualiza o documento existente
          idEvento = eventoEmEdicaoId;
          await db.collection("eventos").doc(idEvento).update(docEvento);
        } else {
          // CRIA: adiciona sem definir 'codigo' aqui (renumeração fará o ajuste)
          docEvento.criadoEm =
            firebase.firestore.FieldValue.serverTimestamp();

          const docRef = await db.collection("eventos").add(docEvento);
          idEvento = docRef.id;
        }

        // ======= Upload novas fotos em base64 (com conversão HEIC -> JPG e redução) =======
        if (fotosInput && fotosInput.files && fotosInput.files.length) {
          for (let file of fotosInput.files) {
            if (!file.type.startsWith("image/") && !isHeicFile(file)) continue;

            try {
              // Gera dataURL reduzido (max ~350KB por padrão)
              const reducedDataUrl =
                await fileToReducedDataUrlForFirestore(file);

              if (!reducedDataUrl) {
                console.warn("Imagem reduzida vazia, pulando:", file.name);
                continue;
              }

              // Cria thumbnail menor para preview (opcional)
              let thumbnail = reducedDataUrl;
              try {
                thumbnail = await resizeDataUrl(
                  reducedDataUrl,
                  420,
                  320,
                  0.65
                );
              } catch (thumbErr) {
                console.warn(
                  "Falha ao criar thumbnail (usando reduzido):",
                  thumbErr
                );
                thumbnail = reducedDataUrl;
              }

              // Salva APENAS os dataURLs reduzidos (evita salvar original HEIC grande)
              await db
                .collection("eventos")
                .doc(idEvento)
                .collection("fotos")
                .add({
                  dataUrl: reducedDataUrl,
                  thumbnail,
                  legenda: file.name,
                  criadaEm:
                    firebase.firestore.FieldValue.serverTimestamp(),
                });

              console.log(
                "Foto salva (reduzida) no Firestore:",
                file.name
              );
            } catch (errImg) {
              console.error(
                "Erro ao processar/salvar imagem:",
                file.name,
                errImg
              );
              alert(
                "Erro ao processar a imagem '" +
                  file.name +
                  "'. Se for HEIC, tente exportar para JPG/PNG no celular ou computador."
              );
            }
          }
        }
        // ======= FIM BLOCO ATUALIZADO =======

        // Agora renumerar todos os eventos conforme a data (mais antigo = 1, mais recente = N)
        await renumerarEventosCodigoSequencial();

        alert(
          eventoEmEdicaoId
            ? "Evento atualizado com sucesso!"
            : "Evento salvo com sucesso!"
        );
        limparFormulario();
        await carregarEventos();
      } catch (err) {
        console.error(err);
        alert(
          "Erro ao salvar o evento ou as fotos.\n" +
            "Se a imagem for muito pesada ou estiver em formato não suportado, " +
            "tente tirar um print ou uma foto em resolução menor (JPG/PNG)."
        );
      } finally {
        toggleFormDisabled(false);
      }
    });
  }

  // ========= carregarEventos() =========
  async function carregarEventos() {
    if (!tabelaBody) return;

    tabelaBody.innerHTML = "";
    eventosCache = [];

    try {
      const orderParam = (
        new URLSearchParams(location.search).get("order") || ""
      ).toLowerCase();
      const order = orderParam === "asc" ? "asc" : "desc";

      let queryRef = db.collection("eventos");

      const fieldRaw = (filterField?.value || "").trim();
      const valRaw = (filterValue?.value || "").trim();
      const de = (filtroDe?.value || "").trim();
      const ate = (filtroAte?.value || "").trim();

      if (fieldRaw && valRaw) {
        if (fieldRaw === "id") {
          // tenta buscar por document id
          const docSnap = await db.collection("eventos").doc(valRaw).get();
          if (docSnap.exists) {
            eventosCache.push({ id: docSnap.id, ...docSnap.data() });
            renderTabela();
            return;
          }
          // se não achar doc id, tenta codigo numérico
          const n = Number(valRaw);
          if (!Number.isNaN(n)) {
            queryRef = queryRef.where("codigo", "==", n);
          } else {
            // fallback: busca por igualdade no campo 'evento'
            queryRef = queryRef.where("evento", "==", valRaw);
          }
        } else {
          let value = valRaw;
          if (fieldRaw === "codigo") {
            const n = Number(valRaw);
            if (!Number.isNaN(n)) value = n;
          }
          queryRef = queryRef.where(fieldRaw, "==", value);
        }
      }

      if (de) queryRef = queryRef.where("dataInicio", ">=", de);
      if (ate) queryRef = queryRef.where("dataInicio", "<=", ate);

      queryRef = queryRef.orderBy("dataInicio", order);

      try {
        const snap = await queryRef.get();
        snap.forEach((doc) =>
          eventosCache.push({ id: doc.id, ...doc.data() })
        );
        renderTabela();
        return;
      } catch (serverErr) {
        console.warn("Firestore query failed:", serverErr);
        const msg =
          serverErr && serverErr.message ? serverErr.message : "";
        const indexUrlMatch = msg.match(/https?:\/\/[^\s)]+/);
        const indexUrl = indexUrlMatch ? indexUrlMatch[0] : null;

        if (msg.includes("requires an index") || indexUrl) {
          const openLink = confirm(
            "A consulta que você tentou executar exige um índice composto no Firestore. Deseja abrir a página para criar o índice agora?\n\n(Se não criar, o filtro será feito localmente, possivelmente lento)"
          );
          if (openLink && indexUrl) {
            window.open(indexUrl, "_blank");
          } else if (!indexUrl) {
            alert(
              "Firestore solicitou um índice, verifique o console para o link ou acesse Firestore Console → Indexes."
            );
          }
        } else {
          console.error("Erro no get() do Firestore:", serverErr);
          alert("Erro ao consultar Firestore. Veja o console (F12).");
        }

        // Fallback client-side (busca um lote e filtra localmente)
        const FETCH_LIMIT = 800;
        const snapAll = await db
          .collection("eventos")
          .orderBy("dataInicio", "desc")
          .limit(FETCH_LIMIT)
          .get();
        const docs = snapAll.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));

        let filtered = docs;
        if (fieldRaw && valRaw) {
          const v = valRaw.toString().trim().toLowerCase();
          if (fieldRaw === "id") {
            filtered = filtered.filter((d) => d.id === valRaw);
            if (!filtered.length) {
              const n = Number(valRaw);
              if (!Number.isNaN(n))
                filtered = docs.filter((d) => d.codigo === n);
              else
                filtered = docs.filter(
                  (d) =>
                    (d.evento || "")
                      .toString()
                      .toLowerCase() === v
                );
            }
          } else if (fieldRaw === "codigo") {
            const n = Number(valRaw);
            if (!Number.isNaN(n))
              filtered = filtered.filter((d) => d.codigo === n);
            else
              filtered = filtered.filter(
                (d) =>
                  (d.codigo || "").toString() === valRaw
              );
          } else {
            filtered = filtered.filter(
              (d) =>
                ((d[fieldRaw] || "").toString().toLowerCase() === v)
            );
          }
        }

        if (de)
          filtered = filtered.filter(
            (d) => d.dataInicio && d.dataInicio >= de
          );
        if (ate)
          filtered = filtered.filter(
            (d) => d.dataInicio && d.dataInicio <= ate
          );

        filtered.sort((a, b) => {
          const da = a.dataInicio || "";
          const dbb = b.dataInicio || "";
          if (da === dbb) return 0;
          if (order === "asc") return da < dbb ? -1 : 1;
          return da > dbb ? -1 : 1;
        });

        eventosCache = filtered;
        renderTabela();
        return;
      }
    } catch (err) {
      console.error("Erro inesperado em carregarEventos():", err);
      alert("Erro ao carregar eventos. Veja o console (F12).");
    }
  }

  function renderTabela() {
    if (!tabelaBody) return;

    tabelaBody.innerHTML = "";

    if (!eventosCache.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 11;
      td.textContent =
        "Nenhum evento encontrado para o filtro selecionado.";
      tr.appendChild(td);
      tabelaBody.appendChild(tr);
      return;
    }

    eventosCache.forEach((ev) => {
      const tr = document.createElement("tr");
      tr.dataset.id = ev.id;

      const horario =
        (ev.horaInicio || "") +
        (ev.horaInicio || ev.horaFim ? " - " : "") +
        (ev.horaFim || "");

      const displayId =
        ev.codigo !== undefined && ev.codigo !== null
          ? ev.codigo
          : ev.idSequencial !== undefined && ev.idSequencial !== null
          ? ev.idSequencial
          : "";

      tr.innerHTML = `
        <td>${displayId}</td>
        <td>${ev.dataInicio || ""}</td>
        <td>${ev.evento || ""}</td>
        <td>${ev.local || ""}</td>
        <td>${ev.endereco || ""}</td>
        <td>${horario}</td>
        <td>${ev.formato || ""}</td>
        <td>${ev.participante || ""}</td>
        <td>${ev.pauta || ""}</td>
        <td>${ev.comentario || ""}</td>
        <td class="acao-col">
          <button type="button" class="btn secundario btn-editar" data-id="${ev.id}">
            Editar / Fotos
          </button>
          <button type="button" class="btn primario btn-pdf-evento" data-id="${ev.id}">
            PDF
          </button>
        </td>
      `;

      tr.addEventListener("click", (e) => {
        const isButton = e.target.closest("button");
        if (isButton) return;
        abrirEdicaoEvento(ev.id);
      });

      tabelaBody.appendChild(tr);
    });

    document.querySelectorAll(".btn-editar").forEach((btn) =>
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        abrirEdicaoEvento(btn.getAttribute("data-id"));
      })
    );

    document.querySelectorAll(".btn-pdf-evento").forEach((btn) =>
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        gerarPdfEventoComFotos(btn.getAttribute("data-id"));
      })
    );
  }

  // ========= Filtros =========
  if (btnFiltrar) {
    btnFiltrar.addEventListener("click", carregarEventos);
  }

  if (btnLimparFiltro) {
    btnLimparFiltro.addEventListener("click", () => {
      if (filtroDe) filtroDe.value = "";
      if (filtroAte) filtroAte.value = "";
      carregarEventos();
    });
  }

  if (btnAplicarIs) btnAplicarIs.addEventListener("click", carregarEventos);
  if (btnLimparIs)
    btnLimparIs.addEventListener("click", () => {
      if (filterField) filterField.value = "";
      if (filterValue) filterValue.value = "";
      carregarEventos();
    });

  // ========= Funções para PDFs (com suporte a imagens convertidas) =========

  function obterDescricaoPeriodo() {
    if (!filtroDe?.value && !filtroAte?.value) {
      return "Todos os eventos cadastrados";
    }

    const de = filtroDe.value || "início";
    const ate = filtroAte.value || "data atual";
    return `Período: ${de} até ${ate}`;
  }

  function gerarCabecalhoCorporativo(doc, titulo) {
    const hoje = new Date();
    const dataStr = hoje.toLocaleDateString("pt-BR");
    const horaStr = hoje.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });

    doc.setFillColor(5, 30, 45);
    doc.rect(0, 0, 210, 20, "F");

    try {
      if (logoIfprImg && logoIfprImg.complete) {
        doc.addImage(logoIfprImg, "PNG", 10, 3, 18, 14);
      }
      if (logoPmpImg && logoPmpImg.complete) {
        doc.addImage(logoPmpImg, "PNG", 32, 2.5, 18, 15);
      }
      if (logoSebraeImg && logoSebraeImg.complete) {
        doc.addImage(logoSebraeImg, "PNG", 180, 3, 18, 14);
      }
    } catch (e) {
      console.warn(
        "Não foi possível adicionar alguma logo no cabeçalho do PDF:",
        e
      );
    }

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("INSTITUTO FEDERAL DO PARANÁ - CAMPUS PALMAS", 60, 7);

    doc.setFontSize(9);
    doc.text(
      "Incubadora IFPR / Prefeitura Municipal de Palmas / Sebrae-PR",
      60,
      12
    );

    doc.setFontSize(9);
    doc.text(titulo, 60, 17);

    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(`Emitido em: ${dataStr} às ${horaStr}`, 10, 27);
    doc.text(obterDescricaoPeriodo(), 10, 32);

    doc.setDrawColor(0, 143, 76);
    doc.setLineWidth(0.5);
    doc.line(10, 35, 200, 35);
  }

  // (geração de PDFs usa getFotosEvento que faz conversão quando necessário)
  // Aqui assumo que você já tem implementarções de:
  // - gerarPdfEventoComFotos(idEvento)
  // - e possivelmente PDFs completos/simples usando jsPDF + getFotosEvento

  // ========= Inicialização =========
  // Primeiro: detectar se os códigos no banco parecem invertidos e oferecer correção.
  await detectAndFixInvertedCodes();

  // Em seguida: carregar a lista (exibe data mais recente primeiro)
  await carregarEventos();
});
