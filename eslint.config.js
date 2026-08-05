// eslint.config.js — ESLint v9 flat config (May 2026 standard).
//
// Philosophy (see docs/dev/DevStandards.md → ESLINT CONFIG):
//   • TypeScript strict mode is the primary safety net (tsconfig: strict, noUnusedLocals…).
//   • ESLint adds ONLY what the type-checker can't: React Hooks rules, HMR safety, and
//     React Compiler enforcement. No formatting rules (editor/Prettier owns that).
//
// Scope is intentionally narrowed to first-party app source (src + vite config). Node
// scripts (server.js, bin/) and tool config files use CommonJS / Node globals and are
// excluded to keep the signal-to-noise ratio high.
//
// NOTE on the base ruleset: we use typescript-eslint `recommended` (syntactic, no
// type-information required) rather than `strictTypeChecked`. Reason: this app was never
// linted before, and strictTypeChecked floods a mature codebase with hundreds of
// type-aware findings that bury the rules we actually care about here (Hooks + Compiler).
// Type safety is already enforced by `tsc --strict`. Opt into strictTypeChecked later as
// a dedicated cleanup pass if desired.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import reactCompiler from 'eslint-plugin-react-compiler';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'android/**', 'bin/**', 'server.js'] },
  {
    files: ['src/**/*.{ts,tsx}', 'vite.config.ts', 'vitest.config.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'react-compiler': reactCompiler,
    },
    rules: {
      // ── React Hooks ────────────────────────────────────────────────────────
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // ── React Fast Refresh (HMR) ───────────────────────────────────────────
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // ── React Compiler ─────────────────────────────────────────────────────
      // Flags code the compiler cannot safely auto-memoize (Rules of React
      // violations: mutation during render, conditional hooks, etc.). If this fires,
      // the compiler silently skips that component — so treat it as an error.
      'react-compiler/react-compiler': 'error',

      // ── No manual memoization (React Compiler is enabled) ───────────────────
      // The compiler memoizes components, values, and callbacks automatically, so
      // useMemo / useCallback / memo() are redundant noise that can also drift out of
      // sync with their dependency arrays. The compiler rule above does NOT ban these,
      // so we forbid them syntactically here to prevent regressions.
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='useMemo']",
          message: 'React Compiler is enabled — drop useMemo; the compiler memoizes this automatically.',
        },
        {
          selector: "CallExpression[callee.name='useCallback']",
          message: 'React Compiler is enabled — drop useCallback; the compiler memoizes this automatically.',
        },
        {
          selector: "CallExpression[callee.name='memo']",
          message: 'React Compiler is enabled — drop memo(); the compiler memoizes components automatically.',
        },
        {
          selector: "MemberExpression[object.name='React'][property.name='memo']",
          message: 'React Compiler is enabled — drop React.memo; the compiler memoizes components automatically.',
        },
      ],

      // TypeScript's noUnusedLocals/noUnusedParameters already cover this.
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
);
