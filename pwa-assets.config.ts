// pwa-assets.config.ts — icon generation for the installable PWA.
// Generates all required PWA icon sizes from the single SVG favicon at build time
// (consumed by vite-plugin-pwa's `pwaAssets`). Maskable + Apple icons get a solid
// dark background (#070a12, the app's gc-bg) so there are no transparent/white corners.
import { defineConfig } from '@vite-pwa/assets-generator/config';

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    transparent: {
      sizes: [64, 192, 512],
      favicons: [[48, 'favicon.ico']],
    },
    maskable: {
      sizes: [512],
      padding: 0.3,
      resizeOptions: { background: '#070a12' },
    },
    apple: {
      sizes: [180],
      padding: 0.3,
      resizeOptions: { background: '#070a12' },
    },
  },
  images: ['assets-source/logo.png'],
});
