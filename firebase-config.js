// firebase-config.js
// Configuração do projeto Agenda Incubadora IFPR (sem storageBucket para não requerer upgrade)

const firebaseConfig = {
  apiKey: "AIzaSyCdJ5mYgSWfzbNjtIuug-aKSgOvi5xtUd0",
  authDomain: "agenda-incubadora-ifpr.firebaseapp.com",
  projectId: "agenda-incubadora-ifpr",
  // storageBucket removido de propósito para não exigir upgrade.
  messagingSenderId: "258755950142",
  appId: "1:258755950142:web:7d6d8b5106383b4c94436f",
  measurementId: "G-TCM527B5M7" // opcional: remova se não usar Analytics
};

(function initFirebase() {
  if (typeof firebase === 'undefined') {
    console.error('Firebase SDK não encontrado. Carregue firebase-app.js antes de firebase-config.js');
    return;
  }

  try {
    if (!firebase.apps || firebase.apps.length === 0) {
      firebase.initializeApp(firebaseConfig);
      console.info('Firebase inicializado (sem storageBucket).');
      // Inicializa Analytics só se a biblioteca de analytics for carregada
      if (firebase.analytics && typeof firebase.analytics === 'function') {
        try { firebase.analytics(); } catch (e) { console.warn('Analytics não inicializado:', e); }
      }
    } else {
      console.info('Firebase já estava inicializado.');
    }
  } catch (err) {
    console.error('Erro ao inicializar Firebase:', err);
  }
})();