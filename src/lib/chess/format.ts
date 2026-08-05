// lib/chess/format.ts — Layer 1 of the Gridlock portable format (see docs/dev/GridlockFEN.md).
//
// A GridlockPosition is ONE lossless position (the "FEN" analog): every piece + every
// charge + turn + clocks + the piloted flag. It is portable JSON, versioned, and Zod-
// validated. Derived state (isGridlocked, pawn hasMoved/enPassantVulnerable, piece ids)
// is NOT stored — it is recomputed on import. Layer 2 (replay/rewind) is not built yet.
import { z } from 'zod';
import type {
  Board, PieceColor, Square, Anomaly, Pawn, King, VectorType,
  ArchetypeKey, VectorPool, OmniPool, GameStatus,
} from '@/types/game';
import { parseSquare, toSquare } from '@/types/game';
import { getArchetype, ARCHETYPE_REGISTRY, createOmniAnomaly } from './archetypes';
import { applyMoveToBoard } from './move';
import { isCheckmate, isStalemate, isInCheck } from './check';

/** Current schema version. Bump only on breaking shape changes. */
export const POSITION_VERSION = 1;

const SQUARE_RE = /^[a-h][1-8]$/;
const square = z.string().regex(SQUARE_RE) as z.ZodType<Square>;
const color = z.enum(['white', 'black']);
const charge = z.number().int().min(0).max(10);

const vectorPool = z.object({ L: charge, O: charge, D: charge });
const omniPool = z.object({ shared: z.number().int().min(0).max(8) });

// Derived from the single source of truth so a new archetype is picked up here
// automatically — no parallel list to keep in sync with the registry.
const ARCHETYPE_KEYS = Object.keys(ARCHETYPE_REGISTRY) as [ArchetypeKey, ...ArchetypeKey[]];

const pieceSchema = z.union([
  z.object({ t: z.literal('king'), c: color }),
  z.object({ t: z.literal('pawn'), c: color }),
  z.object({
    t: z.literal('anomaly'),
    c: color,
    a: z.enum(ARCHETYPE_KEYS as [ArchetypeKey, ...ArchetypeKey[]]),
    v: z.union([vectorPool, omniPool]),
    piloted: z.boolean().optional(),
  }),
]);

export const gridlockPositionSchema = z.object({
  v: z.literal(POSITION_VERSION),
  turn: color,
  enPassant: square.nullable(),
  halfmoveClock: z.number().int().min(0),
  fullmove: z.number().int().min(1),
  board: z.record(square, pieceSchema),
});

export type GridlockPosition = z.infer<typeof gridlockPositionSchema>;

/** Serialize a live position into a lossless, portable GridlockPosition. */
export function serializePosition(
  board: Board,
  turn: PieceColor,
  enPassant: Square | null,
  halfmoveClock: number,
  fullmove: number,
): GridlockPosition {
  const out: GridlockPosition['board'] = {};
  for (const sq of Object.keys(board) as Square[]) {
    const p = board[sq];
    if (!p) continue;
    if (p.type === 'king') {
      out[sq] = { t: 'king', c: p.color };
    } else if (p.type === 'pawn') {
      out[sq] = { t: 'pawn', c: p.color };
    } else if (p.archetype === 'omni') {
      out[sq] = { t: 'anomaly', c: p.color, a: 'omni', v: { shared: (p.vectors as OmniPool).shared } };
    } else {
      const v = p.vectors as VectorPool;
      const entry: GridlockPosition['board'][Square] = {
        t: 'anomaly', c: p.color, a: p.archetype, v: { L: v.L, O: v.O, D: v.D },
      };
      if (p.piloted) entry.piloted = true;
      out[sq] = entry;
    }
  }
  return { v: POSITION_VERSION, turn, enPassant, halfmoveClock, fullmove, board: out };
}

/** Parse + validate JSON (string or object) into a GridlockPosition. Throws on invalid. */
export function parsePosition(input: string | unknown): GridlockPosition {
  const raw = typeof input === 'string' ? JSON.parse(input) : input;
  return gridlockPositionSchema.parse(raw);
}

/**
 * Rebuild a live Board from a GridlockPosition. Mints fresh piece ids, restores icons,
 * and derives isGridlocked + pawn hasMoved/enPassantVulnerable (none of which are stored).
 */
