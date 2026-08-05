import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import mdx from '@mdx-js/rollup';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import license from 'rollup-plugin-license';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    // MDX must run BEFORE @vitejs/plugin-react so the JSX it emits is handed to
    // React's Babel pipeline (incl. the React Compiler). `providerImportSource`
    // wires up <MDXProvider> so authored docs inherit our styled components.
    {
      enforce: 'pre',
      ...mdx({
        remarkPlugins: [remarkGfm],
        rehypePlugins: [rehypeSlug],
        providerImportSource: '@mdx-js/react',
      }),
    },
    react({
      // React Compiler (GA, babel-plugin-react-compiler v1) — auto-memoizes components
      // and hooks so manual useMemo/useCallback/memo are unnecessary. Targets React 19.
      babel: {
        plugins: [['babel-plugin-react-compiler', {}]],
      },
    }),
    // Installable PWA: web manifest + offline app-shell cache so vs-Computer + pass-and-play
    // work with no network. Icons are generated from assets-source/logo.png (pwa-assets.config.ts);
    // the engine proxy (/api) and Online PvP relay (/uplink) are never cached.
    //
    // registerType:'prompt' (NOT autoUpdate) so a freshly deployed service worker WAITS instead of
    // silently `skipWaiting()`-ing under an open tab — which could serve a stale mix of old page +
    // new/cleaned chunks. The <PwaUpdatePrompt> toast lets the user apply the update deliberately.
    VitePWA({
      // For the Capacitor/APK build (GC_NO_PWA=1) ship a SELF-DESTROYING service worker: the
      // webview already serves the bundled assets locally, so a caching SW only risks showing a
      // STALE post-update app. selfDestroying unregisters any previously-installed SW and clears
      // its caches, so every APK update shows the fresh assets. The web build keeps the normal SW.
      selfDestroying: process.env.GC_NO_PWA === '1',
      registerType: 'prompt',
      pwaAssets: { config: true },
      manifest: {
        name: 'Gridlock Chess',
        short_name: 'Gridlock',
        description: 'A chess variant where pieces can run out of moves.',
        theme_color: '#070a12',
        background_color: '#070a12',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        categories: ['games'],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,mp3}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/uplink/],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      plugins: [
        // Emits THIRD-PARTY-LICENSES.txt covering exactly the dependencies that
        // get bundled into the shipped JS — the precise scope MIT/BSD "include
        // the notice in all copies" obligations apply to. Regenerates on every
        // `vite build`, so it never drifts from the actual dependency tree.
        license({
          thirdParty: {
            includePrivate: false,
            output: {
              file: path.resolve(__dirname, 'dist', 'THIRD-PARTY-LICENSES.txt'),
            },
          },
        }),
      ],
    },
  },
});
