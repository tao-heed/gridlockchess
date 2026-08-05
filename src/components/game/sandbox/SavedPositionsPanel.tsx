// components/game/sandbox/SavedPositionsPanel.tsx — Save/load a library of favourite Sandbox boards.
//
// Self-contained: owns the list state, reading it once on mount and updating it from each store
// mutation's returned list (no reload race). Saving a position does NOT require a legal setup — a
// work-in-progress board is a perfectly good favourite — so it is gated only on a non-empty board.
import { useState } from 'react';
import type { Board, PieceColor } from '@/types/game';
import type { GridlockReplay } from '@/lib/chess/format';
import {
  listSavedPositions,
  saveSandboxPosition,
  deleteSavedPosition,
  renameSavedPosition,
  loadSavedBoard,
  MAX_SAVES,
  type SavedPosition,
} from '@/lib/chess/sandbox/savedPositions';

export interface SavedPositionsPanelProps {
  board: Board;
  turn: PieceColor;
  /** Load a saved board position (🧪) into the editor. */
  onLoadPosition: (board: Board, turn: PieceColor) => void;
  /** Load a saved recorded game (⏪) — arms "Play this recorded game" with the full replay. */
  onLoadGameplay: (replay: GridlockReplay, name: string) => void;
  /** Surface a transient status message (reuses the page toast). */
  notify: (msg: string) => void;
}

export function SavedPositionsPanel({ board, turn, onLoadPosition, onLoadGameplay, notify }: SavedPositionsPanelProps) {
  const [list, setList] = useState<SavedPosition[]>(() => listSavedPositions());
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const save = () => {
    const res = saveSandboxPosition(name, board, turn);
    setList(res.list);
    if (res.ok) { setName(''); notify(`Saved “${res.entry.name}”.`); }
    else notify(
      res.reason === 'empty' ? 'Nothing to save — the board is empty.'
        : res.reason === 'full' ? `Library full (${res.list.length}) — delete one first.`
          : 'Couldn’t save — storage unavailable.',
    );
  };

  const load = (entry: SavedPosition) => {
    try {
      if (entry.kind === 'replay') {
        onLoadGameplay(entry.replay, entry.name);
        notify(`Loaded gameplay “${entry.name}”.`);
      } else {
        const { board: b, turn: t } = loadSavedBoard(entry);
        onLoadPosition(b, t);
        notify(`Loaded “${entry.name}”.`);
      }
    } catch {
      notify('That save is corrupt and can’t be loaded.');
    }
  };

  const remove = (entry: SavedPosition) => {
    setList(deleteSavedPosition(entry.id));
    notify(`Deleted “${entry.name}”.`);
  };

  const startRename = (entry: SavedPosition) => { setEditingId(entry.id); setEditName(entry.name); };
  const cancelRename = () => { setEditingId(null); setEditName(''); };
  const commitRename = (entry: SavedPosition) => {
    if (editingId !== entry.id) return; // already committed or cancelled (guards the onBlur race)
    const trimmed = editName.trim();
    if (trimmed && trimmed !== entry.name) {
      setList(renameSavedPosition(entry.id, trimmed));
      notify(`Renamed to “${trimmed.slice(0, 40)}”.`);
    }
    setEditingId(null);
    setEditName('');
  };

  return (
    <section aria-label="Saved Positions" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-widest text-gc-text-dim">Saved Positions</span>
        {list.length > 0 && (
          <span className={`text-[10px] tabular-nums ${list.length >= MAX_SAVES ? 'text-amber-400' : list.length >= MAX_SAVES - 5 ? 'text-amber-400/70' : 'text-gc-text-dim/60'}`}>
            {list.length}/{MAX_SAVES}
          </span>
        )}
      </div>

      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
          placeholder="Name this position (optional)"
          maxLength={40}
          aria-label="Name for the saved position"
          className="flex-1 min-w-0 rounded-lg bg-gc-panel-2 px-3 py-2 text-[13px] text-gc-text ring-1 ring-white/10 placeholder:text-gc-text-dim/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent/70"
        />
        <button
          type="button"
          onClick={save}
          className="shrink-0 rounded-lg bg-gc-accent/15 px-3 py-2 text-[13px] font-semibold text-gc-accent ring-1 ring-gc-accent/40 hover:bg-gc-accent/25 active:scale-95 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent"
        >
          💾 Save
        </button>
      </div>

      {list.length === 0 ? (
        <p className="text-[12px] text-gc-text-dim/70">No saved positions yet — build a board and tap Save.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {list.map((e) => (
            <li key={e.id} className="flex items-center gap-2 rounded-lg bg-gc-panel-2/60 px-3 py-2 ring-1 ring-white/5">
              <span className="shrink-0 text-base leading-none" title={e.kind === 'replay' ? 'Recorded game' : 'Saved from Sandbox'} aria-hidden="true">{e.kind === 'replay' ? '⏪' : '🧪'}</span>
              <div className="min-w-0 flex-1">
                {editingId === e.id ? (
                  <input
                    value={editName}
                    autoFocus
                    onChange={(ev) => setEditName(ev.target.value)}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter') commitRename(e);
                      else if (ev.key === 'Escape') cancelRename();
                    }}
                    onBlur={() => commitRename(e)}
                    maxLength={40}
                    aria-label={`Rename ${e.name}`}
                    className="w-full rounded-md bg-gc-panel px-2 py-1 text-[13px] text-gc-text ring-1 ring-gc-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent"
                  />
                ) : (
                  <>
                    <div className="truncate text-[13px] font-medium text-gc-text">{e.name}</div>
                    <div className="text-[10px] text-gc-text-dim/60">
                      {new Date(e.savedAt).toLocaleDateString()}{e.kind === 'replay' ? ` · ${e.ply} ${e.ply === 1 ? 'move' : 'moves'}` : ''}
                    </div>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => load(e)}
                className="shrink-0 rounded-md px-2.5 py-1 text-[12px] font-semibold text-gc-accent ring-1 ring-gc-accent/40 hover:bg-gc-accent/15 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent"
              >
                Load
              </button>
              <button
                type="button"
                onMouseDown={(ev) => { if (editingId === e.id) ev.preventDefault(); }}
                onClick={() => (editingId === e.id ? commitRename(e) : startRename(e))}
                aria-label={editingId === e.id ? 'Save name' : `Rename ${e.name}`}
                className="shrink-0 grid place-items-center w-7 h-7 rounded-md text-gc-accent ring-1 ring-gc-accent/40 hover:bg-gc-accent/15 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent"
              >
                {editingId === e.id ? (
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                  </svg>
                )}
              </button>
              <button
                type="button"
                onClick={() => remove(e)}
                aria-label={`Delete ${e.name}`}
                className="shrink-0 grid place-items-center w-7 h-7 rounded-md text-red-300/90 ring-1 ring-red-400/30 hover:bg-red-500/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/70"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
