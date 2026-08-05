// lib/storage.ts — Safe localStorage helpers.
//
// Every access is wrapped so a disabled/over-quota store or a non-browser (SSR)
// environment degrades gracefully instead of throwing.

/** Read a raw string value, or null if missing/unavailable. */
export function readString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Write a raw string value; silently no-ops if storage is unavailable. */
export function writeString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/** Read and JSON-parse a value, or null if missing/corrupt/unavailable. */
export function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** JSON-serialize and write a value; silently no-ops if storage is unavailable. */
export function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
