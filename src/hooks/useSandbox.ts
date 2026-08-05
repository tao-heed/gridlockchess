// hooks/useSandbox.ts — Editor state for the Sandbox (functional core = the pure reducer below).
//
// State never leaves the Sandbox subtree, so this is a page-local useReducer (not a global store).
// The reducer is PURE and exported for unit testing; piece creation (which mints ids) happens in the
// action creators, keeping the reducer side-effect-free.
import { useEffect, useReducer } from 'react';
import type {
  Board, PieceColor, Square, Piece, ArchetypeKey, VectorPool, OmniPool,
} from '@/types/game';
import { ARCHETYPE_REGISTRY, createOmniAnomaly } from '@/lib/chess/archetypes';
import { canonicalCharges } from '@/lib/chess/sandbox/charges';
import { serializePosition, parsePosition, positionToBoard } from '@/lib/chess/format';

/** A pickable palette entry. `archetype` may be 'omni' (sandbox-only exception). */
export type PaletteItem =
  | { kind: 'king'; color: PieceColor }
  | { kind: 'pawn'; color: PieceColor }
  | { kind: 'anomaly'; color: PieceColor; archetype: ArchetypeKey };

let idSeq = 0;
const nextId = () => `sbx-${++idSeq}`;

/** Build a live Piece from a palette item. Anomalies get their archetype's canonical charges. */
export function createSandboxPiece(item: PaletteItem, id: string = nextId()): Piece {
  if (item.kind === 'king') {
    return { id, type: 'king', color: item.color, icon: item.color === 'white' ? '♔' : '♚' };
  }
  if (item.kind === 'pawn') {
    return { id, type: 'pawn', color: item.color, icon: item.color === 'white' ? '♙' : '♟', hasMoved: false };
  }
  if (item.archetype === 'omni') {
    return createOmniAnomaly(id, item.color);
  }
  const key = item.archetype;
  return {
    id, type: 'anomaly', archetype: key, color: item.color,
    icon: ARCHETYPE_REGISTRY[key].icon,
    vectors: canonicalCharges(key) as VectorPool,
    isGridlocked: false,
  };
}

/** True if two palette items refer to the same piece (used to highlight the armed chip). */
export function samePaletteItem(a: PaletteItem | null, b: PaletteItem): boolean {
  if (!a || a.kind !== b.kind || a.color !== b.color) return false;
  return a.kind !== 'anomaly' || (b.kind === 'anomaly' && a.archetype === b.archetype);
}

export interface SandboxState {
  board: Board;
  turn: PieceColor;
  armed: PaletteItem | null;
  selected: Square | null;
  /** Board snapshots taken BEFORE each edit, most-recent last — the Undo stack. */
  past: Board[];
}

export type SandboxAction =
  | { type: 'arm'; item: PaletteItem | null }
  | { type: 'place'; square: Square; piece: Piece }
  | { type: 'remove'; square: Square }
  | { type: 'move'; from: Square; to: Square }
  | { type: 'placePair'; entries: { square: Square; piece: Piece }[] }
  | { type: 'removeAt'; squares: Square[] }
  | { type: 'movePair'; moves: { from: Square; to: Square }[] }
  | { type: 'setTurn'; turn: PieceColor }
  | { type: 'select'; square: Square | null }
  | { type: 'setCharges'; square: Square; vectors: VectorPool | OmniPool; mirror?: Square }
  | { type: 'setPiloted'; square: Square; piloted: boolean; mirror?: Square }
  | { type: 'load'; board: Board; turn: PieceColor }
  | { type: 'undo' }
  | { type: 'clear' };

/** Max Undo depth (board snapshots are small). */
const HISTORY_CAP = 60;
const pushHistory = (past: Board[], board: Board): Board[] => [...past, board].slice(-HISTORY_CAP);

export const initialSandboxState: SandboxState = { board: {}, turn: 'white', armed: null, selected: null, past: [] };

// ── Persistence (so a back-tap / refresh doesn't wipe an in-progress board) ──────────────────
const SANDBOX_KEY = 'gridlock:sandbox:v1';

