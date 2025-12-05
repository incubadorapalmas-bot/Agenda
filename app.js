// app.js - Agenda Incubadora IFPR/PMP
// Versão final solicitada: lista com a data mais recente primeiro (order desc),
// mas os códigos (campo `codigo`) são renumerados conforme a data (mais antigo = 1,
// mais recente = N). Após criar/atualizar evento, o sistema renumera todos os eventos
// com base na data e recarrega a lista — assim o evento mais recente sempre terá o maior código.
//
// Observação: renumeração atualiza todos os documentos e pode consumir muitas gravações em Firestore
// se você tiver muitos documentos. Use com cuidado no plano gratuito. Se preferir, comente a chamada
// a renumerarEventosCodigoSequencial() após salvar.

document.addEventListener("DOMContentLoaded", () => {
  // ========= INICIALIZAÇÃO jsPDF (mais robusto) =========
  const jsPDF =
    (window.jspdf && window.jspdf.jsPDF) || window.jsPDF || null;

  if (!jsPDF) {
    console.error(
      "jsPDF não encontrado. Verifique se o script do jsPDF está incluído ANTES do app.js."
    );
  }

  // ========= Firestore =========
  if (typeof firebase === "undefined" || !firebase.firestore) {
    console.error(
      "Firebase Firestore não encontrado. Verifique se os scripts do Firebase foram incluídos corretamente."
    );
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
        return;
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
          // commit parcial e reinicia batch
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

      // Opcional: notificar usuário (pode ser desativado se ficar incômodo)
      // alert("Renumeração concluída. Eventos numerados de 1 até " + (codigo - 1));
    } catch (err) {
      console.error("Erro ao renumerar eventos:", err);
      alert("Erro ao renumerar eventos. Veja o console (F12).");
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

      snap.forEach((docFoto) => {
        const { dataUrl, url, legenda } = docFoto.data();
        const src = dataUrl || url || "";
        if (!src) return;
        fotos.push({ src, legenda: legenda || "" });
      });
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

      snap.forEach((docFoto) => {
        const { dataUrl, url, legenda } = docFoto.data();
        const src = dataUrl || url || "";
        if (!src) return;

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
      });
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

        // Upload novas fotos em base64 (com conversão HEIC -> JPG)
        if (fotosInput && fotosInput.files && fotosInput.files.length) {
          for (let file of fotosInput.files) {
            if (
              !file.type.startsWith("image/") &&
              !isHeicFile(file)
            )
              continue;

            try {
              const dataUrl = await fileToCompressedDataUrl(file);
              await db
                .collection("eventos")
                .doc(idEvento)
                .collection("fotos")
                .add({
                  dataUrl,
                  legenda: file.name,
                  criadaEm:
                    firebase.firestore.FieldValue.serverTimestamp(),
                });
            } catch (errImg) {
              console.error("Erro ao processar imagem:", file.name, errImg);
              alert(
                "Erro ao processar a imagem '" +
                  file.name +
                  "'. Se for HEIC, tente exportar para JPG/PNG no celular ou computador."
              );
            }
          }
        }

        // Agora renumerar todos os eventos conforme a data (mais antigo = 1, mais recente = N)
        // Assim garantimos que o evento mais recente terá o maior código.
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

  // ========= Carregar e listar eventos =========
  async function carregarEventos() {
    if (!tabelaBody) return;

    tabelaBody.innerHTML = "";
    eventosCache = [];

    try {
      // Por padrão traz os eventos mais recentes primeiro (desc) para exibição
      // (o campo 'codigo' será tal que o mais recente possui o maior número)
      const orderParam = (new URLSearchParams(location.search).get("order") || "").toLowerCase();
      const order = orderParam === "asc" ? "asc" : "desc"; // default = desc (mais recente primeiro)

      let query = db.collection("eventos").orderBy("dataInicio", order);

      const de = filtroDe?.value;
      const ate = filtroAte?.value;

      if (de) query = query.where("dataInicio", ">=", de);
      if (ate) query = query.where("dataInicio", "<=", ate);

      const snap = await query.get();

      snap.forEach((doc) => {
        const ev = doc.data();
        const id = doc.id;
        eventosCache.push({ id, ...ev });
      });

      renderTabela();
    } catch (err) {
      console.error(err);
      alert("Erro ao carregar eventos.\nVerifique o console.");
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

  // ========= Funções para PDFs (mantive as suas versões anteriores) =========

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

  async function gerarPdfCompleto() {
    if (!jsPDF) {
      alert("jsPDF não foi carregado. Verifique os scripts.");
      return;
    }

    const doc = new jsPDF("p", "mm", "a4");

    gerarCabecalhoCorporativo(doc, "Relatório Gerencial de Eventos");

    let y = 44;
    const col = {
      idx: 10,
      data: 18,
      tipo: 35,
      local: 80,
      participante: 130,
      formato: 180,
    };

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("ID", col.idx, y);
    doc.text("Data", col.data, y);
    doc.text("Tipo", col.tipo, y);
    doc.text("Local", col.local, y);
    doc.text("Participante", col.participante, y);
    doc.text("Formato", col.formato, y);

    y += 4;
    doc.setFont("helvetica", "normal");

    for (let index = 0; index < eventosCache.length; index++) {
      const ev = eventosCache[index];

      if (y > 270) {
        doc.addPage();
        gerarCabecalhoCorporativo(doc, "Relatório Gerencial de Eventos");
        y = 44;

        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.text("ID", col.idx, y);
        doc.text("Data", col.data, y);
        doc.text("Tipo", col.tipo, y);
        doc.text("Local", col.local, y);
        doc.text("Participante", col.participante, y);
        doc.text("Formato", col.formato, y);
        y += 4;
        doc.setFont("helvetica", "normal");
      }

      const eventTop = y;

      const displayId =
        ev.codigo !== undefined && ev.codigo !== null
          ? ev.codigo
          : ev.idSequencial !== undefined && ev.idSequencial !== null
          ? ev.idSequencial
          : "";

      const dataEv = ev.dataInicio || "";
      const tipoEv = ev.evento || "";
      const localEv = ev.local || "";
      const partEv = ev.participante || "";
      const formatoEv = ev.formato || "";

      doc.text(String(displayId), col.idx, y);
      doc.text(dataEv, col.data, y);

      const tipoLines = doc.splitTextToSize(tipoEv, col.local - col.tipo - 2);
      const localLines = doc.splitTextToSize(
        localEv,
        col.participante - col.local - 2
      );
      const partLines = doc.splitTextToSize(
        partEv,
        col.formato - col.participante - 2
      );

      const maxLines = Math.max(
        tipoLines.length,
        localLines.length,
        partLines.length
      );

      for (let i = 0; i < maxLines; i++) {
        if (i > 0) {
          y += 4;
          if (y > 270) {
            doc.addPage();
            gerarCabecalhoCorporativo(
              doc,
              "Relatório Gerencial de Eventos"
            );
            y = 44;

            doc.setFont("helvetica", "bold");
            doc.setFontSize(9);
            doc.text("ID", col.idx, y);
            doc.text("Data", col.data, y);
            doc.text("Tipo", col.tipo, y);
            doc.text("Local", col.local, y);
            doc.text("Participante", col.participante, y);
            doc.text("Formato", col.formato, y);
            y += 4;
            doc.setFont("helvetica", "normal");
          }
        }
        if (tipoLines[i]) doc.text(tipoLines[i], col.tipo, y);
        if (localLines[i]) doc.text(localLines[i], col.local, y);
        if (partLines[i]) doc.text(partLines[i], col.participante, y);
        if (i === 0 && formatoEv) doc.text(formatoEv, col.formato, y);
      }

      y += 4;

      const horarioStr =
        (ev.horaInicio || "") + (ev.horaFim ? " - " + ev.horaFim : "");
      const dataFimStr =
        ev.dataFim && ev.dataFim !== ev.dataInicio
          ? ` até ${ev.dataFim}`
          : "";
      const enderecoStr = ev.endereco || "";
      const pautaStr = ev.pauta || "";
      const comentarioStr = ev.comentario || "";

      const detalhes = [];

      if (ev.dataInicio) {
        detalhes.push(`Período: ${ev.dataInicio}${dataFimStr}`);
      }
      if (horarioStr.trim()) detalhes.push(`Horário: ${horarioStr}`);
      if (enderecoStr) detalhes.push(`Endereço: ${enderecoStr}`);
      if (pautaStr) detalhes.push(`Pauta: ${pautaStr}`);
      if (comentarioStr) detalhes.push(`Comentário: ${comentarioStr}`);

      if (detalhes.length) {
        const bloco = doc.splitTextToSize(detalhes.join(" | "), 180);
        doc.setFontSize(8);

        bloco.forEach((linha) => {
          if (y > 275) {
            doc.addPage();
            gerarCabecalhoCorporativo(
              doc,
              "Relatório Gerencial de Eventos"
            );
            y = 44;
          }
          doc.text(linha, 14, y);
          y += 3;
        });

        doc.setFontSize(9);
        y += 2;
      }

      const fotos = await getFotosEvento(ev.id);
      if (fotos.length) {
        if (y > 270) {
          doc.addPage();
          gerarCabecalhoCorporativo(doc, "Relatório Gerencial de Eventos");
          y = 44;
        }

        doc.setFontSize(8);
        doc.text("Fotos:", 14, y);
        y += 4;

        const thumbWidth = 35;
        const thumbHeight = 26;
        let x = 14;
        let count = 0;

        for (const foto of fotos) {
          if (y + thumbHeight > 275) {
            doc.addPage();
            gerarCabecalhoCorporativo(
              doc,
              "Relatório Gerencial de Eventos"
            );
            y = 44;
            x = 14;
          }

          try {
            doc.addImage(foto.src, "JPEG", x, y, thumbWidth, thumbHeight);
          } catch (err) {
            console.warn("Erro ao adicionar imagem no PDF completo", err);
          }

          if (foto.legenda) {
            doc.setFontSize(6);
            const legLines = doc.splitTextToSize(
              foto.legenda,
              thumbWidth
            );
            doc.text(legLines, x, y + thumbHeight + 3);
            doc.setFontSize(8);
          }

          x += thumbWidth + 4;
          count++;

          if (count % 4 === 0) {
            x = 14;
            y += thumbHeight + 10;
          }
        }

        if (count % 4 !== 0) {
          y += thumbHeight + 10;
        }
      }

      const eventBottom = y;

      doc.setDrawColor(180);
      doc.setLineWidth(0.3);
      doc.rect(8, eventTop - 3, 194, eventBottom - eventTop + 6);

      y += 2;
    }

    doc.save("relatorio-gerencial-eventos-incubadora.pdf");
  }

  async function gerarPdfSimples() {
    if (!jsPDF) {
      alert("jsPDF não foi carregado. Verifique os scripts.");
      return;
    }

    const doc = new jsPDF("p", "mm", "a4");

    gerarCabecalhoCorporativo(doc, "Agenda Simplificada – Michelle");

    let y = 44;

    const cabecalhoSimples = () => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("ID", 10, y);
      doc.text("Data", 18, y);
      doc.text("Evento / Local", 40, y);
      doc.text("Comentário", 125, y);
      y += 4;
      doc.setFont("helvetica", "normal");
    };

    cabecalhoSimples();

    for (let index = 0; index < eventosCache.length; index++) {
      const ev = eventosCache[index];

      if (y > 275) {
        doc.addPage();
        gerarCabecalhoCorporativo(
          doc,
          "Agenda Simplificada – Michelle"
        );
        y = 44;
        cabecalhoSimples();
      }

      const eventTop = y;

      const displayId =
        ev.codigo !== undefined && ev.codigo !== null
          ? ev.codigo
          : ev.idSequencial !== undefined && ev.idSequencial !== null
          ? ev.idSequencial
          : "";

      const dataEv = ev.dataInicio || "";
      const linhaEvento = `${ev.evento || ""}${
        ev.local ? " - " + ev.local : ""
      }`;
      const comentario = ev.comentario || "";

      const eventoLines = doc.splitTextToSize(linhaEvento, 80);
      const comentLines = doc.splitTextToSize(comentario, 75);
      const maxLines = Math.max(eventoLines.length, comentLines.length);

      for (let i = 0; i < maxLines; i++) {
        if (i > 0) {
          y += 4;
          if (y > 275) {
            doc.addPage();
            gerarCabecalhoCorporativo(
              doc,
              "Agenda Simplificada – Michelle"
            );
            y = 44;
            cabecalhoSimples();
          }
        }

        if (i === 0) {
          doc.text(String(displayId), 10, y);
          doc.text(dataEv, 18, y);
        }
        if (eventoLines[i]) doc.text(eventoLines[i], 40, y);
        if (comentLines[i]) doc.text(comentLines[i], 125, y);
      }

      y += 5;

      const fotos = await getFotosEvento(ev.id);
      if (fotos.length) {
        if (y > 270) {
          doc.addPage();
          gerarCabecalhoCorporativo(
            doc,
            "Agenda Simplificada – Michelle"
          );
          y = 44;
          cabecalhoSimples();
        }

        doc.setFontSize(8);
        doc.text("Fotos:", 14, y);
        y += 4;

        const thumbWidth = 35;
        const thumbHeight = 26;
        let x = 14;
        let count = 0;

        for (const foto of fotos) {
          if (y + thumbHeight > 275) {
            doc.addPage();
            gerarCabecalhoCorporativo(
              doc,
              "Agenda Simplificada – Michelle"
            );
            y = 44;
            cabecalhoSimples();
            x = 14;
          }

          try {
            doc.addImage(foto.src, "JPEG", x, y, thumbWidth, thumbHeight);
          } catch (err) {
            console.warn("Erro ao adicionar imagem no PDF simples", err);
          }

          if (foto.legenda) {
            doc.setFontSize(6);
            const legLines = doc.splitTextToSize(
              foto.legenda,
              thumbWidth
            );
            doc.text(legLines, x, y + thumbHeight + 3);
            doc.setFontSize(8);
          }

          x += thumbWidth + 4;
          count++;

          if (count % 4 === 0) {
            x = 14;
            y += thumbHeight + 10;
          }
        }

        if (count % 4 !== 0) {
          y += thumbHeight + 10;
        }
      }

      const eventBottom = y;

      doc.setDrawColor(180);
      doc.setLineWidth(0.3);
      doc.rect(8, eventTop - 3, 194, eventBottom - eventTop + 6);

      y += 3;
    }

    doc.save("agenda-simplificada-michelle.pdf");
  }

  if (btnPdfCompleto) {
    btnPdfCompleto.addEventListener("click", async () => {
      if (!eventosCache.length) {
        alert("Não há eventos carregados para gerar o PDF.");
        return;
      }
      await gerarPdfCompleto();
    });
  }

  if (btnPdfSimples) {
    btnPdfSimples.addEventListener("click", async () => {
      if (!eventosCache.length) {
        alert("Não há eventos carregados para gerar o PDF.");
        return;
      }
      await gerarPdfSimples();
    });
  }

  async function gerarPdfEventoComFotos(idEvento) {
    if (!jsPDF) {
      alert("jsPDF não foi carregado. Verifique os scripts.");
      return;
    }

    try {
      const docRef = await db.collection("eventos").doc(idEvento).get();
      if (!docRef.exists) {
        alert("Evento não encontrado.");
        return;
      }

      const ev = docRef.data();

      const cacheEv = eventosCache.find((e) => e.id === idEvento);
      const codigoEvento =
        (cacheEv &&
        cacheEv.codigo !== undefined &&
        cacheEv.codigo !== null
          ? cacheEv.codigo
          : null) ??
        (ev.codigo !== undefined && ev.codigo !== null ? ev.codigo : null) ??
        (cacheEv &&
        cacheEv.idSequencial !== undefined &&
        cacheEv.idSequencial !== null
          ? cacheEv.idSequencial
          : null) ??
        null;

      const fotosSnap = await db
        .collection("eventos")
        .doc(idEvento)
        .collection("fotos")
        .get();

      const doc = new jsPDF("p", "mm", "a4");

      doc.setFontSize(14);
      doc.text("Relatório do Evento", 10, 10);

      doc.setFontSize(10);
      let y = 18;

      const infos = [
        codigoEvento != null ? `ID do evento: ${codigoEvento}` : null,
        `Evento: ${ev.evento || ""}`,
        `Data: ${ev.dataInicio || ""}${
          ev.dataFim && ev.dataFim !== ev.dataInicio
            ? " até " + ev.dataFim
            : ""
        }`,
        `Horário: ${
          (ev.horaInicio || "") + (ev.horaFim ? " - " + ev.horaFim : "")
        }`,
        `Local: ${ev.local || ""}`,
        `Endereço: ${ev.endereco || ""}`,
        ev.participante
          ? `Participante/responsável: ${ev.participante}`
          : "",
        ev.pauta ? `Pauta: ${ev.pauta}` : "",
        ev.comentario ? `Comentário: ${ev.comentario}` : "",
      ].filter(Boolean);

      infos.forEach((linha) => {
        if (y > 275) {
          doc.addPage();
          y = 10;
        }
        const textLines = doc.splitTextToSize(linha, 190);
        doc.text(textLines, 10, y);
        y += textLines.length * 5;
      });

      if (!fotosSnap.empty) {
        y += 5;
        doc.setFontSize(11);
        doc.text("Fotos do evento:", 10, y);
        y += 5;
      }

      for (const fotoDoc of fotosSnap.docs) {
        const { dataUrl, url, legenda } = fotoDoc.data();
        const src = dataUrl || url;
        if (!src) continue;

        if (y > 200) {
          doc.addPage();
          y = 10;
        }

        try {
          doc.addImage(src, "JPEG", 10, y, 80, 60);
        } catch (err) {
          console.warn("Erro ao adicionar imagem no PDF de evento", err);
        }

        if (legenda) {
          doc.setFontSize(9);
          doc.text(doc.splitTextToSize(legenda, 80), 10, y + 63);
        }

        y += 70;
      }

      const nomeArquivo =
        "evento-" +
        (ev.dataInicio || "sem-data") +
        "-" +
        (ev.evento || "sem-nome") +
        ".pdf";

      doc.save(nomeArquivo.replace(/\s+/g, "-"));
    } catch (err) {
      console.error(err);
      alert("Erro ao gerar PDF do evento.\nVerifique o console.");
    }
  }

  // ========= Inicialização =========
  carregarEventos();
});