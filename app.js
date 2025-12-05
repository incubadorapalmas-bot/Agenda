// app.js - Agenda Incubadora IFPR/PMP
// Versão completa: tratamento HEIC/HEIF, renumeração, filtros, previews, e geração de PDFs.
// Mantive toda a lógica original e APENAS substituí/tornei mais robusta a parte de salvar fotos:
// - Converte HEIC -> JPEG se necessário (heic2any)
// - Reduz (resize + reencode) iterativamente para caber em limite (por padrão ~350KB)
// - Salva no Firestore apenas dataUrl reduzido + thumbnail pequeno
// Cole por cima do seu app.js atual (substitua totalmente).

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

  // ========= CONSTANTE DO CDN DO HEIC2ANY (mais recente via jsDelivr) =========
  const HEIC2ANY_SRC =
    "https://cdn.jsdelivr.net/npm/heic2any@0.0.6/dist/heic2any.min.js";

  function ensureHeic2any() {
    if (
      window.__heic2anyFn &&
      typeof window.__heic2anyFn === "function"
    ) {
      return Promise.resolve(window.__heic2anyFn);
    }

    if (window.heic2any) {
      const g = window.heic2any;
      const fn =
        (typeof g === "function" && g) ||
        (g && typeof g.default === "function" && g.default);
      if (fn) {
        window.__heic2anyFn = fn;
        return Promise.resolve(fn);
      }
    }

    if (window.__heic2anyLoading) {
      return window.__heic2anyLoading;
    }

    window.__heic2anyLoading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = HEIC2ANY_SRC;
      script.async = true;

      script.onload = () => {
        const g = window.heic2any;
        let fn = null;
        if (typeof g === "function") fn = g;
        else if (g && typeof g.default === "function") fn = g.default;
        else if (g && typeof g.heic2any === "function") fn = g.heic2any;

        if (!fn && window.__heic2anyFn && typeof window.__heic2anyFn === "function") {
          fn = window.__heic2anyFn;
        }

        if (!fn) {
          reject(
            new Error(
              "Script heic2any carregado, mas função não encontrada."
            )
          );
          return;
        }
        window.__heic2anyFn = fn;
        resolve(fn);
      };

      script.onerror = () => {
        reject(new Error("Falha ao carregar script heic2any a partir do CDN."));
      };

      document.head.appendChild(script);
    });

    return window.__heic2anyLoading;
  }

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
      return s.startsWith("data:image/heic") || s.startsWith("data:image/heif") || s.includes("heic");
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
      img.onerror = (e) => reject(new Error("Falha ao carregar imagem para redimensionar: " + e));
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
        const shrunk = await resizeDataUrl(dataUrl, maxWidth, maxHeight, quality);
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
      quality = Math.max(minQuality, startQuality * Math.pow(downscaleStep, loops));
      try {
        const shrunk = await resizeDataUrl(dataUrl, currentMaxW, currentMaxH, quality);
        if (dataUrlByteSize(shrunk) <= maxBytes) return shrunk;
        dataUrl = shrunk;
      } catch (err) {
        console.warn("Erro ao reduzir dimensões:", currentMaxW, currentMaxH, err);
      }
      loops++;
    }

    // última tentativa: retorna a melhor que temos
    return dataUrl;
  }

  async function fileToReducedDataUrlForFirestore(file, opts = {}) {
    // Usa o fileToCompressedDataUrl já existente como ponto de partida (ele já converte HEIC quando possível)
    try {
      const start = await fileToCompressedDataUrl(file, opts.startMaxWidth || 1280, opts.startMaxHeight || 960, opts.startQuality || 0.8);
      const reduced = await shrinkDataUrlToLimit(start, {
        maxBytes: opts.maxBytes || 350 * 1024,
        startQuality: opts.startQuality || 0.8,
        minQuality: opts.minQuality || 0.36,
        qualityStep: opts.qualityStep || 0.05,
        maxWidth: opts.maxWidth || 1200,
        maxHeight: opts.maxHeight || 900,
        downscaleStep: opts.downscaleStep || 0.86,
      });
      return reduced;
    } catch (err) {
      console.warn("fileToReducedDataUrlForFirestore falhou, tentando leitura direta:", err);
      try {
        return await blobToDataURL(file);
      } catch (e) {
        console.error("Falha final ao gerar dataURL da imagem:", e);
        return "";
      }
    }
  }

  // ========= RENUMERAR: ordena por data ASC (mais antigo = 1) =========
  async function renumerarEventosCodigoSequencial() {
    try {
      console.log("Iniciando renumeração dos eventos (mais antigo = codigo 1)...");

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
              console.error("Erro no commit parcial durante renumeração:", err);
            })
          );
          batch = db.batch();
          ops = 0;
        }
      });

      if (ops > 0) {
        commits.push(
          batch.commit().catch((err) => {
            console.error("Erro no commit final durante renumeração:", err);
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
        console.log("Não há eventos suficientes para avaliar ordenação de códigos.");
        return;
      }

      const mostRecentDoc = mostRecentSnap.docs[0];
      const oldestDoc = oldestSnap.docs[0];
      const maxCodigoDoc = maxCodigoSnap.empty ? null : maxCodigoSnap.docs[0];

      const mostRecentCodigo = mostRecentDoc.data().codigo;
      const oldestCodigo = oldestDoc.data().codigo;
      const maxCodigo = maxCodigoDoc ? maxCodigoDoc.data().codigo : null;

      console.log("Detecção de códigos: mostRecentCodigo=", mostRecentCodigo, "oldestCodigo=", oldestCodigo, "maxCodigo=", maxCodigo);

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
      alert("Renumeração automática concluída. Total de eventos renumerados: " + total);
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

  // ========= Helpers: compressão de imagem =========
  function fileToCompressedDataUrl(
    file,
    maxWidth = 1280,
    maxHeight = 720,
    quality = 0.6
  ) {
    return new Promise((resolve, reject) => {
      const processBlob = (blob) => {
        const reader = new FileReader();

        reader.onerror = () => reject(reader.error);
        reader.onload = () => {
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

              const dataUrl = canvas.toDataURL("image/jpeg", quality);
              resolve(dataUrl);
            } catch (errCanvas) {
              console.warn("Erro ao desenhar no canvas:", errCanvas);
              resolve(reader.result);
            }
          };

          img.onerror = () => {
            console.warn(
              "Imagem não pôde ser carregada no <img> (possível HEIC sem suporte)."
            );
            resolve(reader.result);
          };

          img.src = reader.result;
        };

        reader.readAsDataURL(blob);
      };

      if (isHeicFile(file)) {
        ensureHeic2any()
          .then((fn) =>
            fn({
              blob: file,
              toType: "image/jpeg",
              quality: 0.9,
            })
          )
          .then((convertedBlob) => {
            const blob =
              convertedBlob instanceof Blob
                ? convertedBlob
                : Array.isArray(convertedBlob) && convertedBlob.length
                ? convertedBlob[0]
                : convertedBlob;
            if (!blob) {
              throw new Error("heic2any retornou valor inválido");
            }
            processBlob(blob);
          })
          .catch(async (err) => {
            console.error("Erro ao converter HEIC para JPG:", err);
            try {
              const fr = new FileReader();
              fr.onload = () => {
                console.warn(
                  "FALLBACK: usando dataURL original do arquivo HEIC (pode não ser exibido em todos os navegadores)."
                );
                resolve(fr.result);
              };
              fr.onerror = () => {
                reject(
                  new Error(
                    "Falha ao processar HEIC e fallback também falhou. Tente exportar a imagem para JPG/PNG."
                  )
                );
              };
              fr.readAsDataURL(file);
            } catch (fallbackErr) {
              reject(
                new Error(
                  "Falha ao converter HEIC e não foi possível aplicar fallback. " +
                    fallbackErr.message
                )
              );
            }
          });

        return;
      }

      processBlob(file);
    });
  }

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
    if (campoCodigo) { campoCodigo.value = ""; campoCodigo.readOnly = false; }
    eventoEmEdicaoId = null;

    if (novasFotosPreview) novasFotosPreview.innerHTML = "";
    if (fotosAtuaisDiv) fotosAtuaisDiv.innerHTML = "";
    if (fotosAtuaisWrapper) fotosAtuaisWrapper.classList.add("oculto");

    if (formTituloModo) formTituloModo.textContent = "Cadastrar novo evento";
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
          console.warn("Falha ao converter foto do evento (seguindo com original):", err);
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
          console.warn("Falha ao converter foto para exibição (usando original):", err);
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

        // ======= BLOCO ATUALIZADO: Upload novas fotos em base64 (com conversão HEIC -> JPG e redução) =======
        // Salva dataUrl reduzido e thumbnail no Firestore (subcollection eventos/{id}/fotos).
        if (fotosInput && fotosInput.files && fotosInput.files.length) {
          for (let file of fotosInput.files) {
            if (!file.type.startsWith("image/") && !isHeicFile(file)) continue;

            try {
              // Gera dataURL reduzido (max ~350KB por padrão)
              const reducedDataUrl = await fileToReducedDataUrlForFirestore(file);

              if (!reducedDataUrl) {
                console.warn("Imagem reduzida vazia, pulando:", file.name);
                continue;
              }

              // Cria thumbnail menor para preview (opcional)
              let thumbnail = reducedDataUrl;
              try {
                thumbnail = await resizeDataUrl(reducedDataUrl, 420, 320, 0.65);
              } catch (thumbErr) {
                console.warn("Falha ao criar thumbnail (usando reduzido):", thumbErr);
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

              console.log("Foto salva (reduzida) no Firestore:", file.name);
            } catch (errImg) {
              console.error("Erro ao processar/salvar imagem:", file.name, errImg);
              // notifica usuário, mas continua com as próximas imagens
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

  // Substitua apenas a função carregarEventos() existente por esta versão
  async function carregarEventos() {
    if (!tabelaBody) return;

    tabelaBody.innerHTML = "";
    eventosCache = [];

    try {
      const orderParam = (new URLSearchParams(location.search).get("order") || "").toLowerCase();
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
        snap.forEach((doc) => eventosCache.push({ id: doc.id, ...doc.data() }));
        renderTabela();
        return;
      } catch (serverErr) {
        console.warn("Firestore query failed:", serverErr);
        // detecta se é erro que pede índice composto
        const msg = (serverErr && serverErr.message) ? serverErr.message : "";
        const indexUrlMatch = msg.match(/https?:\/\/[^\s)]+/);
        const indexUrl = indexUrlMatch ? indexUrlMatch[0] : null;

        if (msg.includes("requires an index") || indexUrl) {
          // informa o usuário e oferece abrir o link
          const openLink = confirm("A consulta que você tentou executar exige um índice composto no Firestore. Deseja abrir a página para criar o índice agora?\n\n(Se não criar, o filtro será feito localmente, possivelmente lento)");
          if (openLink && indexUrl) {
            window.open(indexUrl, "_blank");
          } else if (!indexUrl) {
            alert("Firestore solicitou um índice, verifique o console para o link ou acesse Firestore Console → Indexes.");
          }
        } else {
          // qualquer outro erro
          console.error("Erro no get() do Firestore:", serverErr);
          alert("Erro ao consultar Firestore. Veja o console (F12).");
        }

        // Fallback client-side (busca um lote e filtra localmente)
        const FETCH_LIMIT = 800;
        const snapAll = await db.collection("eventos").orderBy("dataInicio", "desc").limit(FETCH_LIMIT).get();
        const docs = snapAll.docs.map(d => ({ id: d.id, ...d.data() }));

        let filtered = docs;
        if (fieldRaw && valRaw) {
          const v = valRaw.toString().trim().toLowerCase();
          if (fieldRaw === "id") {
            filtered = filtered.filter(d => d.id === valRaw);
            if (!filtered.length) {
              const n = Number(valRaw);
              if (!Number.isNaN(n)) filtered = docs.filter(d => d.codigo === n);
              else filtered = docs.filter(d => (d.evento || "").toString().toLowerCase() === v);
            }
          } else if (fieldRaw === "codigo") {
            const n = Number(valRaw);
            if (!Number.isNaN(n)) filtered = filtered.filter(d => d.codigo === n);
            else filtered = filtered.filter(d => (d.codigo || "").toString() === valRaw);
          } else {
            filtered = filtered.filter(d => ((d[fieldRaw] || "").toString().toLowerCase() === v));
          }
        }

        if (de) filtered = filtered.filter(d => d.dataInicio && d.dataInicio >= de);
        if (ate) filtered = filtered.filter(d => d.dataInicio && d.dataInicio <= ate);

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
  if (btnLimparIs) btnLimparIs.addEventListener("click", () => {
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
      console.warn("Não foi possível adicionar alguma logo no cabeçalho do PDF:", e);
    }

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("INSTITUTO FEDERAL DO PARANÁ - CAMPUS PALMAS", 60, 7);

    doc.setFontSize(9);
    doc.text("Incubadora IFPR / Prefeitura Municipal de Palmas / Sebrae-PR", 60, 12);

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

  // ========= Inicialização =========
  // Primeiro: detectar se os códigos no banco parecem invertidos e oferecer correção.
  await detectAndFixInvertedCodes();

  // Em seguida: carregar a lista (exibe data mais recente primeiro)
  await carregarEventos();
});