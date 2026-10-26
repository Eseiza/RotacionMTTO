/* ══════════════════════════════════════════════════════════
   FIREBASE — configuración de la app Planning
   Misma base que Parte Diario: colección "planning", doc "config".
   Si querés una base propia, pegá acá el firebaseConfig del nuevo proyecto.
══════════════════════════════════════════════════════════ */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDbBxPETjXIQj6GnsYPId3BeXSPB52EFJs",
  authDomain: "rotacionmtto.firebaseapp.com",
  databaseURL: "https://rotacionmtto-default-rtdb.firebaseio.com",
  projectId: "rotacionmtto",
  storageBucket: "rotacionmtto.firebasestorage.app",
  messagingSenderId: "761356173402",
  appId: "1:761356173402:web:5b8e3e168d621214cbd863",
  measurementId: "G-00LT1PK9LB"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

export const COL = 'planning';
export const DOC_ID = 'config';

/* ══ USUARIOS ══ (mismo esquema que la app de Calidad)
   role 'admin'        → crea grupos, personas, excepciones y maneja las rotaciones
   role 'visualizador' → solo ve el calendario                                        */
export const USERS = {
  "admin":  { password: "cin>>Eszenay7;", role: "admin",        nombre: "Administrador" },
  "Sergio": { password: "Admin.1124",     role: "admin",        nombre: "Sergio" },
  "mtto":   { password: "mtto.123",       role: "visualizador", nombre: "Mtto" }
};

// El usuario no distingue mayúsculas (Sergio = sergio)
export const buscarUsuario = nombre => {
  const n = String(nombre).trim();
  if (USERS[n]) return USERS[n];
  const k = Object.keys(USERS).find(x => x.toLowerCase() === n.toLowerCase());
  return k ? USERS[k] : null;
};
