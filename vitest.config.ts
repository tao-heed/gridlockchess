import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Vitest config. The React plugin + React Compiler are applied here so tests exercise
// the SAME compiled output that ships (vite.config.ts). Without this, hooks/components
// run un-memoized under test and referential-stability guarantees can't be verified.
// Vitest 4 shares the app's Vite 6 (no nested copy), so plugin types line up cleanly.
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler', {}]],
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
