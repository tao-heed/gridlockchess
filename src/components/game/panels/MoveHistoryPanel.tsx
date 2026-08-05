// components/game/panels/MoveHistoryPanel.tsx — Replay controls (JSON export + scrub timeline)
//
// A compact replay console rather than a move table: export the game as a portable JSON
// download, scrub through the recorded plies on a clickable / keyboard-accessible timeline,
// and import a saved replay. Human-readable text copy was removed — Gridlock's dynamic
// mechanics can't be replayed on a physical board, so only the re-importable JSON matters.

import { useState, useRef } from 'react';

/** Reject an imported file larger than this before reading it (client-side DoS guard) — a
 *  cheap first gate so a multi-hundred-MB file is never slurped into memory. This must stay
 *  strictly LOOSER than the authoritative move-count cap so it never rejects a schema-legal
 *  file: MAX_REPLAY_MOVES (40k) at ~24 bytes/move ≈ ~1 MB, so 2 MB leaves clear headroom.
 *  The real bound is MAX_REPLAY_MOVES in the replay schema. */
const MAX_REPLAY_BYTES = 2_000_000;

export interface MoveHistoryPanelProps {
  /** Currently viewed ply (0 = start), or null when watching the live game. */
  viewPly: number | null;
  /** Total applied plies recorded for replay. */
  plyCount: number;
  /** Seek the board to a ply (0..plyCount). plyCount returns to live. */
  onSeek: (ply: number) => void;
  /** Lazily serialize the portable GridlockReplay JSON — called only on the JSON download. */
  getReplayJson: () => string;
  /** Browse → read a .json replay; raw text + filename are handed up for confirmation. */
  onImportReplay: (json: string, fileName: string) => void;
  /** Save the game up to the currently-viewed ply as a replayable ⏪ entry in the Sandbox
   *  library. Given the ply so the caller can truncate the live replay to exactly that point. */
  onSaveGameplay?: (ply: number) => void;
}

