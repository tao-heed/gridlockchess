/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  /** Firebase web app config — set in .env, never commit real values. */
  readonly VITE_FIREBASE_API_KEY:       string;
  readonly VITE_FIREBASE_AUTH_DOMAIN:   string;
  readonly VITE_FIREBASE_DATABASE_URL:  string;
  readonly VITE_FIREBASE_PROJECT_ID:    string;
  readonly VITE_FIREBASE_APP_ID:        string;
  /** Base URL of the Fairy-Stockfish HTTP proxy (server.js), e.g. `https://engine.example.com`.
   *  When unset: dev/test default to `http://localhost:3005`; a production build has NO engine
   *  URL, so the bot skips the network probe entirely and uses the offline heuristic. Set this
   *  only for a server-backed web deploy that ships the proxy. */
  readonly VITE_ENGINE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Allow importing markdown files as raw strings
declare module '*.md?raw' {
  const content: string;
  export default content;
}

// Allow importing MDX documents as React components
declare module '*.mdx' {
  import type { MDXProps } from 'mdx/types';
  const MDXComponent: (props: MDXProps) => JSX.Element;
  export default MDXComponent;
}
