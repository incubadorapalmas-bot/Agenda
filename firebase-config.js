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
  apiKey: "SUA_API_KEY",
  authDomain: "seu-projeto.firebaseapp.com",
  projectId: "seu-projeto",
  storageBucket: "seu-projeto.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:0000000000000000"
};

// Inicializa Firebase (não altere abaixo)
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
