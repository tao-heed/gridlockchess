// components/game/sandbox/ChargeEditor.tsx — pick a placed piece's charge "build" (or remove it).
//
// For an anomaly, shows its archetype's legal builds (§3.2) as pickable O·D·L chips — every option is
// guaranteed legal (no sliders). Omni is fixed (shared 8). King/Pawn have no charges. All pieces get
// a Remove action. Rendered as an inline panel by the Sandbox page when a square is selected.
import type { ReactNode } from 'react';
import type { Piece, VectorPool, OmniPool } from '@/types/game';
import { archetypeBuilds } from '@/lib/chess/sandbox/charges';
import { ARCHETYPE_DEFS_IN_ORDER } from '@/lib/chess/archetypes';

const sameVec = (a: VectorPool, b: VectorPool) => a.L === b.L && a.O === b.O && a.D === b.D;

/** One build shown as the game's O·D·L battery order (green / yellow / coral). */
function BuildChip({ build, active, onPick, label }: { build: VectorPool; active: boolean; onPick: () => void; label?: string }) {
  const cells: [string, number][] = [
    ['bg-gc-ortho', build.O],
    ['bg-gc-diag', build.D],
    ['bg-gc-leap', build.L],
  ];
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      aria-label={label ?? `Leap ${build.L}, Orthogonal ${build.O}, Diagonal ${build.D}`}
      title={label}
      className={`inline-flex overflow-hidden rounded-md ring-1 transition-all ${
        active ? 'ring-gc-accent ring-2' : 'ring-black/40 hover:ring-white/40'
      }`}
    >
      {cells.map(([bg, n], i) => (
        <span key={i} className={`${bg} flex h-6 w-6 items-center justify-center text-[12px] font-mono font-bold text-black`}>
          {n}
        </span>
      ))}
    </button>
  );
}

export interface ChargeEditorProps {
  piece: Piece;
  onPick: (vectors: VectorPool | OmniPool) => void;
  onRemove: () => void;
  onClose: () => void;
  /** Toggle whether the King pilots this anomaly (making it this side's royal). Non-omni only. */
  onTogglePiloted?: (next: boolean) => void;
  /** True when this side ALREADY has a royal elsewhere, so it can't become piloted (prevents two). */
  pilotDisabled?: boolean;
}