export function positionToBoard(pos: GridlockPosition): Board {
  let n = 0;
  const id = () => `pos-piece-${++n}`;
  const board: Board = {};
  for (const sqKey of Object.keys(pos.board)) {
    const sq = sqKey as Square;
    const e = pos.board[sq]!;
    if (e.t === 'king') {
      const king: King = { id: id(), type: 'king', color: e.c, icon: e.c === 'white' ? '♔' : '♚' };
      board[sq] = king;
    } else if (e.t === 'pawn') {
      const { rank } = parseSquare(sq);
      const home = e.c === 'white' ? '2' : '7';
      const epRank = e.c === 'white' ? '5' : '4';
      const pawn: Pawn = {
        id: id(), type: 'pawn', color: e.c, icon: e.c === 'white' ? '♙' : '♟',
        hasMoved: rank !== home,
      };
      if (pos.enPassant && rank === epRank) pawn.enPassantVulnerable = true;
      board[sq] = pawn;
    } else if (e.a === 'omni') {
      const shared = (e.v as OmniPool).shared;
      board[sq] = createOmniAnomaly(id(), e.c, shared);
    } else {
      const v = e.v as VectorPool;
      const meta = getArchetype(e.a);
      const anomaly: Anomaly = {
        id: id(), type: 'anomaly', archetype: e.a as Exclude<ArchetypeKey, 'omni'>, color: e.c,
        icon: meta?.icon ?? '', vectors: { L: v.L, O: v.O, D: v.D },
        isGridlocked: v.L === 0 && v.O === 0 && v.D === 0,
      };
      if (e.piloted) anomaly.piloted = true;
      board[sq] = anomaly;
    }
  }
  return board;
}

// ── Layer 2: GridlockReplay (the "PGN") — start position + ordered move list ──────────
// A replay rewinds anywhere by re-applying moves through the rules engine. Per-move state
// (charges, gridlock, clocks, captures) is DERIVED, never stored. See docs/dev/GridlockFEN.md.

export const REPLAY_VERSION = 1;

// Hard upper bound on how many plies a replay may contain. Every move is re-run through
// the rules engine on import (replayTo), so an unbounded list is a client-side DoS vector
// (a crafted file could freeze the importer's own tab). The cap lives in the schema so EVERY
// entry point (import, resume, round-trip) is protected at the validation boundary, not just
// the file picker.
//
// Sizing (this is deliberately ABOVE any rules-terminated game, not near a "typical" one):
// the engine force-draws at halfmoveClock >= 100 (a hard 50-move rule), and the clock resets
// on every "progress" move — capture, pawn advance, override, OR a spent vector charge
// (see move.ts: `irreversible = capture || enPassant || pawn || vectorUsed`). Reset budget
// per game: 140 charges (70/side) + up to ~96 pawn moves + ~30 captures + a few overrides
// ≈ 280 resets, and both kings can shuffle ~99 free plies between resets, so a pathological
// but fully legal game reaches ~100 × 281 ≈ 28k plies. (Charge resets ALONE already allow
// ~14k plies — so the old 10k value could reject a legal game.) 40k leaves clear headroom.
// NOTE: replayTo does not itself enforce termination, so this schema cap is the real bound.
export const MAX_REPLAY_MOVES = 40_000;

const END_REASONS = [
  'checkmate', 'stalemate', 'resigned', 'gridlock-death', 'timeout', 'repetition', 'gridlock', 'fifty-move',
] as const;

// A move is just the origin and destination squares. Everything else — captures, vector
// spends, Override, promotion, Gridlock, check/mate — is DERIVED by re-applying the move
// through the rules engine (see deriveMoveInfo / buildMoveLog), never stored. Keeping the
// on-disk move minimal is what makes an exported replay a faithful, tamper-resistant record.
const moveSchema = z.object({
  from: square,
  to: square,
});

export const gridlockReplaySchema = z.object({
  v: z.literal(REPLAY_VERSION),
  meta: z.object({
    mode: z.string().optional(),
    // 'pure' (old Wild mode) and 'exact' (old two-mode split) are retired legacy values,
    // kept here so old replays still parse; both are normalized to 'balanced' on load.
    generationMode: z.enum(['pure', 'balanced', 'exact']).optional(),
    players: z.object({ white: z.string(), black: z.string() }).optional(),
    result: z.enum(['1-0', '0-1', '1/2-1/2', '*']).optional(),
    endReason: z.enum(END_REASONS).optional(),
    createdAt: z.string().optional(),
  }),
  start: gridlockPositionSchema,
  moves: z.array(moveSchema).max(MAX_REPLAY_MOVES),
});

