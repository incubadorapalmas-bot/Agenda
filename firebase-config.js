// firebase-config.js
// ======================================================
// 1. Crie um projeto no Firebase (console.firebase.google.com)
// 2. Ative Firestore Database e Storage
// 3. Copie aqui o objeto de configuração do seu app Web
//    (Configurações do projeto -> Seus apps -> SDK setup & config)
// 4. NÃO compartilhe essas chaves em público.
// ======================================================

// EXEMPLO **NÃO FUNCIONAL** (substitua pelos seus dados):
const firebaseConfig = {
  apiKey: "AIzaSyCdJ5mYgSWfzbNjtIuug-aKSgOvi5xtUd0",
  authDomain: "agenda-incubadora-ifpr.firebaseapp.com",
  projectId: "agenda-incubadora-ifpr",
  storageBucket: "agenda-incubadora-ifpr.firebasestorage.app",
  messagingSenderId: "258755950142",
  appId: "1:258755950142:web:7d6d8b5106383b4c94436f",
  measurementId: "G-TCM527B5M7"
};

// Inicializa Firebase (não altere abaixo)
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