export function MoveHistoryPanel({
  viewPly,
  plyCount,
  onSeek,
  getReplayJson,
  onImportReplay,
  onSaveGameplay,
}: MoveHistoryPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [copiedJson, setCopiedJson] = useState(false);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-importing the same file
    if (!file) return;
    // Reject an oversized file BEFORE reading it into memory. Genuine replays are ~3\u20135 KB;
    // the MAX_REPLAY_BYTES cap stops a hostile multi-hundred-MB file from being slurped via
    // file.text() (a client-side DoS on the importer's own tab). It is kept looser than the
    // schema's MAX_REPLAY_MOVES (the authoritative guard) so it never rejects a legal file;
    // this is just the cheap first gate.
    if (file.size > MAX_REPLAY_BYTES) {
      // Route through the same parse path with empty text so the parent surfaces its standard
      // \u201Cnot a valid replay\u201D error \u2014 one error channel, no huge read performed.
      onImportReplay('', file.name);
      return;
    }
    file.text().then((text) => onImportReplay(text, file.name));
  };

  const downloadJson = () => {
    if (plyCount === 0) return;
    const json = getReplayJson();
    if (!json) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gridlock-replay-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 1500);
  };

  // Current scrub position: viewPly when scrubbing, otherwise the end of the game.
  const cur = viewPly ?? plyCount;
  const atStart = cur <= 0;
  const atEnd = cur >= plyCount;
  const isLive = viewPly === null;
  const hasMoves = plyCount > 0;
  const pct = hasMoves ? (cur / plyCount) * 100 : 0;

  // Click / drag anywhere on the timeline to seek to that ply.
  const seekFromPointer = (clientX: number, el: HTMLElement) => {
    if (!hasMoves) return;
    const rect = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onSeek(Math.round(frac * plyCount));
  };

  const onTimelineKey = (e: React.KeyboardEvent) => {
    if (!hasMoves) return;
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown': e.preventDefault(); onSeek(cur - 1); break;
      case 'ArrowRight':
      case 'ArrowUp': e.preventDefault(); onSeek(cur + 1); break;
      case 'Home': e.preventDefault(); onSeek(0); break;
      case 'End': e.preventDefault(); onSeek(plyCount); break;
    }
  };

  const stepBtn =
    'flex items-center justify-center w-9 h-7 text-sm text-gc-text-dim rounded-lg ' +
    'transition-colors hover:bg-white/10 hover:text-gc-text active:scale-95 ' +
    'disabled:opacity-25 disabled:cursor-default disabled:hover:bg-transparent';

  return (
    <div className="pt-1 flex flex-col items-center gap-1.5">
      {/* Position readout — LIVE or a "REVIEW · n / total" badge, centered above the scrubber.
          Both states share the badge shape; the color + dot encode the mode: emerald pulsing
          dot = watching live, static amber dot = reviewing a past frame. */}
      <span
        className={`inline-flex items-center gap-1.5 text-[10px] font-mono font-semibold tabular-nums px-2 py-0.5 rounded-md ring-1 ${
          isLive
            ? 'text-emerald-300 ring-emerald-400/30 bg-emerald-400/10'
            : 'text-amber-300 ring-amber-400/30 bg-amber-400/10'
        }`}
        title={isLive ? 'Watching the live game' : `Reviewing move ${cur} of ${plyCount}`}
      >
        {isLive ? (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            LIVE · {plyCount} {plyCount === 1 ? 'move' : 'moves'}
          </>
        ) : (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            REVIEW · {cur} / {plyCount}
          </>
        )}
      </span>

      {/* Timeline — scrub position as a clickable, keyboard-accessible track (shorter, centered). */}
      <div
        role="slider"
        aria-label="Replay position"
        aria-valuemin={0}
        aria-valuemax={plyCount}
        aria-valuenow={cur}
        aria-valuetext={isLive ? 'Live' : `Move ${cur} of ${plyCount}`}
        tabIndex={hasMoves ? 0 : -1}
        onKeyDown={onTimelineKey}
        onPointerDown={(e) => {
          if (!hasMoves) return;
          // Stop the parent swipe-deck from reading this scrub as a page swipe.
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFromPointer(e.clientX, e.currentTarget);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) seekFromPointer(e.clientX, e.currentTarget);
        }}
        className={`group relative h-6 flex items-center w-full max-w-[16rem] outline-none ${hasMoves ? 'cursor-pointer' : 'cursor-default'} focus-visible:ring-2 focus-visible:ring-gc-accent/50 rounded-full`}
      >
        <div className="relative w-full h-1.5 rounded-full bg-white/10 overflow-visible">
          {/* progress fill */}
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-gc-accent/60 to-gc-accent transition-[width] duration-200"
            style={{ width: `${pct}%` }}
          />
          {/* thumb */}
          {hasMoves && (
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3 w-3 rounded-full bg-gc-accent ring-2 ring-gc-panel-2 shadow-[0_0_8px_rgba(34,224,255,0.6)] transition-[left] duration-200 group-hover:scale-125"
              style={{ left: `${pct}%` }}
            />
          )}
        </div>
      </div>

      {/* Transport — tight, centered cluster (segmented feel). */}
      <div className="inline-flex items-center gap-0.5 rounded-xl bg-white/[0.03] ring-1 ring-white/5 p-0.5">
        <button onClick={() => onSeek(0)} disabled={atStart} className={stepBtn} title="Start">⏮</button>
        <button onClick={() => onSeek(cur - 1)} disabled={atStart} className={stepBtn} title="Back">◀</button>
        <button onClick={() => onSeek(cur + 1)} disabled={atEnd} className={stepBtn} title="Forward">▶</button>
        <button onClick={() => onSeek(plyCount)} disabled={atEnd} className={stepBtn} title="Live">⏭</button>
      </div>

      {/* Save the game up to the viewed ply into the Sandbox as a scrubbable ⏪ replay. Shows the
          exact cut ("n/total") so it's clear you're saving the REWOUND point, not the live end.
          Available from the very start (0 moves) — saving then captures the opening setup. */}
      {onSaveGameplay && (
        <button
          type="button"
          onClick={() => onSaveGameplay(cur)}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold text-gc-accent ring-1 ring-gc-accent/30 bg-gc-accent/10 hover:bg-gc-accent/20 hover:ring-gc-accent/50 active:scale-[0.98] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent/70"
          title={atEnd
            ? 'Save this whole game to your Sandbox library so you can replay it later'
            : `Save the game up to move ${cur} of ${plyCount} to your Sandbox library so you can replay it later`}
        >
          ⏪ {atEnd ? 'Save this game to Sandbox' : `Save to Sandbox · ${cur}/${plyCount}`}
        </button>
      )}

      {/* Export / Import — paired, clearly-labelled replay actions. Download is the accent
          "primary" (filled tint) so it reads as obviously clickable; Import is the neutral
          sibling. Tooltips spell out the .json replay meaning for first-time players. */}
      <input ref={fileRef} type="file" accept="application/json,.json" onChange={onFile} className="hidden" />
      {/* Download / Import temporarily HIDDEN (logic kept & fully wired). Unhide later by
          removing the `style={{ display: 'none' }}` below. */}
      <div className="mt-3 grid grid-cols-2 gap-2" style={{ display: 'none' }}>
        <button
          onClick={downloadJson}
          disabled={!hasMoves}
          className={`group inline-flex items-center justify-center gap-1.5 text-[11px] font-semibold px-2 py-2 rounded-lg transition-all active:scale-[0.98] ${
            copiedJson
              ? 'text-emerald-300 ring-1 ring-emerald-400/40 bg-emerald-400/10'
              : 'text-gc-accent ring-1 ring-gc-accent/30 bg-gc-accent/10 hover:bg-gc-accent/20 hover:ring-gc-accent/50'
          } disabled:opacity-30 disabled:cursor-default disabled:text-gc-text-dim disabled:ring-white/5 disabled:bg-transparent disabled:hover:bg-transparent`}
          title="Download this game as a portable replay file (.json) you can re-open later"
        >
          {copiedJson ? (
            '✓ Saved'
          ) : (
            <>
              <span className="text-sm leading-none transition-transform group-hover:translate-y-0.5">⬇</span>
              Download
            </>
          )}
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="group inline-flex items-center justify-center gap-1.5 text-[11px] font-semibold text-gc-text-dim hover:text-gc-accent px-2 py-2 rounded-lg ring-1 ring-white/5 bg-white/[0.02] hover:bg-white/5 hover:ring-gc-accent/20 transition-all active:scale-[0.98]"
          title="Load a saved Gridlock replay (.json) and replace the current board"
        >
          <span className="text-sm leading-none transition-transform group-hover:-translate-y-0.5">⬆</span>
          Import
        </button>
      </div>
    </div>
  );
}
