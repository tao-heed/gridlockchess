// lib/chess/sandbox/savedPositions.ts — A small persistent library of favourite Sandbox positions.
//
// Distinct from the single "in-progress" autosave (useSandbox `gridlock:sandbox:v1`): this is an
// explicit, NAMED collection the player builds up ("my favourite openings"). Each entry stores a
// validated GridlockPosition object, reusing the same tested serialize/parse round-trip as the
// autosave, so a corrupt or outdated entry is dropped on read rather than crashing the editor.
import type { Board, PieceColor } from '@/types/game';
import {
  serializePosition, parsePosition, positionToBoard, parseReplay, replayTo,
  type GridlockPosition, type GridlockReplay,
} from '@/lib/chess/format';

const SAVES_KEY = 'gridlock:sandbox-saves:v1';
/** Hard cap so a runaway loop can't exhaust localStorage. 50 favourites is plenty. */
export const MAX_SAVES = 50;
/** Names longer than this are trimmed (keeps the list tidy + storage small). */
const MAX_NAME = 40;

interface SavedBase {
  id: string;
  name: string;
  /** Epoch ms the entry was created (list is shown newest-first). */
  savedAt: number;
}
/** A hand-built board position (🧪) — loads into the editor, played from scratch. */
export interface SavedBoardPosition extends SavedBase {
  kind: 'position';
  position: GridlockPosition;
}
/** A recorded game truncated to a chosen ply (⏪) — loads as a scrubbable replay. */
export interface SavedReplayGameplay extends SavedBase {
  kind: 'replay';
  replay: GridlockReplay;
  /** Number of moves kept (= replay.moves.length; stored for a quick label). */
  ply: number;
}
export type SavedPosition = SavedBoardPosition | SavedReplayGameplay;

export type SaveResult =
  | { ok: true; list: SavedPosition[]; entry: SavedPosition }
  | { ok: false; reason: 'empty' | 'full' | 'unavailable'; list: SavedPosition[] };

const sortNewest = (list: SavedPosition[]): SavedPosition[] => [...list].sort((a, b) => b.savedAt - a.savedAt);

/** Read + validate the stored array. Any malformed or corrupt entry is silently dropped. */
function readAll(): SavedPosition[] {
  try {
    const raw = localStorage.getItem(SAVES_KEY);
    if (!raw) return [];
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const out: SavedPosition[] = [];
    for (const e of arr) {
      if (!e || typeof e !== 'object') continue;
      const { id, name, savedAt, kind, position, replay, ply } = e as Record<string, unknown>;
      if (typeof id !== 'string' || typeof name !== 'string' || typeof savedAt !== 'number') continue;
      if (kind === 'replay') {
        try {
          const r = parseReplay(replay); // Zod-validates every move applies; throws on garbage
          out.push({ id, name, savedAt, kind: 'replay', replay: r, ply: typeof ply === 'number' ? ply : r.moves.length });
        } catch {
          continue;
        }
      } else {
        // 'position' OR a legacy entry saved before `kind` existed (both are board positions).
        try {
          parsePosition(position); // Zod-validates the shape; throws on garbage → entry dropped
          out.push({ id, name, savedAt, kind: 'position', position: position as GridlockPosition });
        } catch {
          continue;
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

function writeAll(list: SavedPosition[]): boolean {
  try {
    localStorage.setItem(SAVES_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false; // quota / unavailable
  }
}

let idSeq = 0;
const newId = () => `sbx-save-${Date.now().toString(36)}-${++idSeq}`;
const defaultName = (count: number) => `Position ${count + 1}`;
const defaultGameplayName = (ply: number) => ply === 0 ? 'Game (start)' : `Game (${ply} ${ply === 1 ? 'move' : 'moves'})`;

/** All saved positions, newest first. */
export function listSavedPositions(): SavedPosition[] {
  return sortNewest(readAll());
}

/** Save the current board+turn under a name. An empty board or a full library is rejected. */
export function saveSandboxPosition(name: string, board: Board, turn: PieceColor): SaveResult {
  const list = readAll();
  if (Object.keys(board).length === 0) return { ok: false, reason: 'empty', list: sortNewest(list) };
  if (list.length >= MAX_SAVES) return { ok: false, reason: 'full', list: sortNewest(list) };
  const entry: SavedPosition = {
    id: newId(),
    name: (name.trim() || defaultName(list.length)).slice(0, MAX_NAME),
    savedAt: Date.now(),
    kind: 'position',
    position: serializePosition(board, turn, null, 0, 1),
  };
  const next = [entry, ...list];
  if (!writeAll(next)) return { ok: false, reason: 'unavailable', list: sortNewest(list) };
  return { ok: true, list: sortNewest(next), entry };
}

/** Save a recorded game (already truncated to the chosen ply) as a replayable ⏪ entry. A move-less
 *  replay is allowed — it saves the starting position and loads back to the game's opening setup.
 *  Only a full library is rejected. The caller owns truncation (moves.slice). */
export function saveGameplayReplay(name: string, replay: GridlockReplay, ply: number): SaveResult {
  const list = readAll();
  if (list.length >= MAX_SAVES) return { ok: false, reason: 'full', list: sortNewest(list) };
  const entry: SavedReplayGameplay = {
    id: newId(),
    name: (name.trim() || defaultGameplayName(ply)).slice(0, MAX_NAME),
    savedAt: Date.now(),
    kind: 'replay',
    replay,
    ply,
  };
  const next = [entry, ...list];
  if (!writeAll(next)) return { ok: false, reason: 'unavailable', list: sortNewest(list) };
  return { ok: true, list: sortNewest(next), entry };
}

/** Remove one saved position; returns the remaining list (newest first). */
export function deleteSavedPosition(id: string): SavedPosition[] {
  const next = readAll().filter((e) => e.id !== id);
  writeAll(next);
  return sortNewest(next);
}

/** Rename a saved position (blank names are ignored); returns the updated list. */
export function renameSavedPosition(id: string, name: string): SavedPosition[] {
  const trimmed = name.trim().slice(0, MAX_NAME);
  const next = readAll().map((e) => (e.id === id && trimmed ? { ...e, name: trimmed } : e));
  writeAll(next);
  return sortNewest(next);
}

/** Rebuild a live board + side-to-move from a saved entry (throws only on a corrupt payload).
 *  For a ⏪ gameplay this is the FINAL position of the recorded game (for editor preview); the
 *  full scrubbable replay lives on `entry.replay`. */
export function loadSavedBoard(entry: SavedPosition): { board: Board; turn: PieceColor } {
  if (entry.kind === 'replay') {
    const st = replayTo(entry.replay);
    return { board: st.board, turn: st.turn };
  }
  const pos = parsePosition(entry.position);
  return { board: positionToBoard(pos), turn: pos.turn };
}
