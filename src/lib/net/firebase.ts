// lib/net/firebase.ts — Firebase app singleton.
//
// Initialises the Firebase app from VITE_FIREBASE_* env vars, exports the
// Realtime Database and Auth instances used by useUplink and useOnlinePresence.
// signInAnonymously() is called once at import time — fire-and-forget. This is
// NOT a render gate: if auth fails (no network on first launch) the app renders
// normally; only Uplink features are unavailable. Auth readiness is checked
// lazily in useUplink.ts before any room operation.
import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';
import { getAuth, signInAnonymously } from 'firebase/auth';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL:       import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

const app  = initializeApp(firebaseConfig);
export const db   = getDatabase(app);
export const auth = getAuth(app);

// Sign in anonymously — gives every device a stable uid for Security Rules.
// Error is intentionally swallowed: offline devices still use the rest of the app.
signInAnonymously(auth).catch(() => {});