export function ChargeEditor({ piece, onPick, onRemove, onClose, onTogglePiloted, pilotDisabled = false }: ChargeEditorProps) {
  const name =
    piece.type === 'anomaly'
      ? (ARCHETYPE_DEFS_IN_ORDER.find((d) => d.key === piece.archetype)?.name ?? piece.archetype)
      : piece.type === 'king'
        ? 'King'
        : 'Pawn';

  const stdVectors = piece.type === 'anomaly' && piece.archetype !== 'omni' ? piece.vectors : null;
  const omniShared = piece.type === 'anomaly' && piece.archetype === 'omni' ? (piece.vectors as OmniPool).shared : null;
  const gridlocked =
    (!!stdVectors && stdVectors.L === 0 && stdVectors.O === 0 && stdVectors.D === 0) || omniShared === 0;
  // The King can "pilot" a (non-omni, non-gridlocked) Anomaly — they fuse into one royal piece: a
  // "Piloted Anomaly" (crown + life-ring). Canon term matches the Rules "Override" section. A 0/0/0
  // dead stone can't be a royal mount, so piloting is unavailable while gridlocked.
  const canPilot = piece.type === 'anomaly' && piece.archetype !== 'omni' && !gridlocked;
  const piloted = canPilot && !!piece.piloted;

  let body: ReactNode;
  if (piece.type === 'anomaly' && piece.archetype !== 'omni') {
    const builds = archetypeBuilds(piece.archetype);
    const current = piece.vectors;
    body = (
      <>
        <span className="text-[10px] uppercase tracking-widest text-gc-text-dim">Charge build (O · D · L)</span>
        <div className="flex flex-wrap gap-2">
          {builds.map((b, i) => (
            <BuildChip key={i} build={b} active={sameVec(current, b)} onPick={() => onPick(b)} />
          ))}
          {/* Gridlocked (dead stone): a 0/0/0 "build" shown alongside the legal builds. Un-pilots
              first (a stone can't be a royal mount), then zeroes the charges. */}
          <BuildChip
            build={{ L: 0, O: 0, D: 0 }}
            active={gridlocked}
            onPick={() => { if (piloted && onTogglePiloted) onTogglePiloted(false); onPick({ L: 0, O: 0, D: 0 }); }}
            label="Gridlocked (dead stone) — 0/0/0"
          />
        </div>
        {gridlocked ? (
          <span className="text-[10px] text-gc-text-dim/70">
            A 0/0/0 Gridlocked: it can’t move but still blocks paths and can be captured — great for maze/obstacle setups.
          </span>
        ) : (
          <span className="text-[10px] text-gc-text-dim/70">
            {current.O} Orthogonal, {current.D} Diagonal, {current.L} Leap
          </span>
        )}
      </>
    );
  } else if (piece.type === 'anomaly') {
    // Omni (Mech): ONE shared pool, rendered [8 8 8] exactly like the board (Piece.tsx) because any
    // move drains the single pool. Offer the full pool and a 0/0/0 gridlock (dead stone), mirroring
    // the standard chips so Omni is editable and consistent with every other Anomaly.
    body = (
      <>
        <span className="text-[10px] uppercase tracking-widest text-gc-text-dim">Charge build (O · D · L)</span>
        <div className="flex flex-wrap gap-2">
          <BuildChip build={{ L: 8, O: 8, D: 8 }} active={omniShared === 8} onPick={() => onPick({ shared: 8 })} label="Full shared pool — 8" />
          <BuildChip build={{ L: 0, O: 0, D: 0 }} active={omniShared === 0} onPick={() => onPick({ shared: 0 })} label="Gridlocked (dead stone) — 0/0/0" />
        </div>
        {gridlocked ? (
          <span className="text-[10px] text-gc-text-dim/70">
            A 0/0/0 Gridlocked: it can’t move but still blocks paths and can be captured — great for maze/obstacle setups.
          </span>
        ) : (
          <span className="text-[10px] text-gc-text-dim/70">
            {omniShared} shared charges — every move drains the one pool (any direction).
          </span>
        )}
      </>
    );
  } else {
    body = <span className="text-[12px] text-gc-text-dim">This piece has no charges.</span>;
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-gc-panel-2 p-3 ring-1 ring-white/10">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold capitalize text-gc-text">{name}</span>
        <button type="button" onClick={onClose} aria-label="Close" className="px-1 text-lg leading-none text-gc-text-dim hover:text-gc-text">×</button>
      </div>

      {body}

      {canPilot && onTogglePiloted && (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => onTogglePiloted(!piloted)}
            disabled={!piloted && pilotDisabled}
            aria-pressed={piloted}
            className={`inline-flex items-center gap-2 self-start rounded-lg px-3 py-1.5 text-[12px] font-semibold ring-1 transition-colors ${
              piloted
                ? 'bg-amber-400/15 text-amber-300 ring-amber-400/50 hover:bg-amber-400/25'
                : pilotDisabled
                  ? 'cursor-not-allowed text-gc-text-dim/40 ring-white/10'
                  : 'text-gc-text-dim ring-white/15 hover:text-gc-text hover:ring-white/30'
            } focus:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent`}
          >
            <span aria-hidden="true">👑</span>
            {piloted ? 'Piloted Anomaly · on' : 'Make Piloted Anomaly'}
          </button>
          <span className="text-[10px] text-gc-text-dim/70">
            {piloted
              ? 'The King has fused in — this is your royal piece.'
              : pilotDisabled
                ? 'This side already has a King — remove it first (one royal per side).'
                : 'Fuse the King into this Anomaly — it becomes your royal piece.'}
          </span>
        </div>
      )}

      <button
        type="button"
        onClick={onRemove}
        className="self-start text-[12px] font-semibold text-red-300/90 hover:text-red-200 rounded-lg px-3 py-1 ring-1 ring-red-400/30 hover:ring-red-400/50 transition-colors"
      >
        Remove piece
      </button>
    </div>
  );
}
