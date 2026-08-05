// lib/chess/engine.ts — Fairy-Stockfish client for Gridlock Chess.
//
// Talks to the local proxy (server.js) which runs Fairy-Stockfish with our custom
// "gridlock" variant. Compound Anomaly nodes map to native fairy pieces:
//
//   L+H+D = Amazon     → 'm'  (Queen + Knight)
//   L+D   = Archbishop → 'a'  (Bishop + Knight)
//   L+H   = Chancellor → 'c'  (Rook + Knight)
//   H+D   = Queen      → 'q'
//   L     = Knight     → 'n'
//   D     = Bishop     → 'b'
//   H     = Rook       → 'r'
//   none  = Dead Piece → blocker (see DEAD_GLYPH)
//
// IMPORTANT: identity is decided by WHICH vectors are > 0, never by how many points
// remain (see docs/dev/FairyCounterparts.md). The engine cannot model the depleting
// charge pool, so the bot ALWAYS re-filters engine moves through getAllLegalMoves.

import type { Board, Square, PieceColor, Piece } from '@/types/game';
import { FILES, RANKS } from '@/types/game';
import { isNativeEngineAvailable, nativeEvaluate, nativeIsReady } from './nativeEngine';

// Base URL of the Fairy-Stockfish HTTP proxy (server.js). An explicit `VITE_ENGINE_URL`
// always wins (for a server-backed web deploy). Otherwise dev/test fall back to the local
// proxy, while a PRODUCTION build (e.g. the packaged Capacitor webview, where there is no
// localhost:3005) gets an EMPTY string — the guards below then skip the network probe entirely
// and the bot uses the offline heuristic instead of paying a failing fetch on every move.
// `import.meta.env.PROD` is true only in `vite build`; it is false in dev AND under vitest.
const ENGINE_URL =
  import.meta.env.VITE_ENGINE_URL ??
  (import.meta.env.PROD ? '' : 'http://localhost:3005');

// Dead pieces (gridlocked, 0/0/0) map to the variant's built-in `immobile` piece 'x' (see
// variants.ini): it blocks squares, is auto-valued low (no mobility), and — being NON-royal —
// makes a dead PILOTED anomaly trigger extinction=loss (Gridlock Death), the correct outcome.
// The bot's re-filter still guarantees it can never actually be moved under our own rules.
const DEAD_GLYPH = 'x';

// ─────────────────────────────────────────────────────────────────────────────
// Board → FEN
// ─────────────────────────────────────────────────────────────────────────────

/** Lowercase fairy/standard glyph for a piece's CURRENT lattice node. */
function pieceToFenChar(piece: Piece): string {
  if (piece.type === 'king') return 'k';
  // A Piloted Anomaly IS the royal piece (Override, GridlockChess.md §6.1). We emit a custom
  // ROYAL letter matching its CURRENT reach so the engine (gridlock-royal variant) sees the
  // real royal — a queen/rook/knight/etc. — instead of a 1-square king. Movement is gated by
  // vector PRESENCE (v.X > 0) and each vector slides full range, so the live non-zero subset
  // maps exactly to one royal piece. The bot still re-filters for depletion the engine can't see.
  if (piece.type === 'anomaly' && (piece as { piloted?: boolean }).piloted) {
    const rv = piece.vectors;
    if ('shared' in rv) return 'm';                  // defensive: Omni is never piloted (Override excludes it)
    const rL = rv.L > 0, rO = rv.O > 0, rD = rv.D > 0;
    if (rO && rD && rL) return 'e';                  // royal amazon     (QN)
    if (rD && rL) return 'f';                        // royal archbishop (BN)
    if (rO && rL) return 'g';                        // royal chancellor (RN)
    if (rO && rD) return 'h';                        // royal queen      (Q)
    if (rL) return 'i';                              // royal knight     (N)
    if (rD) return 'j';                              // royal bishop     (B)
    if (rO) return 's';                              // royal rook       (R)
    return DEAD_GLYPH;                               // 0/0/0 = Gridlock Death (game already over)
  }
  if (piece.type === 'pawn') return 'p';

  // Anomaly (standard or Omni)
  const v = piece.vectors;
  if ('shared' in v) {
    // Omni: an Amazon while shared > 0, else Dead.
    return v.shared > 0 ? 'm' : DEAD_GLYPH;
  }

  const hasL = v.L > 0;
  const hasO = v.O > 0;
  const hasD = v.D > 0;

  if (hasL && hasO && hasD) return 'm'; // Amazon
  if (hasL && hasD) return 'a';         // Archbishop
  if (hasL && hasO) return 'c';         // Chancellor
  if (hasO && hasD) return 'q';         // Queen
  if (hasL) return 'n';                 // Knight
  if (hasD) return 'b';                 // Bishop
  if (hasO) return 'r';                 // Rook
  return DEAD_GLYPH;                    // Dead piece (gridlocked)
}