export type GridlockMove = z.infer<typeof moveSchema>;
export type GridlockReplay = z.infer<typeof gridlockReplaySchema>;

/** Live state threaded through replay: board + side-to-move + en passant + clocks. */
export interface ReplayState {
  board: Board;
  turn: PieceColor;
  enPassant: Square | null;
  halfmoveClock: number;
  fullmove: number;
  status: GameStatus;
}

/**
 * Apply ONE move purely for replay, layering fullmove + terminal status on top of the
 * shared move kernel (applyMoveToBoard). Returns the next state. Throws on an illegal move.
 */
export function applyReplayMove(state: ReplayState, from: Square, to: Square): ReplayState {
  const { board, turn, enPassant } = state;
  const applied = applyMoveToBoard(board, from, to, turn, enPassant);
  if (!applied.valid) throw new Error(`Illegal replay move ${from}->${to}: ${applied.error}`);
  const nextTurn: PieceColor = turn === 'white' ? 'black' : 'white';
  const fullmove = turn === 'black' ? state.fullmove + 1 : state.fullmove;

  // Override resets the fifty-move clock; otherwise the kernel tells us if progress was made.
  const halfmoveClock = applied.isOverride || applied.irreversible ? 0 : state.halfmoveClock + 1;
  return {
    board: applied.board,
    turn: nextTurn,
    enPassant: applied.nextEnPassant,
    halfmoveClock,
    fullmove,
    status: deriveStatus(applied.board, nextTurn, applied.gridlockDeath, halfmoveClock),
  };
}

function deriveStatus(board: Board, turn: PieceColor, gridlockDeath: boolean, halfmove: number): GameStatus {
  if (gridlockDeath) return 'gridlock-death';
  if (isCheckmate(board, turn)) return 'checkmate';
  if (isStalemate(board, turn)) return 'stalemate';
  if (halfmove >= 100) return 'draw';
  return 'playing';
}

/** Replay to ply N: rebuild start, apply moves[0..N-1]. N omitted = full game. */
export function replayTo(replay: GridlockReplay, ply?: number): ReplayState {
  const s = gridlockReplaySchema.parse(replay);
  let state: ReplayState = {
    board: positionToBoard(s.start), turn: s.start.turn, enPassant: s.start.enPassant,
    halfmoveClock: s.start.halfmoveClock, fullmove: s.start.fullmove, status: 'playing',
  };
  const n = ply ?? s.moves.length;
  for (let i = 0; i < n; i++) { const m = s.moves[i]!; state = applyReplayMove(state, m.from, m.to); }
  return state;
}

/**
 * Fully-derived record of one played move — every observable outcome, reconstructed from
 * the board rather than trusted from the (optional, lossy) per-move JSON flags. This is the
 * single source of truth behind the move-history rows: the live game, a resumed refresh,
 * and an imported JSON all run it, so the three renderings can never disagree.
 */
export interface ReplayMoveInfo {
  from: Square;
  to: Square;
  /** Side that made this move. */
  color: PieceColor;
  /** 1-based turn number (a white + black pair share one number). */
  moveNumber: number;
  /** The mover's kind BEFORE the move: 'king' | 'pawn' | archetype key (a promoting pawn stays 'pawn'). */
  pieceType: string;
  /** Captured piece kind ('king' | 'pawn' | archetype key), including en-passant victims. */
  captured?: string;
  /** Vector charge spent by an Anomaly this move (Leap / Ortho / Diag), if any. */
  vector?: VectorType;
  /** Charges left in that vector after the spend. */
  vectorRemaining?: number;
  /** King boarded a friendly Anomaly (Override / Anomaly Boarding). */
  isOverride: boolean;
  /** A pawn reached the back rank and synthesised into an Omni this move (Anomaly Synthesis). */
  isPromotion: boolean;
  /** A NON-piloted Anomaly drained its last charge this move (0/0/0) but survives. */
  causesGridlock: boolean;
  /** A piloted (King-carrying) Anomaly drained its last charge → the carried King dies. */
  isGridlockDeath: boolean;
  isCheck: boolean;
  isCheckmate: boolean;
  isStalemate: boolean;
}

