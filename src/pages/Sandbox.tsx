// pages/Sandbox.tsx — Free-form position editor ("Sandbox"). Reached from the Opponent dropdown.
//
// Stage 3: build a position (place/remove/charge-pick) then Play it. Validation gates Play; the
// handoff wraps the board as a zero-move GridlockReplay and navigates to /play, where LocalGame's
// mount-restore loads it (mirrors the resume path). Pure logic lives in lib/chess/sandbox/.
import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import type { PieceColor, Square } from '@/types/game';
import type { BotDifficulty } from '@/lib/chess/bot';

import { serializePosition, replayTo, parseReplay, type GridlockReplay } from '@/lib/chess/format';
import { SandboxBoard, type BoardOrientation } from '@/components/game/sandbox/SandboxBoard';
import { PalettePanel, type BoardMode } from '@/components/game/sandbox/PalettePanel';
import { ChargeEditor } from '@/components/game/sandbox/ChargeEditor';
import { SandboxToolbar } from '@/components/game/sandbox/SandboxToolbar';
import { SavedPositionsPanel } from '@/components/game/sandbox/SavedPositionsPanel';
import { useSandbox, samePaletteItem, createSandboxPiece, type PaletteItem } from '@/hooks/useSandbox';
import { useProtocolRunDry } from '@/hooks/useProtocolRunDry';
import { validateSetup, placementViolation } from '@/lib/chess/sandbox/setupValidation';
import { buildSandboxReplay } from '@/lib/chess/sandbox/buildSandboxReplay';
import { ARCHETYPE_DEFS_IN_ORDER } from '@/lib/chess/archetypes';

/** A loaded ⏪ recorded game marker: the full replay, its display name, and the serialized final
 *  board it was loaded at (used to detect edits). Persisted so it survives a game↔sandbox round-trip. */
type LoadedGameplay = { replay: GridlockReplay; name: string; sig: string };

const SANDBOX_LOADED_KEY = 'gridlock:sandbox-loaded:v1';

/** Restore the loaded-gameplay marker (validated). Corrupt/absent → null. The board it belongs to is
 *  restored separately by useSandbox; the sig-guard effect drops this if the board no longer matches. */
