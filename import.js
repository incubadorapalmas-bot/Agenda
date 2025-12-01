// import.js - cria documentos de eventos a partir de AGENDA_SEED no Firestore
// Agora com idSequencial: mais novo = 1, mais antigo = último

(function () {
  const db = firebase.firestore();
  const btnImport = document.getElementById("btnImport");
  const btnDryRun = document.getElementById("btnDryRun");
  const logEl = document.getElementById("log");

  function log(msg) {
    const time = new Date().toLocaleTimeString();
    logEl.textContent += `[${time}] ${msg}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }

  async function importar({ dryRun = false } = {}) {
    if (!Array.isArray(AGENDA_SEED) || !AGENDA_SEED.length) {
      alert("AGENDA_SEED vazio. Verifique o arquivo seed_data.js.");
      return;
    }

    if (!dryRun) {
      const confirma = confirm(
        "Isso criará " +
          AGENDA_SEED.length +
          " documentos na coleção 'eventos'. Continuar?"
      );
      if (!confirma) return;
    }

    btnImport.disabled = true;
    btnDryRun.disabled = true;

    log(
      (dryRun ? "Simulação" : "Importação") +
        " iniciada. Total de registros: " +
        AGENDA_SEED.length
    );

    // 🔹 1) Ordenar do mais novo para o mais antigo usando dataInicio
    const eventosOrdenados = [...AGENDA_SEED].sort((a, b) => {
      const ta = a.dataInicio ? new Date(a.dataInicio).getTime() : 0;
      const tb = b.dataInicio ? new Date(b.dataInicio).getTime() : 0;
      // mais novo primeiro
      return tb - ta;
    });

    let count = 0;
    for (const ev of eventosOrdenados) {
      count++;

      // 🔹 2) Gerar ID sequencial: mais novo = 1, mais antigo = total
      const idSequencial = count;

      if (dryRun) {
        log(
          "Simulando registro " +
            count +
            " (idSequencial=" +
            idSequencial +
            "): " +
            (ev.dataInicio || "") +
            " - " +
            (ev.evento || "")
        );
        continue;
      }

      try {
        await db.collection("eventos").add({
          ...ev,
          idSequencial: idSequencial, // 🔹 3) ID numérico gravado no Firestore
          criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
          atualizadoEm: firebase.firestore.FieldValue.serverTimestamp()
        });
        log(
          "Importado " +
            count +
            "/" +
            eventosOrdenados.length +
            " (idSequencial=" +
            idSequencial +
            ")"
        );
      } catch (err) {
        console.error(err);
        log("ERRO no registro " + count + ": " + err.message);
      }
    }

    log((dryRun ? "Simulação" : "Importação") + " finalizada.");
    btnImport.disabled = false;
    btnDryRun.disabled = false;
  }

  btnImport.addEventListener("click", () => importar({ dryRun: false }));
  btnDryRun.addEventListener("click", () => importar({ dryRun: true }));
})();
