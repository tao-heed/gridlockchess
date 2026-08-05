import type { CapacitorConfig } from '@capacitor/cli';

// Capacitor packaging config for the Android build.
// - `webDir: 'dist'` is the Vite build output that gets bundled into the .apk and served
//   locally by the WebView (offline by design — the app already works with no network).
// - `androidScheme: 'https'` (Capacitor default) serves the app from https://localhost, a
//   secure context, so the PWA service worker registers correctly inside the shell.
// - `backgroundColor` matches the app's gc-bg (#070a12) so there is no white flash before
//   the WebView paints.
const config: CapacitorConfig = {
  appId: 'io.github.b33zsm00th.gridlockchess',
  appName: 'Gridlock Chess',
  webDir: 'dist',
  backgroundColor: '#070a12',
  android: {
    backgroundColor: '#070a12',
  },
};

export default config;