/** Load a saved in-progress board (transient armed/selected are never persisted). Corrupt or
 *  absent data falls back to the empty editor. Reuses the tested position serialization. */
export function loadPersistedSandbox(): SandboxState {
  try {
    const raw = localStorage.getItem(SANDBOX_KEY);
    if (!raw) return initialSandboxState;
    const pos = parsePosition(raw); // Zod-validates the shape; throws on garbage
    return { board: positionToBoard(pos), turn: pos.turn, armed: null, selected: null, past: [] };
  } catch {
    return initialSandboxState;
  }
}

/** Persist the board + side-to-move. An empty board clears the key (nothing to resume). */
export function persistSandbox(board: Board, turn: PieceColor): void {
  try {
    if (Object.keys(board).length === 0) {
      localStorage.removeItem(SANDBOX_KEY);
      return;
    }
    localStorage.setItem(SANDBOX_KEY, JSON.stringify(serializePosition(board, turn, null, 0, 1)));
  } catch {
    /* quota / unavailable — persistence is best-effort */
  }
}

/** PURE reducer — unit-tested in __tests__/useSandbox.spec.ts. */
export function sandboxReducer(state: SandboxState, action: SandboxAction): SandboxState {
  switch (action.type) {
    case 'arm':
      return { ...state, armed: action.item };
    case 'place':
      return { ...state, board: { ...state.board, [action.square]: action.piece }, past: pushHistory(state.past, state.board) };
    case 'remove': {
      if (!state.board[action.square]) return state; // nothing to remove — don't record history
      const board = { ...state.board };
      delete board[action.square];
      return {
        ...state,
        board,
        selected: state.selected === action.square ? null : state.selected,
        past: pushHistory(state.past, state.board),
      };
    }
    case 'move': {
      if (action.from === action.to) return state;
      const piece = state.board[action.from];
      if (!piece) return state;
      const board = { ...state.board };
      delete board[action.from];
      board[action.to] = piece;
      return { ...state, board, past: pushHistory(state.past, state.board) };
    }
    case 'placePair': {
      // Place several pieces in ONE history entry (Mirror mode: a white piece + its black mirror),
      // so a single Undo removes the whole pair rather than one square at a time.
      if (action.entries.length === 0) return state;
      const board = { ...state.board };
      for (const e of action.entries) board[e.square] = e.piece;
      return { ...state, board, past: pushHistory(state.past, state.board) };
    }
    case 'removeAt': {
      // Remove several squares in ONE history entry (Mirror mode: a piece + its mirror).
      const board = { ...state.board };
      let changed = false;
      for (const sq of action.squares) { if (board[sq]) { delete board[sq]; changed = true; } }
      if (!changed) return state; // nothing removed — don't record history
      const selected = state.selected && action.squares.includes(state.selected) ? null : state.selected;
      return { ...state, board, selected, past: pushHistory(state.past, state.board) };
    }
    case 'movePair': {
      // Move several pieces in ONE history entry (Mirror mode: a piece + its mirror twin). All
      // sources are LIFTED first, then dropped at destinations, so a source that is also another
      // move's destination is never clobbered.
      const board = { ...state.board };
      const lifted: { to: Square; piece: Piece }[] = [];
      for (const m of action.moves) {
        if (m.from === m.to) continue;
        const p = board[m.from];
        if (!p) continue;
        delete board[m.from];
        lifted.push({ to: m.to, piece: p });
      }
      if (lifted.length === 0) return state; // nothing moved — don't record history
      for (const l of lifted) board[l.to] = l.piece;
      return { ...state, board, past: pushHistory(state.past, state.board) };
    }
    case 'setTurn':
      return { ...state, turn: action.turn };
    case 'select':
      return { ...state, selected: action.square };
    case 'setCharges': {
      const piece = state.board[action.square];
      if (!piece || piece.type !== 'anomaly') return state;
      // `isGridlocked` is a DERIVED flag (true when the piece has no charges left) — keep it in sync
      // with the vectors so a 0/0/0 build is a real, immobile "dead stone", not just a stale label.
      const v = action.vectors;
      const isGridlocked = 'shared' in v ? v.shared === 0 : v.L === 0 && v.O === 0 && v.D === 0;
      const board = { ...state.board, [action.square]: { ...piece, vectors: action.vectors, isGridlocked } as Piece };
      // Mirror mode: apply the SAME build to the mirrored twin (same archetype, so identical charges)
      // in ONE history entry, so the pair edits and undoes together.
      const twin = action.mirror ? state.board[action.mirror] : undefined;
      if (twin && twin.type === 'anomaly') {
        board[action.mirror!] = { ...twin, vectors: action.vectors, isGridlocked } as Piece;
      }
      return { ...state, board, past: pushHistory(state.past, state.board) };
    }
    case 'setPiloted': {
      // Only a (non-omni) anomaly can be the King's mount. Applies to the twin too in Mirror mode,
      // in one history entry. A no-op only when NOTHING would change.
      const piece = state.board[action.square];
      if (!piece || piece.type !== 'anomaly' || piece.archetype === 'omni') return state;
      const setPilot = (p: Piece): Piece => {
        const next = { ...p, piloted: action.piloted } as Piece;
        if (!action.piloted) delete (next as { piloted?: boolean }).piloted;
        return next;
      };
      const board = { ...state.board };
      let changed = false;
      if (!!piece.piloted !== action.piloted) { board[action.square] = setPilot(piece); changed = true; }
      const twin = action.mirror ? state.board[action.mirror] : undefined;
      if (twin && twin.type === 'anomaly' && twin.archetype !== 'omni' && !!twin.piloted !== action.piloted) {
        board[action.mirror!] = setPilot(twin); changed = true;
      }
      if (!changed) return state;
      return { ...state, board, past: pushHistory(state.past, state.board) };
    }
    case 'undo': {
      if (state.past.length === 0) return state;
      const past = state.past.slice();
      const board = past.pop()!;
      return { ...state, board, past, selected: null };
    }
    case 'clear':
      if (Object.keys(state.board).length === 0) return state; // already empty — nothing to undo
      return { ...initialSandboxState, past: pushHistory(state.past, state.board) };
    case 'load':
      // Replace the whole board with a saved favourite. Undoable, and transient arm/selection reset.
      return { board: action.board, turn: action.turn, armed: null, selected: null, past: pushHistory(state.past, state.board) };
    default:
      return state;
  }
}