function loadPersistedLoadedGameplay(): LoadedGameplay | null {
  try {
    const raw = localStorage.getItem(SANDBOX_LOADED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { replay?: unknown; name?: unknown; sig?: unknown };
    if (typeof parsed.name !== 'string' || typeof parsed.sig !== 'string') return null;
    return { replay: parseReplay(parsed.replay), name: parsed.name, sig: parsed.sig }; // parseReplay throws on garbage
  } catch {
    return null;
  }
}

/** Write-through the loaded-gameplay marker (or clear it when null). Best-effort. */
function persistLoadedGameplay(v: LoadedGameplay | null): void {
  try {
    if (v) localStorage.setItem(SANDBOX_LOADED_KEY, JSON.stringify(v));
    else localStorage.removeItem(SANDBOX_LOADED_KEY);
  } catch {
    /* quota / unavailable — best-effort */
  }
}

function armedLabel(sb: ReturnType<typeof useSandbox>): string | null {
  const a = sb.armed;
  if (!a) return null;
  const color = a.color === 'white' ? 'White' : 'Black';
  if (a.kind === 'king') return `${color} King`;
  if (a.kind === 'pawn') return `${color} Pawn`;
  const name = ARCHETYPE_DEFS_IN_ORDER.find((d) => d.key === a.archetype)?.name ?? a.archetype;
  return `${color} ${name}`;
}

export function SandboxPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const sb = useSandbox();
  const { unlockedBots } = useProtocolRunDry({});
  const armed = armedLabel(sb);
  const validation = validateSetup(sb.board, sb.turn);
  const selectedPiece = sb.selected ? sb.board[sb.selected] : undefined;
  // The selected anomaly can only become the King's mount if its side has NO other royal (a plain
  // King, or another piloted anomaly) — otherwise piloting it would create two royals for that side.
  const pilotDisabled =
    !!selectedPiece &&
    selectedPiece.type === 'anomaly' &&
    Object.entries(sb.board).some(
      ([sq, p]) => !!p && sq !== sb.selected && p.color === selectedPiece.color && (p.type === 'king' || (p.type === 'anomaly' && p.archetype !== 'omni' && !!p.piloted)),
    );

  // Opponent config (page-local; independent of the board). null = hot-seat. When we arrive back
  // from a game via its "Edit position" action, the router carries the last opponent/side so the
  // toolbar picks up exactly where the player left off (the board itself persists in localStorage).
  const resume = location.state as { sandboxOpponent?: string; sandboxHumanColor?: PieceColor; sandboxBothBots?: boolean } | null;
  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty | null>(() => {
    const o = resume?.sandboxOpponent;
    if (!o || o === 'offline' || o === 'uplink' || o === 'protocol-run-dry') return null;
    return o as BotDifficulty;
  });
  const [humanColor, setHumanColor] = useState<PieceColor>(resume?.sandboxHumanColor ?? 'white');
  // Both-Bots: two bots of the selected level play each other (White vs Black). Only meaningful
  // when an opponent (bot) is selected; ignored in Pass & Play. Restored on the game → 🧪 round-trip.
  const [bothBots, setBothBots] = useState(resume?.sandboxBothBots ?? false);

  // Single board-mode cycle button (replaces the separate Mirror + Flip controls):
  // Normal → Mirror → Reverse → 90° → 180° → 270° → Normal. The modes are mutually exclusive; the
  // rotations step a consistent 90° clockwise each tap.
  //  • mirror  = twin-placement helper — White on your half auto-mirrors as Black on the opposite
  //              rank, SAME file (r ↔ 9−r).
  //  • reverse = twin-placement helper — White on your half auto-mirrors as Black point-reflected
  //              across the centre: OPPOSITE file AND opposite rank (e.g. d3 → e6).
  //  • rot90   = view only, 90° CW — White on the left; placement is unrestricted.
  //  • rot180  = view only, 180° — White at the top; placement is unrestricted.
  //  • rot270  = view only, 270° CW — White on the right; placement is unrestricted.
  const [boardMode, setBoardMode] = useState<BoardMode>('normal');
  // `mirror` here means "twin-placement active" (either mirror or reverse) — both build on your
  // half (ranks 1–4) and auto-generate the Black twin, so the placement code path is shared.
  const mirror = boardMode === 'mirror' || boardMode === 'reverse';
  // Board orientation (view only). White is the default; the three rotations are pure turns.
  const orientation: BoardOrientation =
    boardMode === 'rot180' ? 'black' : boardMode === 'rot90' ? 'right' : boardMode === 'rot270' ? 'left' : 'white';
  const flipFile = (f: string): string =>
    String.fromCharCode('a'.charCodeAt(0) + 'h'.charCodeAt(0) - f.charCodeAt(0));
  // The auto-generated Black twin for a placed White square. Reverse also flips the file.
  const mirrorOf = (sq: Square): Square =>
    (boardMode === 'reverse'
      ? `${flipFile(sq[0])}${9 - Number(sq[1])}`
      : `${sq[0]}${9 - Number(sq[1])}`) as Square;
  const cycleBoardMode = () => {
    const order: BoardMode[] = ['normal', 'mirror', 'reverse', 'rot90', 'rot180', 'rot270'];
    const next = order[(order.indexOf(boardMode) + 1) % order.length];
    // Twin modes place White only (Black is auto-generated) — drop a stray armed Black chip.
    if ((next === 'mirror' || next === 'reverse') && sb.armed?.color === 'black') sb.arm(null);
    setBoardMode(next);
  };

  // Transient message shown when an illegal placement is rejected (auto-dismisses).
  const [toast, setToast] = useState<{ id: number; msg: string } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(t);
  }, [toast]);

  // A loaded ⏪ recorded game (from the saved list). While set, Play launches the full replay
  // (scrubbable) instead of the board-as-position. `sig` is the serialized final board it was
  // loaded at; the effect below drops the gameplay the moment the board is edited away from it, so
  // touching the board naturally reverts to plain position editing.
  const [loadedGameplay, setLoadedGameplay] = useState<LoadedGameplay | null>(loadPersistedLoadedGameplay);
  useEffect(() => {
    if (!loadedGameplay) return;
    const sig = JSON.stringify(serializePosition(sb.board, sb.turn, null, 0, 1));
    if (sig !== loadedGameplay.sig) setLoadedGameplay(null);
  }, [sb.board, sb.turn, loadedGameplay]);
  // Persist the marker so returning from a game via the "Edit position" pen keeps "Play this recorded
  // game" (the board persists too, and the guard above re-validates on return — dropping it only if
  // the board was actually edited). Cleared from storage the moment it goes null.
  useEffect(() => { persistLoadedGameplay(loadedGameplay); }, [loadedGameplay]);

  const play = () => {
    // Carry an EXPLICIT view rotation (90/180/270) into the game so the board opens the way you
    // left it in the editor. normal/mirror/reverse send nothing → the game keeps its colour-based
    // default (White → 0°, Black → 180°). Mirror/Reverse are placement helpers, not view angles.
    const sandboxBoardAngle: 90 | 180 | 270 | undefined =
      boardMode === 'rot90' ? 90 : boardMode === 'rot180' ? 180 : boardMode === 'rot270' ? 270 : undefined;
    // A loaded recorded game: hand off the FULL replay (real moves) + flag replay mode so the
    // game opens on the Replay scrubber. Its final position is always legal, so no gating.
    if (loadedGameplay) {
      navigate('/play', {
        state: {
          loadSandbox: loadedGameplay.replay,
          sandboxOpponent: botDifficulty ?? 'offline',
          sandboxColor: botDifficulty ? humanColor : sb.turn,
          sandboxBothBots: botDifficulty ? bothBots : false,
          sandboxReplayMode: true,
          sandboxBoardAngle,
        },
      });
      return;
    }
    if (!validation.ok) return;
    navigate('/play', {
      state: {
        loadSandbox: buildSandboxReplay(sb.board, sb.turn),
        sandboxOpponent: botDifficulty ?? 'offline',
        sandboxColor: botDifficulty ? humanColor : sb.turn,
        sandboxBothBots: botDifficulty ? bothBots : false,
        sandboxBoardAngle,
      },
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-gc-bg text-gc-text">
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 top-16 z-50 flex justify-center px-4" role="status" aria-live="assertive">
          <div className="rounded-lg bg-amber-500 px-4 py-2 text-[13px] font-semibold text-black shadow-lg">
            {toast.msg}
          </div>
        </div>
      )}
      <header className="flex items-center gap-3 px-4 h-14 border-b border-white/10 shrink-0">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-sm text-gc-text-dim hover:text-gc-text transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent/70 rounded-lg px-2 py-1"
        >
          ← Back
        </button>
        <h1 className="font-display font-bold text-lg">Sandbox</h1>
      </header>

      <main className="flex-1 w-full max-w-[640px] mx-auto p-4 flex flex-col gap-4">
        <SandboxToolbar
          botDifficulty={botDifficulty}
          onSetBot={setBotDifficulty}
          humanColor={humanColor}
          onSetHumanColor={setHumanColor}
          turn={sb.turn}
          onSetTurn={sb.setTurn}
          bothBots={bothBots}
          onSetBothBots={setBothBots}
          unlockedBots={unlockedBots}
        />

        <SandboxBoard
          board={sb.board}
          selected={sb.selected}
          orientation={orientation}
          mirror={mirror}
          onSquareTap={(sq) => {
            // Mirror mode: build only on your half (ranks 1–4); each edit is mirrored as Black on the
            // opposite rank. The top half is generated, so it's read-only here.
            if (mirror) {
              const rank = Number(sq[1]);
              if (rank >= 5) {
                setToast({ id: Date.now(), msg: `${boardMode === 'reverse' ? 'Reverse' : 'Mirror'} mode: build on your half (ranks 1–4) — the top mirrors automatically.` });
                return;
              }
              const mSq = mirrorOf(sq);
              // Occupied: tap-again removes the piece AND its mirror; otherwise open its editor.
              if (sb.board[sq]) {
                if (sb.selected === sq) { sb.removeAt([sq, mSq]); sb.select(null); }
                else { sb.arm(null); sb.select(sq); }
                return;
              }
              // Empty + armed chip: place White here and its Black mirror opposite (single Undo).
              if (sb.armed) {
                const whitePiece = createSandboxPiece({ ...sb.armed, color: 'white' } as PaletteItem);
                const reason = placementViolation(sb.board, whitePiece, sq, sb.turn);
                if (reason) { setToast({ id: Date.now(), msg: reason }); return; }
                const blackPiece = createSandboxPiece({ ...sb.armed, color: 'black' } as PaletteItem);
                sb.placePair([{ square: sq, piece: whitePiece }, { square: mSq, piece: blackPiece }]);
                return;
              }
              // Empty + a selected White piece: MOVE it AND its Black twin to the mirrored
              // destination (one Undo). Validate with BOTH twins lifted so neither counts as a
              // blocker / second-royal against its own move.
              const mMoving = sb.selected ? sb.board[sb.selected] : undefined;
              if (sb.selected && mMoving) {
                const srcMirror = mirrorOf(sb.selected);
                const lifted = { ...sb.board };
                delete lifted[sb.selected];
                delete lifted[srcMirror];
                const reason = placementViolation(lifted, mMoving, sq, sb.turn);
                if (reason) { setToast({ id: Date.now(), msg: reason }); return; }
                sb.movePair([{ from: sb.selected, to: sq }, { from: srcMirror, to: mSq }]);
                sb.select(sq);
                return;
              }
              // Empty with nothing armed/selected — clear any stale selection.
              sb.select(null);
              return;
            }
            // A square that already holds a piece ALWAYS opens that piece's editor — even while a
            // chip is armed — so you can tweak an anomaly's charges (or remove it) right after
            // dropping it, with no need to disarm first. Tapping the same selected piece deletes it.
            if (sb.board[sq]) {
              if (sb.selected === sq) { sb.remove(sq); sb.select(null); }
              else { sb.arm(null); sb.select(sq); }
              return;
            }
            // Empty square + armed chip: place it (rejecting illegal drops).
            if (sb.armed) {
              const reason = placementViolation(sb.board, createSandboxPiece(sb.armed), sq, sb.turn);
              if (reason) { setToast({ id: Date.now(), msg: reason }); return; }
              sb.place(sq);
              return;
            }
            // Empty square + a selected piece: MOVE it there. Validate against the board with the
            // piece lifted off its origin, so back-rank / self-check rules apply exactly as they
            // would for a fresh placement (and moving the lone King never trips the second-King rule).
            const moving = sb.selected ? sb.board[sb.selected] : undefined;
            if (sb.selected && moving) {
              const lifted = { ...sb.board };
              delete lifted[sb.selected];
              const reason = placementViolation(lifted, moving, sq, sb.turn);
              if (reason) { setToast({ id: Date.now(), msg: reason }); return; }
              sb.move(sb.selected, sq);
              sb.select(sq);
              return;
            }
            // Empty square with nothing armed or selected — clear any stale selection.
            sb.select(null);
          }}
        />

        {sb.selected && selectedPiece && (
          <ChargeEditor
            piece={selectedPiece}
            onPick={(v) => sb.setCharges(sb.selected!, v, mirror ? mirrorOf(sb.selected!) : undefined)}
            onRemove={() => {
              const sel = sb.selected;
              if (sel) { if (mirror) sb.removeAt([sel, mirrorOf(sel)]); else sb.remove(sel); }
              sb.select(null);
            }}
            onClose={() => sb.select(null)}
            onTogglePiloted={(next) => sb.setPiloted(sb.selected!, next, mirror ? mirrorOf(sb.selected!) : undefined)}
            pilotDisabled={pilotDisabled}
          />
        )}

        <p className="min-h-[1.25rem] text-[13px] text-gc-text-dim" aria-live="polite">
          {mirror
            ? <><span className="font-semibold text-gc-accent">{boardMode === 'reverse' ? 'Reverse on' : 'Mirror on'}</span> — place White on your half (ranks 1–4); it auto-mirrors as Black{boardMode === 'reverse' ? ' point-reflected but opposite' : ''}.</>
            : armed
              ? <>Placing <span className="font-semibold text-gc-text">{armed}</span> — tap squares to place. Tap the same chip again to stop.</>
              : <>Tap a piece below, then a square, to place it. Tap a placed piece to move or edit it; <span className="font-semibold text-gc-text">tap it again to delete</span>.</>}
        </p>

        {/* Validation-gated Play (bypassed for a loaded recorded game — its final board is legal). */}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={play}
            disabled={!loadedGameplay && !validation.ok}
            className={`w-full rounded-xl py-3 text-sm font-bold transition-colors ${
              loadedGameplay || validation.ok
                ? 'bg-gc-accent text-gc-bg hover:bg-gc-accent/90'
                : 'cursor-not-allowed bg-gc-panel-2 text-gc-text-dim ring-1 ring-white/10'
            }`}
          >
            {loadedGameplay ? '▶ Play this recorded game' : '▶ Play this position'}
          </button>
          {loadedGameplay ? (
            <p className="text-[12px] text-gc-text-dim/80" aria-live="polite">
              ⏪ <span className="font-semibold text-gc-text">{loadedGameplay.name}</span> loaded · {loadedGameplay.replay.moves.length} moves. Play to review — rewind on the Replay panel. Editing the board reverts to a position.
            </p>
          ) : !validation.ok && (
            <div className="rounded-lg bg-red-500/10 px-3 py-1.5 ring-1 ring-red-400/30" aria-live="polite">
              <p className="text-[12px] text-red-300/90">
                <span className="font-semibold text-red-300">⚠ Can't play yet:</span>{' '}
                {validation.errors.map((e) => e.message.replace(/\.$/, '')).join(' · ')}
              </p>
            </div>
          )}
        </div>

        <PalettePanel
          armed={sb.armed}
          onArm={(item) => sb.arm(samePaletteItem(sb.armed, item) ? null : item)}
          onClear={sb.clear}
          onUndo={sb.undo}
          canUndo={sb.canUndo}
          boardMode={boardMode}
          onCycleBoardMode={cycleBoardMode}
        />

        <SavedPositionsPanel
          board={sb.board}
          turn={sb.turn}
          onLoadPosition={(b, t) => { sb.load(b, t); setLoadedGameplay(null); }}
          onLoadGameplay={(replay, name) => {
            const st = replayTo(replay);
            sb.load(st.board, st.turn);
            setLoadedGameplay({ replay, name, sig: JSON.stringify(serializePosition(st.board, st.turn, null, 0, 1)) });
          }}
          notify={(msg) => setToast({ id: Date.now(), msg })}
        />
      </main>
    </div>
  );
}
