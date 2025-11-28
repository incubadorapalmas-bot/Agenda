// app.js - lógica da Agenda Incubadora IFPR/PMP

// Espera o DOM carregar
document.addEventListener("DOMContentLoaded", () => {
  const db = firebase.firestore();
  const storage = firebase.storage();
  const { jsPDF } = window.jspdf;

  // Referências de elementos
  const form = document.getElementById("eventoForm");
  const fotosInput = document.getElementById("fotos");
  const filtroDe = document.getElementById("filtroDe");
  const filtroAte = document.getElementById("filtroAte");
  const btnFiltrar = document.getElementById("btnFiltrar");
  const btnLimparFiltro = document.getElementById("btnLimparFiltro");
  const btnPdfCompleto = document.getElementById("btnPdfCompleto");
  const btnPdfSimples = document.getElementById("btnPdfSimples");
  const tabelaBody = document.querySelector("#tabelaEventos tbody");

  // Cache local dos eventos carregados (para PDFs)
  let eventosCache = [];

  // ---------- Função: salvar evento ----------
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const evento = document.getElementById("evento").value.trim();
    if (!evento) {
      alert("Informe o tipo de evento.");
      return;
    }

    const dataInicio = document.getElementById("dataInicio").value;
    const dataFimInput = document.getElementById("dataFim").value;
    const dataFim = dataFimInput || dataInicio;

    const docEvento = {
      evento,
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
      criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      atualizadoEm: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
      // Desabilita botões enquanto grava
      toggleFormDisabled(true);

      // Cria o documento do evento
      const docRef = await db.collection("eventos").add(docEvento);

      // Upload das fotos (se houver)
      const files = fotosInput.files;
      for (let file of files) {
        const storageRef = storage.ref(`eventos/${docRef.id}/${file.name}`);
        const snapshot = await storageRef.put(file);
        const url = await snapshot.ref.getDownloadURL();

        await db
          .collection("eventos")
          .doc(docRef.id)
          .collection("fotos")
          .add({
            url,
            legenda: file.name,
            criadaEm: firebase.firestore.FieldValue.serverTimestamp()
          });
      }

      alert("Evento salvo com sucesso!");
      form.reset();
      await carregarEventos(); // atualiza tabela
    } catch (err) {
      console.error(err);
      alert("Erro ao salvar o evento. Verifique o console.");
    } finally {
      toggleFormDisabled(false);
    }
  });

  function toggleFormDisabled(flag) {
    const elements = form.querySelectorAll("input, select, textarea, button");
    elements.forEach((el) => (el.disabled = flag));
  }

  // ---------- Função: carregar eventos ----------
  async function carregarEventos() {
    tabelaBody.innerHTML = "";
    eventosCache = [];

    try {
      let query = db.collection("eventos").orderBy("dataInicio", "asc");

      const de = filtroDe.value;
      const ate = filtroAte.value;

      // Filtros simples por data
      if (de) {
        query = query.where("dataInicio", ">=", de);
      }
      if (ate) {
        query = query.where("dataInicio", "<=", ate);
      }

      const snap = await query.get();

      snap.forEach((doc) => {
        const ev = doc.data();
        const id = doc.id;
        eventosCache.push({ id, ...ev });
      });

      renderTabela();
    } catch (err) {
      console.error(err);
      alert("Erro ao carregar eventos. Verifique o console.");
    }
  }

  // ---------- Função: desenhar tabela ----------
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
          <button class="btn secundario btn-pdf-evento" data-id="${ev.id}">
            PDF + fotos
          </button>
        </td>
      `;

      tabelaBody.appendChild(tr);
    });

    // Liga eventos dos botões de PDF por evento
    document
      .querySelectorAll(".btn-pdf-evento")
      .forEach((btn) =>
        btn.addEventListener("click", () =>
          gerarPdfEventoComFotos(btn.getAttribute("data-id"))
        )
      );
  }

  // ---------- Filtros ----------
  btnFiltrar.addEventListener("click", carregarEventos);

  btnLimparFiltro.addEventListener("click", () => {
    filtroDe.value = "";
    filtroAte.value = "";
    carregarEventos();
  });

  // ---------- PDFs gerais ----------
  btnPdfCompleto.addEventListener("click", () => {
    if (!eventosCache.length) {
      alert("Não há eventos carregados para gerar o PDF.");
      return;
    }
    gerarPdfCompleto();
  });

  btnPdfSimples.addEventListener("click", () => {
    if (!eventosCache.length) {
      alert("Não há eventos carregados para gerar o PDF.");
      return;
    }
    gerarPdfSimples();
  });

  function gerarPdfCompleto() {
    const doc = new jsPDF("p", "mm", "a4");
    doc.setFontSize(14);
    doc.text("Relatório Completo - Agenda Incubadora IFPR/PMP", 10, 10);

    doc.setFontSize(9);
    let y = 18;

    eventosCache.forEach((ev, index) => {
      if (y > 275) {
        doc.addPage();
        y = 10;
      }

      const linha1 = `${index + 1}. ${ev.dataInicio || ""}  |  ${
        ev.evento || ""
      }  |  ${ev.local || ""}`;
      const linha2 = `Horário: ${(ev.horaInicio || "") + (ev.horaFim ? " - " + ev.horaFim : "")
      }  |  Formato: ${ev.formato || ""}`;
      const linha3 = `Participante: ${ev.participante || ""}`;
      const linha4 = `Pauta: ${ev.pauta || ""}`;
      const linha5 = `Comentário: ${ev.comentario || ""}`;

      doc.text(linha1, 10, y);
      y += 4;
      doc.text(linha2, 10, y);
      y += 4;
      if (ev.participante) {
        doc.text(linha3, 10, y);
        y += 4;
      }
      if (ev.pauta) {
        doc.text(linha4, 10, y);
        y += 4;
      }
      if (ev.comentario) {
        const textLines = doc.splitTextToSize(linha5, 190);
        doc.text(textLines, 10, y);
        y += textLines.length * 4;
      }
      y += 3;
    });

    doc.save("relatorio-completo-agenda-incubadora.pdf");
  }

  function gerarPdfSimples() {
    const doc = new jsPDF("p", "mm", "a4");
    doc.setFontSize(14);
    doc.text("Agenda Simplificada - Michelle", 10, 10);

    doc.setFontSize(9);
    let y = 18;

    eventosCache.forEach((ev, index) => {
      if (y > 280) {
        doc.addPage();
        y = 10;
      }

      const linha = `${index + 1}. ${ev.dataInicio || ""}  |  ${
        ev.evento || ""
      }  |  ${ev.local || ""}`;
      doc.text(linha, 10, y);
      y += 4;

      if (ev.comentario) {
        const linhaComent = `Comentário: ${ev.comentario}`;
        const textLines = doc.splitTextToSize(linhaComent, 190);
        doc.text(textLines, 10, y);
        y += textLines.length * 4;
      }

      y += 3;
    });

    doc.save("agenda-simplificada-michelle.pdf");
  }

  // ---------- PDF por evento com fotos ----------
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
        `Data: ${ev.dataInicio || ""} ${
          ev.dataFim && ev.dataFim !== ev.dataInicio ? " até " + ev.dataFim : ""
        }`,
        `Horário: ${(ev.horaInicio || "") + (ev.horaFim ? " - " + ev.horaFim : "")
        }`,
        `Local: ${ev.local || ""}`,
        `Endereço: ${ev.endereco || ""}`,
        ev.participante ? `Participante/responsável: ${ev.participante}` : "",
        ev.pauta ? `Pauta: ${ev.pauta}` : "",
        ev.comentario ? `Comentário: ${ev.comentario}` : ""
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
        const { url, legenda } = fotoDoc.data();
        const dataUrl = await urlToDataUrl(url);

        // Se passar do limite da página, cria outra
        if (y > 200) {
          doc.addPage();
          y = 10;
        }

        // Adiciona imagem (80mm largura, altura proporcional aproximada)
        doc.addImage(dataUrl, "JPEG", 10, y, 80, 60);
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
      alert("Erro ao gerar PDF do evento. Verifique o console.");
    }
  }

  // Converte URL de imagem em DataURL (base64) para o jsPDF
  async function urlToDataUrl(url) {
    const response = await fetch(url);
    const blob = await response.blob();

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // Carrega os eventos na primeira vez
  carregarEventos();
});
