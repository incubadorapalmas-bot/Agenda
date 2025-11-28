// app.js - Agenda Incubadora IFPR/PMP
// Versão SEM Firebase Storage (fotos vão para o Firestore em base64, com compressão)

document.addEventListener("DOMContentLoaded", () => {
  const db = firebase.firestore();
  const { jsPDF } = window.jspdf;

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
  const formTituloModo = document.getElementById("formTituloModo");
  const btnSalvar = document.getElementById("btnSalvar");
  const btnCancelarEdicao = document.getElementById("btnCancelarEdicao");

  const fotosAtuaisWrapper = document.getElementById("fotosAtuaisWrapper");
  const fotosAtuaisDiv = document.getElementById("fotosAtuais");

  let eventosCache = [];
  let eventoEmEdicaoId = null;

  // ========= Helpers: compressão de imagem =========

  /**
   * Converte um File de imagem em dataURL comprimido.
   * Reduz resolução e qualidade para caber no limite de 1MB/doc do Firestore.
   */
  function fileToCompressedDataUrl(
    file,
    maxWidth = 1280,
    maxHeight = 720,
    quality = 0.6
  ) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onerror = () => reject(reader.error);
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
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
        };
        img.onerror = reject;
        img.src = reader.result;
      };

      reader.readAsDataURL(file);
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
        if (file.type.startsWith("image/")) {
          dataTransfer.items.add(file);
        }
      });

      fotosInput.files = dataTransfer.files;
      atualizarPreviewNovasFotos();
    });

    fotosInput.addEventListener("change", atualizarPreviewNovasFotos);
  }

  // ========= Preview das novas fotos (AGORA COM IMAGEM) =========

  function atualizarPreviewNovasFotos() {
    if (!novasFotosPreview) return;

    novasFotosPreview.innerHTML = "";
    const files = fotosInput.files;
    if (!files || !files.length) return;

    Array.from(files).forEach((file) => {
      if (!file.type.startsWith("image/")) return;

      const card = document.createElement("div");
      card.className = "foto-thumb";

      const img = document.createElement("img");
      img.className = "foto-thumb__img";
      img.alt = file.name;
      img.src = URL.createObjectURL(file);

      const legend = document.createElement("span");
      legend.textContent = file.name;

      card.appendChild(img);
      card.appendChild(legend);
      novasFotosPreview.appendChild(card);
    });
  }

  // ========= Helpers de formulário =========

  function toggleFormDisabled(flag) {
    const elements = form.querySelectorAll("input, select, textarea, button");
    elements.forEach((el) => (el.disabled = flag));
  }

  function limparFormulario() {
    form.reset();
    campoEventoId.value = "";
    eventoEmEdicaoId = null;

    if (novasFotosPreview) novasFotosPreview.innerHTML = "";
    if (fotosAtuaisDiv) fotosAtuaisDiv.innerHTML = "";
    fotosAtuaisWrapper.classList.add("oculto");

    formTituloModo.textContent = "Cadastrar novo evento";
    btnSalvar.textContent = "Salvar evento";
    btnCancelarEdicao.classList.add("oculto");
  }

  btnCancelarEdicao.addEventListener("click", () => {
    limparFormulario();
  });

  function preencherFormularioComEvento(ev) {
    document.getElementById("evento").value = ev.evento || "";
    document.getElementById("local").value = ev.local || "";
    document.getElementById("endereco").value = ev.endereco || "";
    document.getElementById("dataInicio").value = ev.dataInicio || "";
    document.getElementById("dataFim").value =
      ev.dataFim || ev.dataInicio || "";
    document.getElementById("horaInicio").value = ev.horaInicio || "";
    document.getElementById("horaFim").value = ev.horaFim || "";
    document.getElementById("formato").value = ev.formato || "Presencial";
    document.getElementById("participante").value = ev.participante || "";
    document.getElementById("pauta").value = ev.pauta || "";
    document.getElementById("comentario").value = ev.comentario || "";
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

  // ========= Fotos de um evento (já salvas) – MOSTRANDO IMAGEM =========

  async function carregarFotosDoEvento(idEvento) {
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

        card.appendChild(img);
        card.appendChild(caption);
        fotosAtuaisDiv.appendChild(card);
      });
    } catch (err) {
      console.error("Erro ao carregar fotos do evento", err);
    }
  }

  // ========= Abrir edição =========

  async function abrirEdicaoEvento(idEvento) {
    try {
      const evCache = eventosCache.find((e) => e.id === idEvento);
      let ev = evCache;

      if (!ev) {
        const doc = await db.collection("eventos").doc(idEvento).get();
        if (!doc.exists) {
          alert("Evento não encontrado.");
          return;
        }
        ev = { id: doc.id, ...doc.data() };
      }

      eventoEmEdicaoId = idEvento;
      campoEventoId.value = idEvento;

      preencherFormularioComEvento(ev);

      formTituloModo.textContent = "Editando evento";
      btnSalvar.textContent = "Atualizar evento";
      btnCancelarEdicao.classList.remove("oculto");

      await carregarFotosDoEvento(idEvento);

      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      console.error(err);
      alert("Erro ao carregar dados do evento para edição.");
    }
  }

  // ========= Salvar (criar/atualizar) evento + fotos =========

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const eventoTipo = document.getElementById("evento").value.trim();
    if (!eventoTipo) {
      alert("Informe o tipo de evento.");
      return;
    }

    const dataInicio = document.getElementById("dataInicio").value;
    const dataFimInput = document.getElementById("dataFim").value;
    const dataFim = dataFimInput || dataInicio;

    const docEvento = {
      evento: eventoTipo,
      local: document.getElementById("local").value.trim(),
      endereco: document.getElementById("endereco").value.trim(),
      dataInicio,
      dataFim,
      horaInicio: document.getElementById("horaInicio").value,
      horaFim: document.getElementById("horaFim").value,
      formato: document.getElementById("formato").value,
      participante: document.getElementById("participante").value.trim(),
      pauta: document.getElementById("pauta").value.trim(),
      comentario: document.getElementById("comentario").value.trim(),
      atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
    };

    try {
      toggleFormDisabled(true);

      let idEvento;

      if (eventoEmEdicaoId) {
        idEvento = eventoEmEdicaoId;
        await db.collection("eventos").doc(idEvento).update(docEvento);
      } else {
        docEvento.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
        const docRef = await db.collection("eventos").add(docEvento);
        idEvento = docRef.id;
      }

      // Upload novas fotos em base64 para subcoleção "fotos"
      const files = fotosInput.files;
      for (let file of files) {
        if (!file.type.startsWith("image/")) continue;

        const dataUrl = await fileToCompressedDataUrl(file);
        await db
          .collection("eventos")
          .doc(idEvento)
          .collection("fotos")
          .add({
            dataUrl,
            legenda: file.name,
            criadaEm: firebase.firestore.FieldValue.serverTimestamp(),
          });
      }

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
          "Se a imagem for muito pesada, tente tirar um print ou uma foto em resolução menor."
      );
    } finally {
      toggleFormDisabled(false);
    }
  });

  // ========= Carregar e listar eventos =========

  async function carregarEventos() {
    tabelaBody.innerHTML = "";
    eventosCache = [];

    try {
      let query = db.collection("eventos").orderBy("dataInicio", "asc");

      const de = filtroDe.value;
      const ate = filtroAte.value;

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
    tabelaBody.innerHTML = "";

    if (!eventosCache.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 10;
      td.textContent = "Nenhum evento encontrado para o filtro selecionado.";
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

      tr.innerHTML = `
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

      // Clique na linha inteira abre edição (menos nos botões)
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

  btnFiltrar.addEventListener("click", carregarEventos);

  btnLimparFiltro.addEventListener("click", () => {
    filtroDe.value = "";
    filtroAte.value = "";
    carregarEventos();
  });

  // ========= PDFs gerais (com fotos) – ESTILO EMPRESARIAL =========

  function obterDescricaoPeriodo() {
    if (!filtroDe.value && !filtroAte.value) {
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

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("INSTITUTO FEDERAL DO PARANÁ - CAMPUS PALMAS", 10, 12);

    doc.setFontSize(11);
    doc.text(
      "Incubadora IFPR / Prefeitura Municipal de Palmas",
      10,
      18
    );

    doc.setFontSize(10);
    doc.text(titulo, 10, 24);

    doc.setFont("helvetica", "normal");
    doc.text(`Emitido em: ${dataStr} às ${horaStr}`, 10, 30);
    doc.text(obterDescricaoPeriodo(), 10, 35);

    doc.setDrawColor(0, 143, 76);
    doc.setLineWidth(0.4);
    doc.line(10, 38, 200, 38);
  }

  // ========= Relatório completo – visão gerencial (COM FOTOS + BORDAS) =========

  async function gerarPdfCompleto() {
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
    doc.text("#", col.idx, y);
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
        doc.text("#", col.idx, y);
        doc.text("Data", col.data, y);
        doc.text("Tipo", col.tipo, y);
        doc.text("Local", col.local, y);
        doc.text("Participante", col.participante, y);
        doc.text("Formato", col.formato, y);
        y += 4;
        doc.setFont("helvetica", "normal");
      }

      const eventTop = y; // para borda

      const dataEv = ev.dataInicio || "";
      const tipoEv = ev.evento || "";
      const localEv = ev.local || "";
      const partEv = ev.participante || "";
      const formatoEv = ev.formato || "";

      doc.text(String(index + 1), col.idx, y);
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
            gerarCabecalhoCorporativo(doc, "Relatório Gerencial de Eventos");
            y = 44;
          }
        }
        if (tipoLines[i]) doc.text(tipoLines[i], col.tipo, y);
        if (localLines[i]) doc.text(localLines[i], col.local, y);
        if (partLines[i]) doc.text(partLines[i], col.participante, y);
        if (i === 0 && formatoEv) doc.text(formatoEv, col.formato, y);
      }

      y += 4;

      // Bloco de detalhes (estilo relatório de empresa)
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

      // ====== FOTOS DO EVENTO NO RELATÓRIO COMPLETO ======
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

      // Borda em volta do bloco do evento
      doc.setDrawColor(180);
      doc.setLineWidth(0.3);
      doc.rect(8, eventTop - 3, 194, eventBottom - eventTop + 6);

      y += 2; // espaçamento entre eventos
    }

    doc.save("relatorio-gerencial-eventos-incubadora.pdf");
  }

  // ========= Relatório simplificado (COM FOTOS + BORDAS) =========

  async function gerarPdfSimples() {
    const doc = new jsPDF("p", "mm", "a4");

    gerarCabecalhoCorporativo(doc, "Agenda Simplificada – Michelle");

    let y = 44;

    const cabecalhoSimples = () => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("#", 10, y);
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
        gerarCabecalhoCorporativo(doc, "Agenda Simplificada – Michelle");
        y = 44;
        cabecalhoSimples();
      }

      const eventTop = y;

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
          doc.text(String(index + 1), 10, y);
          doc.text(dataEv, 18, y);
        }
        if (eventoLines[i]) doc.text(eventoLines[i], 40, y);
        if (comentLines[i]) doc.text(comentLines[i], 125, y);
      }

      y += 5;

      // ====== FOTOS DO EVENTO NO RELATÓRIO SIMPLIFICADO ======
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

      // Borda em volta do bloco do evento
      doc.setDrawColor(180);
      doc.setLineWidth(0.3);
      doc.rect(8, eventTop - 3, 194, eventBottom - eventTop + 6);

      y += 3;
    }

    doc.save("agenda-simplificada-michelle.pdf");
  }

  // Botões de PDF (no cabeçalho) – agora chamando funções assíncronas
  btnPdfCompleto.addEventListener("click", async () => {
    if (!eventosCache.length) {
      alert("Não há eventos carregados para gerar o PDF.");
      return;
    }
    await gerarPdfCompleto();
  });

  btnPdfSimples.addEventListener("click", async () => {
    if (!eventosCache.length) {
      alert("Não há eventos carregados para gerar o PDF.");
      return;
    }
    await gerarPdfSimples();
  });

  // ========= PDF por evento com fotos (mantido) =========

  async function gerarPdfEventoComFotos(idEvento) {
    try {
      const docRef = await db.collection("eventos").doc(idEvento).get();
      if (!docRef.exists) {
        alert("Evento não encontrado.");
        return;
      }

      const ev = docRef.data();
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
