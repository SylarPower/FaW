/**
 * Config Web del progetto Firebase usato anche dagli altri giochi FaW.
 * Pong usa Realtime Database per le stanze online.
 */
export const firebaseConfig = {
  apiKey: "AIzaSyCNo7o2Ft22JDEyJ97BspE3Kur5DNAPKQc",
  authDomain: "funatwork-cd237.firebaseapp.com",
  databaseURL: "https://funatwork-cd237-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "funatwork-cd237",
  storageBucket: "funatwork-cd237.firebasestorage.app",
  messagingSenderId: "798226885203",
  appId: "1:798226885203:web:ce83f4d9e96b82266274a6"
};

export function isFirebaseConfigured() {
  return typeof firebaseConfig.apiKey === "string" &&
    firebaseConfig.apiKey.length > 8 &&
    !firebaseConfig.apiKey.startsWith("YOUR_");
}
