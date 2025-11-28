// firebase-config.js
// Configuração do projeto Agenda Incubadora IFPR

const firebaseConfig = {
  apiKey: "AIzaSyCdJ5mYgSWfzbNjtIuug-aKSgOvi5xtUd0",
  authDomain: "agenda-incubadora-ifpr.firebaseapp.com",
  projectId: "agenda-incubadora-ifpr",
  storageBucket: "agenda-incubadora-ifpr.firebasestorage.app",
  messagingSenderId: "258755950142",
  appId: "1:258755950142:web:7d6d8b5106383b4c94436f",
  measurementId: "G-TCM527B5M7"
};

// Inicializa Firebase usando SDK compat
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