/**
 * Convert our Board to a FEN string for the "gridlock" variant.
 * Castling is disabled (Gridlock kings never castle). The en passant target square is
 * emitted when supplied, so Fairy-Stockfish can actually see — and play — en passant
 * captures on its very first move (its internal search tracks EP on its own thereafter).
 * The bot still re-filters every suggestion through our own rules for charge legality.
 */
export function boardToFen(board: Board, turn: PieceColor, enPassantTarget?: Square | null): string {
  const rows: string[] = [];

  for (let r = 7; r >= 0; r--) {
    let row = '';
    let empty = 0;

    for (let f = 0; f < 8; f++) {
      const sq = `${FILES[f]}${RANKS[r]}` as Square;
      const piece = board[sq];
      if (piece) {
        if (empty > 0) { row += empty; empty = 0; }
        const ch = pieceToFenChar(piece);
        row += piece.color === 'white' ? ch.toUpperCase() : ch;
      } else {
        empty++;
      }
    }
    if (empty > 0) row += empty;
    rows.push(row);
  }

  const fenTurn = turn === 'white' ? 'w' : 'b';
  // FEN fields: <placement> <turn> <castling> <en passant> <halfmove> <fullmove>.
  // Castling is always '-' (no castling in Gridlock); en passant is the skipped square
  // (e.g. 'c6') or '-' when none is available this turn.
  const ep = enPassantTarget ?? '-';
  return `${rows.join('/')} ${fenTurn} - ${ep} 0 1`;
}

/**
 * Encode per-piece charge state as a fuel string for the fuel-modified FSF binary.
 * Format: "sq:L.O.D,sq:L.O.D,..." for standard anomalies, "sq:sN" for Omni (shared pool).
 * Only anomalies are listed; Kings and Pawns have no fuel.
 */
export function boardToFuelString(board: Board): string {
  const parts: string[] = [];
  for (const sq of Object.keys(board) as Square[]) {
    const p = board[sq];
    if (!p || p.type !== 'anomaly') continue;
    const v = p.vectors;
    if ('shared' in v) {
      parts.push(`${sq}:s${v.shared}`);
    } else {
      parts.push(`${sq}:${v.L}.${v.O}.${v.D}`);
    }
  }
  return parts.join(',');
}

// ─────────────────────────────────────────────────────────────────────────────
// UCI move parsing
// ─────────────────────────────────────────────────────────────────────────────

export interface UciMove {
  from: Square;
  to: Square;
  promotion?: string;
}

/** Parse "e2e4" / "e7e8q" into squares (+ optional promotion suffix we ignore). */
export function parseUciMove(uci: string): UciMove {
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    promotion: uci.length > 4 ? uci[4] : undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP client
// ─────────────────────────────────────────────────────────────────────────────

export interface EngineMove {
  move: string;  // UCI
  score: number; // centipawns (positive = good for side to move)
}

export interface EvaluateOptions {
  depth?: number;
  movetime?: number;
  multipv?: number;
  skill?: number;
  /** Fixed node budget. When set, the search is bounded by nodes ALONE (`go nodes N`) —
   *  depth/movetime are ignored — so a position searches identically on every machine,
   *  independent of CPU speed/thermal. Used by the self-play benchmark harness. */
  nodes?: number;
  /** Gridlock fuel string — per-piece charge state sent to the fuel-modified FSF binary
   *  via the UCI `fuel` command between `position` and `go`. Format: "sq:L.O.D,..." or
   *  "sq:sN" for Omni. Omit for the vanilla (non-fuel) engine. */
  fuel?: string;
}

/** Ask the engine for ranked candidate moves (best first). */
export async function evaluatePosition(
  fen: string,
  options: EvaluateOptions = {},
): Promise<EngineMove[]> {
  // In the packaged Android app the engine is the bundled native Fairy-Stockfish (no server).
  if (isNativeEngineAvailable()) return nativeEvaluate(fen, options);
  if (!ENGINE_URL) throw new Error('engine not configured');
  const { depth = 12, movetime = 500, multipv = 5, skill, nodes, fuel } = options;
  const res = await fetch(`${ENGINE_URL}/api/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fen, depth, movetime, multipv, skill, nodes, fuel }),
  });
  if (!res.ok) throw new Error(`engine ${res.status}`);
  const data = await res.json();
  return data.moves as EngineMove[];
}

/** True if the engine proxy is up and the variant is loaded. */
export async function isEngineReady(): Promise<boolean> {
  // Packaged Android app → the bundled native engine (no network probe).
  if (isNativeEngineAvailable()) return nativeIsReady();
  // No engine configured (production/offline web build) — don't touch the network.
  if (!ENGINE_URL) return false;
  try {
    const res = await fetch(`${ENGINE_URL}/api/status`);
    if (!res.ok) return false;
    const data = await res.json();
    return data.ready === true;
  } catch {
    return false;
  }
}