/**
 * Derive one fully-resolved move record + the resulting replay state, by applying a single
 * `{from,to}` through the real move kernel. This is the ONE per-move derivation primitive:
 * `buildMoveLog` loops it (import / resume, one-time), and the live game threads it move by
 * move (O(1) each) so the on-screen log can never diverge from a replayed one. Throws on an
 * illegal move. `ply` is the 0-based move index (used only for the shared move-number rule).
 */
export function deriveMoveInfo(
  state: ReplayState, from: Square, to: Square, ply: number,
): { info: ReplayMoveInfo; next: ReplayState } {
  const mover = state.board[from];
  const applied = applyMoveToBoard(state.board, from, to, state.turn, state.enPassant);
  if (!applied.valid) throw new Error(`Illegal replay move ${from}->${to}: ${applied.error}`);

  const nextTurn: PieceColor = state.turn === 'white' ? 'black' : 'white';
  const halfmove = applied.isOverride || applied.irreversible ? 0 : state.halfmoveClock + 1;
  const fullmove = state.turn === 'black' ? state.fullmove + 1 : state.fullmove;
  const status = deriveStatus(applied.board, nextTurn, applied.gridlockDeath, halfmove);

  // The mover on its destination AFTER the move (post promotion / charge spend). A fully
  // Gridlocked, non-piloted Anomaly landing here is the "X Gridlocked" event; the piloted
  // case is a Gridlock Death and the kernel already flags it separately.
  const landed = applied.board[to];
  const causesGridlock =
    !applied.isOverride &&
    landed?.type === 'anomaly' &&
    (landed as Anomaly).piloted !== true &&
    landed.isGridlocked === true;

  const info: ReplayMoveInfo = {
    from,
    to,
    color: state.turn,
    moveNumber: Math.floor(ply / 2) + 1,
    pieceType: mover?.type === 'anomaly' ? mover.archetype : (mover?.type ?? 'pawn'),
    captured: applied.captured
      ? (applied.captured.type === 'anomaly' ? applied.captured.archetype : applied.captured.type)
      : undefined,
    vector: applied.vectorSpend?.vector,
    vectorRemaining: applied.vectorSpend?.remaining,
    isOverride: applied.isOverride,
    isPromotion: applied.requiresPromotion,
    causesGridlock,
    isGridlockDeath: applied.gridlockDeath,
    // A move can be BOTH mate and check; report check independently so a plain checking
    // move (that isn't mate) still shows the '+'. Stalemate/gridlock-death aren't checks.
    isCheck: status === 'checkmate' ? true : isInCheck(applied.board, nextTurn),
    isCheckmate: status === 'checkmate',
    isStalemate: status === 'stalemate',
  };

  const next: ReplayState = {
    board: applied.board,
    turn: nextTurn,
    enPassant: applied.nextEnPassant,
    halfmoveClock: halfmove,
    fullmove,
    status,
  };

  return { info, next };
}

/**
 * Reconstruct the complete, ordered move log from a replay in a SINGLE O(n) pass, capturing
 * every outcome the move kernel produces (captures, vector spends, Override, promotion,
 * Gridlock, Gridlock Death, check/mate/stalemate). Because the minimal {from,to} moves are
 * re-applied through the real engine, the derived metadata is authoritative — this is what
 * lets a bare-bones exported JSON round-trip back through "Import Replay (JSON)" and replay
 * the previous match with full fidelity. Throws on an illegal move.
 *
 * NOTE: This walks the whole game each call, so it is O(n) and meant for one-time loads
 * (import / resume). The live game must NOT call this per move — thread `deriveMoveInfo`
 * incrementally instead (see LocalGame), or the cost becomes O(n²) across a match.
 */
export function buildMoveLog(replay: GridlockReplay): ReplayMoveInfo[] {
  const s = gridlockReplaySchema.parse(replay);
  const out: ReplayMoveInfo[] = [];
  let state: ReplayState = {
    board: positionToBoard(s.start),
    turn: s.start.turn,
    enPassant: s.start.enPassant,
    halfmoveClock: s.start.halfmoveClock,
    fullmove: s.start.fullmove,
    status: 'playing',
  };

  for (let i = 0; i < s.moves.length; i++) {
    const m = s.moves[i]!;
    const { info, next } = deriveMoveInfo(state, m.from, m.to, i);
    out.push(info);
    state = next;
  }

  return out;
}