export function useSandbox() {
  const [state, dispatch] = useReducer(sandboxReducer, undefined, loadPersistedSandbox);

  // Write-through persistence on every board/turn change (armed/selected are transient).
  useEffect(() => {
    persistSandbox(state.board, state.turn);
  }, [state.board, state.turn]);

  return {
    ...state,
    canUndo: state.past.length > 0,
    arm: (item: PaletteItem | null) => dispatch({ type: 'arm', item }),
    place: (square: Square) => {
      if (state.armed) dispatch({ type: 'place', square, piece: createSandboxPiece(state.armed) });
    },
    remove: (square: Square) => dispatch({ type: 'remove', square }),
    move: (from: Square, to: Square) => dispatch({ type: 'move', from, to }),
    placePair: (entries: { square: Square; piece: Piece }[]) => dispatch({ type: 'placePair', entries }),
    removeAt: (squares: Square[]) => dispatch({ type: 'removeAt', squares }),
    movePair: (moves: { from: Square; to: Square }[]) => dispatch({ type: 'movePair', moves }),
    setTurn: (turn: PieceColor) => dispatch({ type: 'setTurn', turn }),
    select: (square: Square | null) => dispatch({ type: 'select', square }),
    setCharges: (square: Square, vectors: VectorPool | OmniPool, mirror?: Square) => dispatch({ type: 'setCharges', square, vectors, mirror }),
    setPiloted: (square: Square, piloted: boolean, mirror?: Square) => dispatch({ type: 'setPiloted', square, piloted, mirror }),
    load: (board: Board, turn: PieceColor) => dispatch({ type: 'load', board, turn }),
    undo: () => dispatch({ type: 'undo' }),
    clear: () => dispatch({ type: 'clear' }),
  };
}
