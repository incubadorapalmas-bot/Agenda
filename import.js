// import.js - cria documentos de eventos a partir de AGENDA_SEED no Firestore

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

    let count = 0;
    for (const ev of AGENDA_SEED) {
      count++;

      if (dryRun) {
        log("Simulando registro " + count + ": " + (ev.dataInicio || "") + " - " + (ev.evento || ""));
        continue;
      }

      try {
        await db.collection("eventos").add({
          ...ev,
          criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
          atualizadoEm: firebase.firestore.FieldValue.serverTimestamp()
        });
        log("Importado " + count + "/" + AGENDA_SEED.length);
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