/** Serialize a replay to JSON. */
export function serializeReplay(r: GridlockReplay): string {
  return JSON.stringify(gridlockReplaySchema.parse(r));
}

/** Parse + validate a replay. Throws on invalid/unknown version. */
export function parseReplay(input: string | unknown): GridlockReplay {
  const raw = typeof input === 'string' ? JSON.parse(input) : input;
  return gridlockReplaySchema.parse(raw);
}

type ReplayResult = '1-0' | '0-1' | '1/2-1/2' | '*';
type ReplayMeta = GridlockReplay['meta'];

/**
 * Map terminal game state → portable replay outcome (PGN-style result + endReason).
 * `turn` is the side TO MOVE at the terminal position. For checkmate / resigned / timeout the LOSER
 * is that side to move. Gridlock-death is the EXCEPTION: the doomed player spends its piloted royal's
 * last charge on its OWN move, so `makeMove` has already passed the turn to the SURVIVOR — the side to
 * move is the WINNER there, and the loser is its opposite. Returns {} while play continues so the
 * replay stays open-ended ('*').
 */
export function gameOutcome(
  status: GameStatus,
  drawReason: 'repetition' | 'gridlock' | 'fifty-move' | null,
  turn: PieceColor,
): { result: ReplayResult; endReason: ReplayMeta['endReason'] } | Record<string, never> {
  const whiteToMove = turn === 'white';
  switch (status) {
    // Side to move LOSES → the opposite color takes the point.
    case 'checkmate': return { result: whiteToMove ? '0-1' : '1-0', endReason: 'checkmate' };
    case 'resigned': return { result: whiteToMove ? '0-1' : '1-0', endReason: 'resigned' };
    // Timeout: the side to move is the one whose clock ran out → it loses (like checkmate).
    case 'timeout': return { result: whiteToMove ? '0-1' : '1-0', endReason: 'timeout' };
    // Gridlock-death: side to move is the SURVIVOR → it WINS (the doomed pilot already passed the turn).
    case 'gridlock-death': return { result: whiteToMove ? '1-0' : '0-1', endReason: 'gridlock-death' };
    case 'stalemate': return { result: '1/2-1/2', endReason: 'stalemate' };
    case 'draw': return { result: '1/2-1/2', endReason: drawReason ?? 'repetition' };
    default: return {};
  }
}

const ARCHETYPE_LABELS: Record<ArchetypeKey, string> = Object.fromEntries(
  (Object.keys(ARCHETYPE_REGISTRY) as ArchetypeKey[]).map((k) => [k, ARCHETYPE_REGISTRY[k].alias]),
) as Record<ArchetypeKey, string>;

/**
 * Render a position as a human-readable ASCII board + anomaly legend, for the plain-text
 * "Copy" so a pasted game shows its starting layout, not just the moves. White = UPPER,
 * black = lower; K=King, P=Pawn, A=Anomaly (detailed in the legend with charges).
 */
export function renderPositionText(pos: GridlockPosition): string {
  const lines: string[] = [];
  const legend: string[] = [];
  for (let r = 7; r >= 0; r--) {
    let row = `${r + 1} `;
    for (let f = 0; f < 8; f++) {
      const sq = toSquare(f, r);
      const p = sq ? pos.board[sq] : undefined;
      let t = '.';
      if (p) {
        const letter = p.t === 'king' ? 'K' : p.t === 'pawn' ? 'P' : 'A';
        t = p.c === 'white' ? letter : letter.toLowerCase();
        if (p.t === 'anomaly') {
          const v = p.v as VectorPool & OmniPool;
          const charges = p.a === 'omni' ? `${v.shared}` : `L${v.L} O${v.O} D${v.D}`;
          legend.push(`  ${sq} ${p.c === 'white' ? 'W' : 'B'} ${ARCHETYPE_LABELS[p.a]} (${charges})${p.piloted ? ' piloted' : ''}`);
        }
      }
      row += ` ${t}`;
    }
    lines.push(row);
  }
  lines.push('   a b c d e f g h');
  const out = ['Start position:', ...lines];
  if (legend.length) out.push('Anomalies:', ...legend);
  out.push(`${pos.turn === 'white' ? 'White' : 'Black'} to move`);
  return out.join('\n');
}
