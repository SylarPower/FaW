/**
 * Incolla qui la config Web del tuo progetto Firebase.
 * Console → Impostazioni progetto → Le tue app → SDK snippiet.
 * Serve Realtime Database (non solo Firestore).
 *
 * Finché apiKey inizia con YOUR_ il gioco resta in locale
 * (vs CPU e triangolo vs 2 CPU). Online si attiva da solo.
 */
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "000000000000",
  appId: "YOUR_APP_ID"
};

export function isFirebaseConfigured() {
  return typeof firebaseConfig.apiKey === "string" &&
    firebaseConfig.apiKey.length > 8 &&
    !firebaseConfig.apiKey.startsWith("YOUR_");
}
