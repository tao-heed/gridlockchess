// components/game/LocalGame.tsx — Local game screen (2-player or vs Fairy-Stockfish bot)
import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DndContext, DragOverlay } from '@dnd-kit/core';
import type { Square as SquareType, PieceColor, MoveHistoryEntry } from '@/types/game';
import type { GenerationMode } from '@/lib/chess/generator';
import { replayTo, serializeReplay, parseReplay, buildMoveLog, deriveMoveInfo, type GridlockReplay } from '@/lib/chess/format';
import { getStatusMessage } from '@/utils/statusMessage';

import { Board } from '@/components/board/Board';
import { Piece } from '@/components/pieces/Piece';
import { GameModals, ProtocolRunDryPanel, NamePromptModal, type GameEndType } from '@/components/game/modals';
import { Header } from '@/components/layout/Header';
import { GameInfoPanel, PlaySettings, type OpponentMode, CoachPanel, type MatchContext, type ClockRow } from '@/components/game/panels';
import { UplinkPostGameAction } from '@/components/game/UplinkPostGameAction';
import { useProtocolRunDry } from '@/hooks/useProtocolRunDry';
import { useBoardDnD } from '@/hooks/useBoardDnD';
import { useGameEndReveal } from '@/hooks/useGameEndReveal';
import { setKingMoods } from '@/hooks/useKingMood';
import { computeLiveKingMoods, computeScrubKingMoods } from '@/lib/chess/kingMood';
import { useGameSound } from '@/hooks/useGameSound';
import { STAGGER } from '@/lib/audio/engine';
import { chooseBotMove, levelIndex, type BotDifficulty } from '@/lib/chess/bot';
import { findKing, getAllLegalMoves } from '@/lib/chess/check';
import { isGridlocked } from '@/lib/chess/movement';
import { clearEngineLog } from '@/lib/chess/nativeEngine';
import { computeVectorCharges, computeMoveGhost } from '@/lib/chess/vectorCharges';
import { useCountdown } from '@/hooks/useCountdown';
import { useCoachState } from '@/hooks/useCoachState';
import { useGamePersistence, readResumeClock } from '@/hooks/useGamePersistence';
import { useReplayTracking } from '@/hooks/useReplayTracking';
import { useGameState } from '@/hooks/useGameState';
import { usePositionInspector } from '@/hooks/usePositionInspector';
import { useChessClock, type ChessClock } from '@/hooks/useChessClock';
import {
  getTimeControlOption,
  TIME_CONTROL_OPTIONS,
  formatClock,
  type TimeControlId,
  type TimeControl,
} from '@/constants/timeControls';
import { readString, writeString } from '@/lib/storage';
import { useUplinkGame } from '@/hooks/useUplinkGame';
import { useOnlinePresence } from '@/hooks/useOnlinePresence';
import { useQuickMatch } from '@/hooks/useQuickMatch';
import { usePlayerName } from '@/hooks/usePlayerName';
import { RUN_DRY_TIER_LABELS } from '@/hooks/useProtocolRunDry';
import type { PlayerInfo, BoardHighlightProps } from '@/components/board/Board';
import type { BoardAngle } from '@/components/board/boardOrientation';

// Persisted choice of which side the human plays against the bot.
const HUMAN_COLOR_KEY = 'gridlock-human-color';


// Standalone "last picked" clock preference, kept independently of any in-progress game so a
// returning player keeps their choice even after finishing (see docs/dev/ClockTimerPlan.md §6.1).
const TIME_CONTROL_KEY = 'gridlock:timecontrol:v1';

/** Validate a stored clock id against the known options, defaulting to "No clock". */
function readTimeControlPref(): TimeControlId {
  const raw = readString(TIME_CONTROL_KEY);
  return TIME_CONTROL_OPTIONS.some((o) => o.id === raw) ? (raw as TimeControlId) : 'none';
}


/** Map one derived move record → a display row. The single mapping used by every path
 *  (live append, resume, import) so rows can never differ by how the game was loaded. */
function moveInfoToEntry(m: ReturnType<typeof buildMoveLog>[number]): MoveHistoryEntry {
  return {
    moveNumber: m.moveNumber,
    color: m.color,
    pieceType: m.pieceType,
    from: m.from,
    to: m.to,
    captured: m.captured,
    vector: m.vector,
    vectorCost: m.vectorRemaining,
    isCheck: m.isCheck || undefined,
    isCheckmate: m.isCheckmate || undefined,
    isOverride: m.isOverride || undefined,
    promoted: m.isPromotion || undefined,
    causesGridlock: m.causesGridlock || undefined,
    isGridlockDeath: m.isGridlockDeath || undefined,
  };
}

/**
 * Rebuild move-history rows from a replay via the shared authoritative reconstruction
 * (`buildMoveLog`): piece names, captures, costs, Override, promotion, Gridlock and
 * check/mate all come from re-applying the moves through the real engine. Used for the
 * one-time loads (resume-on-refresh and JSON import); the live game appends incrementally
 * via the same per-move primitive, so all three renderings stay identical.
 */
function buildHistoryFromReplay(r: GridlockReplay): MoveHistoryEntry[] {
  return buildMoveLog(r).map(moveInfoToEntry);
}

export function LocalGame() {
  const {
    board,
    turn,
    status: engineStatus,   // raw engine state — use only for engine-state guards (clock, bot,
                            // persistence, game-over signalling). Display code uses `status`
                            // below, which is shadowed to statusForReveal after line ~1020.
    inCheck,
    drawReason,
    selectedSquare,
    legalMoves,
    legalMovesVectorMap,
    previewSquare,
    previewMoves,
    previewMovesVectorMap,
    previewOpponent,
    clearPreview,
    lastMove,
    lastVectorSpend,
    lastMoveMeta,
    kingSquare,
    gameId,
    capturedPieces,
    enPassantTarget,
    handleSquareClick,
    makeMove,
    resetGame,
    resign,
    flagTimeout,
    loadState,
  } = useGameState();

  // Read-only piece inspector — used in post-game review (status !== 'playing') and replay
  // scrubbing (isScrubbing). Same legal-move rules as live play (wouldBeInCheck applied).
  const inspector = usePositionInspector();

  // Which side the human plays vs the bot (persisted). The bot always takes the other
  // color, so when the human is Black the bot (White) opens automatically — the bot
  // driver effect fires on a fresh game because turn starts as White.
  const [humanColor, setHumanColor] = useState<PieceColor>(() => {
    if (typeof window === 'undefined') return 'white';
    return (localStorage.getItem(HUMAN_COLOR_KEY) as PieceColor) || 'white';
  });
  const botColor: PieceColor = humanColor === 'white' ? 'black' : 'white';
  useEffect(() => { localStorage.setItem(HUMAN_COLOR_KEY, humanColor); }, [humanColor]);
  // Both-Bots (Sandbox spectate): when true, BOTH sides are driven by the bot. Deliberately NOT
  // persisted — a refresh drops it, which is a natural safety valve that halts unattended auto-play.
  const [bothBots, setBothBots] = useState(false);

  // Engine diagnostics log holds only the CURRENT game — wipe it whenever a new game starts
  // (gameId bumps on every resetGame) so it never accumulates across levels. Purely in-memory.
  useEffect(() => { clearEngineLog(); }, [gameId]);

  // `perspective` = the human's "near" side, used to decide which card carries the center action
  // and as the default board rotation. `boardAngle` is the pure visual rotation (0/90/180/270).
  const [perspective, setPerspective] = useState<PieceColor>(humanColor);
  const [boardAngle, setBoardAngle] = useState<BoardAngle>(humanColor === 'black' ? 180 : 0);
  // Orient the board to a colour (used on resume / color-switch / uplink assignment): sets the
  // "self" side AND snaps the view to that side (White → 0°, Black → 180°).
  const orientToColor = (color: PieceColor) => {
    setPerspective(color);
    setBoardAngle(color === 'black' ? 180 : 0);
  };
  const [generationMode, setGenerationMode] = useState<GenerationMode>('balanced');
  // Transient: the mode the player just picked, surfaced by the Coach rail until they
  // make their first move. null on initial load and once play begins.
  const [lastModePick, setLastModePick] = useState<GenerationMode | null>(null);
  const [opponentMode, setOpponentMode] = useState<OpponentMode>('protocol-run-dry');
  const [botThinking, setBotThinking] = useState(false);

  // Clock / time control. Read once at mount: prefer a resumed game's control, else the
  // standalone "last picked" preference, else "No clock". The resumed remaining (if any)
  // seeds the clock so Option B pause-on-refresh restores the exact time each side had.
  const [resumeClock] = useState(readResumeClock);
  const [timeControlId, setTimeControlId] = useState<TimeControlId>(
    () => resumeClock.timeControlId ?? readTimeControlPref(),
  );
  // Persist the standalone preference whenever it changes, so it survives a finished game.
  useEffect(() => { writeString(TIME_CONTROL_KEY, timeControlId); }, [timeControlId]);

  // Protocol: Run Dry — modular progression system
  const runDry = useProtocolRunDry({
    humanColor,
  });
  const [endModalDismissed, setEndModalDismissed] = useState(false);
  // Bumped to briefly reveal the auto-hiding header bar: after a game ends (so the player finds
  // the Play-settings menu), and on arrival from Home's "Play" button (see the effect below).
  const [headerRevealSignal, setHeaderRevealSignal] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();
  // Home's "Play" button navigates here with { state: { revealHeader: true } } → reveal the
  // (auto-hiding) header BAR on arrival so the player sees it, WITHOUT opening the menu dropdown.
  // Then clear the flag so it doesn't re-trigger; the guard fires only for that one arrival.
  useEffect(() => {
    if ((location.state as { revealHeader?: boolean } | null)?.revealHeader) {
      setHeaderRevealSignal((n) => n + 1);
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location, navigate]);

  // Space-aware header: keep the glass bar permanently visible ONLY when it clears the top
  // player card (tall phones vertically-center the board via `justify-center`, leaving room
  // above it). On short phones where the bar would touch/overlap the top card's name, fall
  // back to the auto-hiding behavior. We measure the real gap (bar bottom → card top) and
  // re-measure on every reflow (resize, rotate, content height change) via a ResizeObserver.
  const gameAreaRef = useRef<HTMLDivElement>(null);
  const [headerPinned, setHeaderPinned] = useState(false);
  useLayoutEffect(() => {
    const el = gameAreaRef.current;
    if (!el) return;
    const CLEARANCE_MARGIN = 12; // don't pin if the bar would come within 12px of the card
    const measure = () => {
      const header = document.querySelector('header');
      // offsetHeight is the header's layout height (unaffected by its hide transform).
      const headerBottom = header ? header.offsetHeight : 56;
      const cardTop = el.getBoundingClientRect().top;
      setHeaderPinned(cardTop >= headerBottom + CLEARANCE_MARGIN);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, []);
  const [showResignConfirm, setShowResignConfirm] = useState(false);
  const [showRunDryRestartConfirm, setShowRunDryRestartConfirm] = useState(false);
  // Brief spin + color flash on the restart icon when clicked — visual confirmation the action fired.
  const [restartFlash, setRestartFlash] = useState(false);
  // True while the current game was launched from the Sandbox editor ("Play this position").
  // It swaps the center card action for an "Edit position" control that returns to /sandbox with
  // the built setup intact (the sandbox board persists in localStorage across the round-trip).
  const [fromSandbox, setFromSandbox] = useState(false);
  // Bumped once when a recorded game is loaded from the Sandbox (⏪ entry) so the info deck jumps
  // straight to the Replay scrubber. `saveGameplayPly` (non-null) opens the "name it" dialog for
  // saving the game up to the viewed ply back into the Sandbox library; its error surfaces inline.
  const [replayFocusSignal, setReplayFocusSignal] = useState(0);
  // Holds the opponent mode the player picked from the dropdown while a "leave live Uplink
  // match?" confirm is open. Leaving a connected match forfeits it, so we gate the switch.
  const [pendingUplinkLeave, setPendingUplinkLeave] = useState<OpponentMode | null>(null);
  // Draft match settings — the Play menu edits these WITHOUT touching the live game; they only
  // take effect on "New Game" (which confirms ONCE if anything changed). Mid-game setting
  // changes no longer each pop their own restart dialog.
  const [draftOpponent, setDraftOpponent] = useState<OpponentMode>('protocol-run-dry');
  const [draftColor, setDraftColor] = useState<PieceColor>(humanColor);
  const [draftTimeControl, setDraftTimeControl] = useState<TimeControlId>(timeControlId);
  // True while the single consolidated "abandon & start a new game?" confirm is open.
  const [showNewGameConfirm, setShowNewGameConfirm] = useState(false);
  // Pending replay import: parsed file awaiting user confirmation. Cleared on confirm/cancel.
  const [pendingImport, setPendingImport] = useState<{ replay: GridlockReplay; fileName: string; plies: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  // Coach move-recap state (auto-reset on new game via useCoachState).
  const {
    humanLastSpend, setHumanLastSpend,
    lastMovedType, setLastMovedType,
    lastMoveGridlocked, setLastMoveGridlocked,
    lastMoveOverride, setLastMoveOverride,
    lastMovePromoted, setLastMovePromoted,
  } = useCoachState(gameId);
  const { play: playSound, muted, toggleMuted } = useGameSound();
  const { name: playerName, setName: setPlayerName } = usePlayerName();
  const { name: player2Name, setName: setPlayer2Name } = usePlayerName('gridlock-player2-name', 'Player 2');

  // ── Override (Anomaly Boarding) — GridlockChess.md §6.1 ───────────────────────
  // Override is a real engine move now: selecting your King highlights any adjacent
  // friendly Anomaly it can board. The piloted flag lives on the real board piece, so
  // no derived board is needed — we only compute which selected destinations are boards.
  const pilotTargets: Set<SquareType> = (() => {
    const set = new Set<SquareType>();
    if (!selectedSquare) return set;
    const sel = board[selectedSquare];
    if (!sel || sel.type !== 'king') return set;
    for (const sq of legalMoves) {
      const t = board[sq];
      if (t && t.color === sel.color && t.type === 'anomaly' && t.archetype !== 'omni') {
        set.add(sq);
      }
    }
    return set;
  })();

  // Track moves into history
  const prevLastMove = useRef<{ from: SquareType; to: SquareType } | null>(null);

  // Clear the running move log + the dedupe guard. Shared by every "new match" path
  // (mode/side switch, play-again, next-tier) and the Uplink transitions inside the hook.
  const resetTracking = () => {
    setMoveHistory([]);
    prevLastMove.current = null;
  };

  // ── Uplink (Online PvP) — all peer-to-peer orchestration lives in this hook ────
  // It owns the relay connection, the per-match color roll, opponent identity, the live
  // position mirrors, and the ply/hash guards that keep both peers in lockstep. LocalGame
  // stays the sole owner of board state; the hook drives it through these controls and is
  // notified of each committed move via `onMoveCommitted` (see the move effect below).
  // Forward-ref bridge to the chess clock, which is constructed AFTER this hook (its
  // resolved control depends on the Uplink-chosen time control below). The hook reads/writes
  // the live clock through this ref so we avoid a construction-order cycle. Assigned right
  // after `clock` is created.
  const clockApiRef = useRef<ChessClock | null>(null);

  const uplinkGame = useUplinkGame({
    opponentMode,
    setOpponentMode,
    board,
    turn,
    enPassantTarget,
    generationMode,
    playerName,
    makeMove,
    resetGame,
    loadState,
    setPerspective: orientToColor,
    setGenerationMode,
    setEndModalDismissed,
    resetTracking,
    getClockSnapshot: () => {
      const c = clockApiRef.current;
      return c && c.enabled ? c.snapshot() : null;
    },
    onAdoptClock: (remaining) => clockApiRef.current?.adopt(remaining),
    status: engineStatus,
    onNewGame: () => playSound('modeBalanced'),
  });
  const { uplink, isUplink, myColor, opponentName, opponentLeft, reconnecting, reconnectDeadline, selfDisconnected, selfDisconnectDeadline, resultReason: uplinkResultReason } = uplinkGame;
  const uplinkResult = uplinkGame.result;
  const uplinkOpen = uplinkGame.lobbyOpen;
  const onlineCount = useOnlinePresence(playerName);
  const quickMatch  = useQuickMatch(uplink, playerName);

  // ── Clock / time control ──────────────────────────────────────────────────────
  // Resolve the ACTIVE control for the running game. In Uplink both peers run the
  // host-chosen control (adopted via state-init); 'none' resolves to null (untimed).
  // Every branch returns a module-constant reference (or null), so the clock hook's
  // effect deps stay stable between games.
  //
  // IMPORTANT: only switch to the Uplink control once the match has actually started
  // (uplinkGame.matchStarted = host rolled colors). If we switch as soon as isUplink
  // becomes true (lobby open), useChessClock sees a null→non-null timeControl change
  // while bankedRef is still {white:0,black:0}, immediately fires onFlag, and plays
  // the gameEnd sound before a single move has been made.
  const resolvedTimeControl: TimeControl | null = (isUplink && uplinkGame.matchStarted)
    ? getTimeControlOption(uplinkGame.timeControlId).control
    : getTimeControlOption(timeControlId).control;

  // Wall-clock chess clock. `resetKey={gameId}` re-arms both sides to base on every new game;
  // `initialRemaining` seeds a resumed game. A flag ends the game via `flagTimeout` (guarded
  // to `playing`, so a board result landing in the same tick still wins) and plays the
  // terminal cue (no dedicated flag cue exists in the sound engine — reuse `gameEnd`).
  const clock = useChessClock({
    timeControl: resolvedTimeControl,
    activeColor: turn,
    running: engineStatus === 'playing' && !(isUplink && reconnecting),
    initialRemaining: resumeClock.clock,
    resetKey: gameId,
    onFlag: (flagged) => {
      playSound('gameEnd');
      if (!isUplink) {
        flagTimeout();
      } else if (flagged === myColor) {
        // My own clock ran out on my turn — my machine is authoritative, so self-report.
        uplinkGame.reportOwnTimeout();
      } else {
        // My local estimate says the opponent flagged; claim after a latency grace period.
        uplinkGame.claimOpponentFlag();
      }
    },
  });
  // Stable-ref accessor for the persist effect, which must read the live snapshot without
  // re-subscribing every 250ms tick (the clock object identity changes each render).
  const clockPersistRef = useRef(clock);
  clockPersistRef.current = clock;
  // Publish the live clock API to the Uplink hook (see clockApiRef declaration above).
  clockApiRef.current = clock;

  // Remaining ms for a side, or null when the clock is off.
  const clockMsFor = (c: PieceColor): number | null =>
    clock.enabled ? (c === 'white' ? clock.whiteMs : clock.blackMs) : null;
  // One side's row data for the twin ClockPanel (low = <30s, flagged = out of time).
  const clockRowFor = (c: PieceColor): Omit<ClockRow, 'color' | 'name'> => {
    const ms = clockMsFor(c) ?? 0;
    return { ms, low: ms > 0 && ms < 30_000, flagged: ms <= 0 && clock.flagged };
  };

  // Accessibility: announce only threshold crossings (30s / 10s / flag) for the side to move,
  // never a per-second stream (a per-second aria-live is a screen-reader anti-pattern).
  const activeClockMs = clock.enabled && engineStatus === 'playing' ? clockMsFor(turn) : null;
  const clockBucket =
    activeClockMs == null ? null
      : activeClockMs <= 0 ? 'flag'
        : activeClockMs < 10_000 ? 'low10'
          : activeClockMs < 30_000 ? 'low30'
            : 'ok';
  const [clockAnnounce, setClockAnnounce] = useState('');
  useEffect(() => {
    const side = turn === 'white' ? 'White' : 'Black';
    if (clockBucket === 'low30') setClockAnnounce(`${side}: 30 seconds remaining`);
    else if (clockBucket === 'low10') setClockAnnounce(`${side}: 10 seconds remaining`);
    else if (clockBucket === 'flag') setClockAnnounce(`${side} flagged`);
  }, [clockBucket, turn]);

  useEffect(() => {
    if (!lastMove) return;
    // Skip if same move (prevent duplicates)
    if (prevLastMove.current?.from === lastMove.from && prevLastMove.current?.to === lastMove.to) return;
    prevLastMove.current = lastMove;

    // First move of the game retires the transient mode-explainer tip.
    setLastModePick(null);

    // Determine piece that moved (it's now at 'to')
    const piece = board[lastMove.to];
    if (!piece) return;

    // The side that just moved (piece.color). Used by the coach/audio recap below.
    const moverColor = piece.color;

    // Override + capture — read straight from the move's recorded outcome (lastMoveMeta),
    // not inferred from running tallies. This is authoritative: it can't be thrown off by
    // the bot's reply, an en-passant victim, or a deduped/replayed lastMove (which previously
    // could leave the capture tally stuck +1 and mislabel quiet moves as captures).
    const moveMeta = lastMoveMeta && lastMoveMeta.color === moverColor ? lastMoveMeta : null;
    const didOverride = !!moveMeta?.isOverride;
    const didCapture = !!moveMeta?.captured;

    // Coach rail recap: latch what the relevant side just did so the rail reflects the
    // *move* rather than repeating the generic mode primer every turn. In bot/uplink the
    // human's perspective is fixed (mirrorSide); offline hot-seat has no fixed side, so we
    // mirror whoever just moved. The recap wording is neutral ("That move cost a…"), so it
    // reads correctly for the next player in hot-seat. An Anomaly move surfaces its charge
    // spend; a Pawn/King move keeps that piece's rules on screen (see CoachPanel). A
    // non-vector move clears the stale spend so the "Charge spent" tip never lingers.
    const offline = opponentMode === 'offline';
    const moverSpent = !!lastVectorSpend && lastVectorSpend.color === moverColor;
    const mirrorSide = isUplink ? myColor : humanColor;
    if (offline || moverColor === mirrorSide) {
      setHumanLastSpend(
        moverSpent ? { vector: lastVectorSpend!.vector, remaining: lastVectorSpend!.remaining } : null,
      );
      setLastMovedType(piece.type);
      // Did this move just fully Gridlock the moving Anomaly (0/0/0)? If so, that's the
      // headline recap — outranks the single-vector "exhausted" tip in the Coach.
      setLastMoveGridlocked(
        piece.type === 'anomaly' && piece.isGridlocked ? piece.archetype : null,
      );
      // Did this move board an Anomaly via Override (King → Anomaly)? Boarding spends no
      // charge, so without this the rail would fall back to the mode primer. Headline it.
      setLastMoveOverride(
        moveMeta?.isOverride && piece.type === 'anomaly' ? piece.archetype : null,
      );
      // Did this move just promote a pawn to an Omni (Anomaly Synthesis)? A freshly-minted
      // Omni (full 8-charge shared pool) can ONLY be the result of a just-completed promotion.
      const justPromotedNow =
        piece.type === 'anomaly' && piece.archetype === 'omni' && piece.vectors.shared === 8;
      setLastMovePromoted(justPromotedNow);
    }

    // ── Audio feedback — encode game *state*, not piece identity (lib/audio/engine.ts) ──
    const isAnomaly = piece.type === 'anomaly';
    const gridlocked = isAnomaly && piece.isGridlocked;
    // Pawn → Omni synthesis: a freshly-minted Omni (full 8-charge shared pool) sitting on
    // the square this move landed on can ONLY be the result of a just-completed promotion —
    // every later Omni move spends from the pool, so shared === 8 is a one-shot signal.
    const justPromoted =
      piece.type === 'anomaly' && piece.archetype === 'omni' && piece.vectors.shared === 8;
    const vectorExhausted =
      !!lastVectorSpend && lastVectorSpend.color === moverColor && lastVectorSpend.remaining === 0;
    // Primary move sound — most significant event wins. Promotion (Anomaly Synthesis) is
    // the headline beat, so its metallic clang takes precedence over the mundane move/capture.
    if (justPromoted) playSound('promotion');
    else if (didOverride) playSound('override');
    else if (didCapture) playSound('capture');
    else if (isAnomaly) playSound('anomalyMove');
    else playSound('move');
    // Secondary state cue — a single vector emptied (skip when a full Gridlock already covered it).
    // Micro-staggered just after the move so the two transients don't mask each other.
    if (vectorExhausted && !gridlocked) playSound('vectorExhausted', STAGGER.vectorExhausted);
    // Gridlock lock-in — the move that drains the last charge plays its move sound first, THEN the
    // heavy lock-in lands (scheduled on the audio clock, matching the Rules demos).
    if (gridlocked) playSound('gridlock', STAGGER.gridlock);
    // Terminal / check overlay.
    const terminal =
      engineStatus === 'checkmate' || engineStatus === 'gridlock-death' || engineStatus === 'stalemate' || engineStatus === 'draw';
    if (terminal) {
      // A piloted-King Gridlock Death fires its lock-in above. Stagger the death scream after it
      // so the order is move → gridlock → gameEnd, never overlapping.
      if (engineStatus === 'gridlock-death' && gridlocked) {
        playSound('gameEnd', STAGGER.gameEnd);
      } else {
        playSound('gameEnd');
      }
    } else if (inCheck) playSound('check', STAGGER.check);

    // Notify the Uplink hook of this committed move — it owns the ply counter and the
    // send / hash-verify / resync handshake. No-op in offline & bot games.
    uplinkGame.onMoveCommitted(piece.color, lastMove.from, lastMove.to);

    // Record the move and append its row from the SAME per-move primitive the import/resume
    // reconstruction uses. Advancing the threaded replay state one ply (O(1)) — rather than
    // rebuilding the whole log each move (O(n²) across a game) — keeps the live log, a
    // resumed refresh, and an imported JSON identical while staying cheap. The exported
    // {from,to} moves therefore round-trip through "Import Replay (JSON)" with full fidelity.
    const st = replayStateRef.current;
    if (st) {
      try {
        const { info, next } = deriveMoveInfo(st, lastMove.from, lastMove.to, replayMoves.length);
        replayStateRef.current = next;
        setMoveHistory(prev => [...prev, moveInfoToEntry(info)]);
      } catch {
        // A desync between the live board and the threaded replay state should never happen;
        // if it somehow does, drop the row rather than crash the game. The next load rebuilds.
      }
    }
    setReplayMoves(prev => [...prev, { from: lastMove.from, to: lastMove.to }]);
    setViewPly(null); // any live move snaps the board back to the present
  }, [lastMove]);

  const botActive = opponentMode !== 'offline' && !isUplink;
  const activeBotDifficulty: BotDifficulty = opponentMode === 'protocol-run-dry' ? runDry.currentDifficulty : opponentMode as BotDifficulty;

  // Run Dry display difficulty: freeze at the just-played level during post-game review so the
  // player card, tier panel, and coach context show "Basic 4" even after processGameEnd has
  // already advanced currentDifficulty to Basic 5. The ref tracks the live difficulty during
  // play; the guard stops updating it once the game ends so the review shows the correct level.
  const playedDifficultyRef = useRef(activeBotDifficulty);
  const isTerminal = engineStatus !== 'playing' && engineStatus !== 'waiting';
  if (!isTerminal || opponentMode !== 'protocol-run-dry') {
    playedDifficultyRef.current = activeBotDifficulty;
  }
  const displayDifficulty: BotDifficulty = isTerminal && opponentMode === 'protocol-run-dry'
    ? playedDifficultyRef.current
    : activeBotDifficulty;

  // Draft-derived values for the Play menu (reflect the pending, not-yet-committed selection).
  const draftBotActive = draftOpponent !== 'offline' && draftOpponent !== 'uplink';
  const draftBotDifficulty: BotDifficulty = draftOpponent === 'protocol-run-dry' ? runDry.currentDifficulty : draftOpponent as BotDifficulty;
  // Refresh the Play-menu drafts from the live game each time the menu OPENS, so the dropdowns
  // always start from reality (drafts are only ever read while the menu is open).
  const syncDraftsToCommitted = () => {
    setDraftOpponent(opponentMode);
    setDraftColor(humanColor);
    // Run Dry never uses a clock — force the draft to 'none' so the selector shows "No clock"
    // and stays disabled while Run Dry is selected.
    setDraftTimeControl(opponentMode === 'protocol-run-dry' ? 'none' : timeControlId);
  };
  // Human-readable summary for the consolidated New Game confirm.
  const newGameConfirmMessage = (() => {
    const clock = draftTimeControl === 'none' ? 'No clock' : getTimeControlOption(draftTimeControl).label;
    const opp = draftOpponent === 'offline' ? 'Offline PvP'
      : draftOpponent === 'uplink' ? 'Uplink'
      : draftOpponent === 'protocol-run-dry' ? 'Protocol: Run Dry'
      : `Bot · ${RUN_DRY_TIER_LABELS[draftBotDifficulty].name}`;
    return `Abandon the current game and start a new one — ${opp}, Clock ${clock}, playing ${draftColor === 'white' ? 'White' : 'Black'}?`;
  })();
  // Match context for the Coach's mode-aware idle primer (Uplink / Pass & Play / Run Dry).
  const coachMatchContext: MatchContext = isUplink
    ? { mode: 'uplink', opponentName }
    : opponentMode === 'offline'
      ? { mode: 'offline' }
      : opponentMode === 'protocol-run-dry'
        ? {
            mode: 'protocol-run-dry',
            tierCallsign: RUN_DRY_TIER_LABELS[displayDifficulty].callsign,
            tierName: RUN_DRY_TIER_LABELS[displayDifficulty].name,
            tierDisplay: levelIndex(displayDifficulty) + 1,
            totalTiers: runDry.totalTiers,
          }
        : { mode: 'bot' };

  // ── Game outcome — computed early so `status` and `defeatedSquare` are available to
  //    useReplayTracking and humanCanInteract before useBoardDnD is called. ───────────
  const peerResult = isUplink ? uplinkGame.peerConfirmedResult : null;
  const statusForReveal = (peerResult && engineStatus === 'playing')
    ? peerResult.status as typeof engineStatus
    : engineStatus;
  // Shadow `engineStatus` as `status` so ALL display code below naturally reads the correct
  // value (statusForReveal). Engine-state guards (clock, bot, persistence) use `engineStatus`.
  const status = statusForReveal;
  // The defeated royal piece topples (death animation) — needed by useReplayTracking below.
  const defeatedSquare =
    statusForReveal === 'checkmate'
      ? engineStatus === 'checkmate'
          ? kingSquare                                                               // local engine — exact
          : findKing(board, peerResult?.winner === 'white' ? 'black' : 'white')     // peerResult fallback
      : statusForReveal === 'gridlock-death'
        ? engineStatus === 'gridlock-death'
            ? findKing(board, turn === 'white' ? 'black' : 'white')                 // local engine — exact
            : findKing(board, peerResult?.winner === 'white' ? 'black' : 'white')   // peerResult fallback
        : null;

  // ── Replay / scrubbing — placed here so `viewPly` is available for useBoardDnD. ───
  const {
    moveHistory, replayMoves, viewPly, replay, isScrubbing, scrubState,
    displayBoard, displayTurn, displayInCheck, displayKingSquare, displayDefeatedSquare,
    displayLastMove, displayLastMoveVectorType,
    saveGameplayPly, saveGameplayError,
    startPosRef, replayStateRef, pendingImportLoadRef, loadPendingReplay,
    setMoveHistory, setReplayMoves, setViewPly, setSaveGameplayPly, setSaveGameplayError,
    seekPly, handleSaveGameplay,
  } = useReplayTracking({
    board, turn, inCheck, kingSquare, enPassantTarget,
    generationMode, playerName, player2Name, status: statusForReveal, drawReason,
    lastMove, lastVectorSpend, defeatedSquare, gameId,
  });

  useGamePersistence({
    isUplink, engineStatus, opponentMode, humanColor, generationMode,
    capturedPieces, timeControlId, replayMoves, gameId,
    startPosRef, pendingImportLoadRef,
    clockSnapshot: () => clockPersistRef.current.enabled ? clockPersistRef.current.snapshot() : null,
    onRestore: (snapshot, r, final) => {
      loadPendingReplay(r);
      setMoveHistory(buildHistoryFromReplay(r));
      setOpponentMode(snapshot.opponentMode);
      setGenerationMode('balanced');
      if (snapshot.humanColor === 'white' || snapshot.humanColor === 'black') {
        setHumanColor(snapshot.humanColor);
        setPerspective(snapshot.humanColor);
        setBoardAngle(snapshot.humanColor === 'black' ? 180 : 0);
      }
      loadState({
        board: final.board,
        turn: final.turn,
        enPassantTarget: final.enPassant,
        capturedPieces: snapshot.capturedPieces,
      });
    },
    onSandboxLoad: (r, final, handoff) => {
      loadPendingReplay(r);
      setMoveHistory(buildHistoryFromReplay(r));
      setOpponentMode(handoff.sandboxOpponent ?? 'offline');
      setBothBots(!!handoff.sandboxBothBots && handoff.sandboxOpponent !== 'offline');
      setGenerationMode('balanced');
      const col = handoff.sandboxColor;
      if (col === 'white' || col === 'black') {
        setHumanColor(col);
        setPerspective(col);
        setBoardAngle(col === 'black' ? 180 : 0);
      }
      const a = handoff.sandboxBoardAngle;
      if (a === 0 || a === 90 || a === 180 || a === 270) setBoardAngle(a);
      loadState({
        board: final.board,
        turn: final.turn,
        enPassantTarget: final.enPassant,
        capturedPieces: { white: [], black: [] },
      });
      setFromSandbox(true);
      if (handoff.sandboxReplayMode) setReplayFocusSignal((n) => n + 1);
    },
  });

  const humanCanInteract = isUplink
    ? uplink.status === 'connected' && status === 'playing' && uplinkResult === null && turn === myColor
    : bothBots ? false : (!botActive || turn === humanColor);

  // Uplink: keep the board oriented to the player's assigned color whenever the
  // connection is live or the color changes (e.g. rematch re-roll). Guards against
  // any race between state-init delivery and the initial render that would otherwise
  // leave the board at the default 0° (White-at-bottom) for a Black-assigned guest.
  useEffect(() => {
    if (!isUplink || uplink.status !== 'connected') return;
    orientToColor(myColor);
  }, [isUplink, uplink.status, myColor]);

  // Live reconnection countdown — ticks every second while either side is disconnected.
  const reconnectSeconds = useCountdown(reconnecting, reconnectDeadline);
  // Self-disconnect countdown — shown on YOUR card when YOUR connection drops.
  const selfReconnectSeconds = useCountdown(selfDisconnected, selfDisconnectDeadline);

  // ── Auto-select King when Override is the only escape from check ────────────
  // When the human's King is in check and every legal move for the entire side is
  // an Override (boarding a friendly Anomaly), auto-select the King so the golden
  // Override targets are immediately visible. Without this, the player sees a red
  // check glow, has no obvious escape, and may think it's checkmate.
  const overrideAutoSelected = useRef(false);
  useEffect(() => { overrideAutoSelected.current = false; }, [gameId, turn]);
  useEffect(() => {
    if (overrideAutoSelected.current) return;
    if (!inCheck || engineStatus !== 'playing' || !kingSquare) return;
    if (selectedSquare === kingSquare) return;
    // Only auto-select on the human's own turn.
    if (botActive && turn === botColor) return;
    if (isUplink && turn !== myColor) return;

    const allMoves = getAllLegalMoves(board, turn, enPassantTarget);
    // Another piece can help (block / capture) — not Override-only.
    if (allMoves.size !== 1 || !allMoves.has(kingSquare)) return;
    const kingMoves = allMoves.get(kingSquare)!;
    // Every legal destination must be a friendly boardable Anomaly (Override target).
    const onlyOverrides = kingMoves.every(sq => {
      const t = board[sq];
      return t && t.color === turn && t.type === 'anomaly'
        && t.archetype !== 'omni' && !isGridlocked(t);
    });
    if (!onlyOverrides) return;

    overrideAutoSelected.current = true;
    handleSquareClick(kingSquare);
  }, [inCheck, turn, engineStatus, gameId, kingSquare, selectedSquare,
      board, enPassantTarget, botActive, botColor, isUplink, myColor, handleSquareClick]);

  // Bot turn driver: when it's the bot's move, ask the engine (or fallback) then play it.
  //
  // `board`, `enPassantTarget` and `makeMove` are read through refs so they never sit in the
  // dependency array — a fresh identity each render would otherwise cancel + restart the in-flight
  // search. The effect RE-FIRES on the REAL triggers: whose turn it is (`turn`), which side the bot
  // plays (`botColor` — derived from `humanColor`; leaving it OUT was the bug that hung a
  // bot-opens Sandbox game, because the Sandbox handoff sets humanColor and the effect never
  // re-evaluated), whether a bot is active, the game status, the tier, and a new game/position load
  // (`gameId`, bumped by loadState/resetGame so a freshly loaded position always re-triggers even
  // if `turn` coincidentally matches the previous game). No `botMoveInFlight` guard: React runs the
  // cleanup (cancel) before re-running the effect, so only the latest run is ever un-cancelled —
  // the old ref-guard could stick `true` after a cancelled run and permanently block the restart,
  // leaving the bot "thinking forever".
  const botBoardRef = useRef(board);
  botBoardRef.current = board;
  const botEpRef = useRef(enPassantTarget);
  botEpRef.current = enPassantTarget;
  const makeMoveRef = useRef(makeMove);
  makeMoveRef.current = makeMove;
  useEffect(() => {
    // Both-Bots (Sandbox): drive WHICHEVER side is to move, so the game auto-alternates end to end
    // (each move flips `turn` → this re-fires → the next side moves) and stops the instant `status`
    // leaves 'playing'. Human-vs-bot keeps the original gate: only the bot's own side moves.
    if (!botActive || engineStatus !== 'playing') return;
    if (!bothBots && turn !== botColor) return;
    const side = turn; // both-bots: either colour; human-vs-bot: equals botColor at this point

    let cancelled = false;
    setBotThinking(true);

    // Parallel timing: the search runs WHILE a natural "thinking" delay elapses, so the bot never
    // moves instantly. In Both-Bots this same pacing keeps auto-play watchable and thermally gentle.
    const thinkingDelay = 1200 + Math.random() * 800; // 1.2–2.0s natural variance
    const minDelay = new Promise<void>((r) => setTimeout(r, thinkingDelay));

    Promise.all([
      chooseBotMove(botBoardRef.current, side, botEpRef.current, activeBotDifficulty),
      minDelay,
    ])
      .then(([move]) => { if (!cancelled && move) makeMoveRef.current(move.from, move.to); })
      .catch((err) => console.error('[Bot] move failed:', err))
      .finally(() => { if (!cancelled) setBotThinking(false); });

    return () => { cancelled = true; };
  }, [turn, botColor, botActive, engineStatus, activeBotDifficulty, gameId, bothBots]);

  // ── Protocol: Run Dry — game end progression (delegated to hook) ──────────────
  useEffect(() => {
    if (opponentMode !== 'protocol-run-dry') return;
    runDry.processGameEnd(engineStatus, turn, gameId);
  }, [engineStatus, opponentMode, gameId]);

  // Deal a fresh Balanced board with the CURRENT settings (used by the center refresh button
  // + the end-game "Play Again"). No confirm — same match, new opening.
  const plainNewGame = () => {
    if (isUplink) return; // board is host-authoritative during an uplink match
    playSound('modeBalanced');
    setLastModePick('balanced');
    setEndModalDismissed(false);
    resetTracking();
    setViewPly(null); // clear scrub position synchronously so isReviewMode = false on the first new-game render
    resetGame();
  };

  // Commit the drafted Play-menu settings (opponent / color / clock) and start a fresh game.
  const applyDraftAndNewGame = () => {
    setOpponentMode(draftOpponent);
    setHumanColor(draftColor);
    setBothBots(false); // changing the opponent via the Play menu exits Both-Bots spectate mode
    setFromSandbox(false); // a committed New Game is no longer the launched Sandbox position
    orientToColor(draftColor);
    setTimeControlId(draftTimeControl);
    playSound('modeBalanced');
    setLastModePick(null);
    setEndModalDismissed(false);
    resetTracking();
    runDry.clearLastResult();
    setViewPly(null); // clear scrub position synchronously so isReviewMode = false on the first new-game render
    resetGame();
    setShowNewGameConfirm(false);
  };

  // The Play menu's "New Game": if opponent / clock / Play-As changed vs the running game, ask
  // ONCE (consolidated) before abandoning a game IN PROGRESS; on a fresh/untouched board there's
  // nothing to lose, so a changed draft just applies instantly, and no change just re-deals.
  const commitNewGame = () => {
    if (isUplink) return;
    const changed =
      draftOpponent !== opponentMode || draftColor !== humanColor || draftTimeControl !== timeControlId;
    if (changed && engineStatus === 'playing' && moveHistory.length > 0) setShowNewGameConfirm(true);
    else if (changed) applyDraftAndNewGame();
    else plainNewGame();
  };

  // Handle new game from modal
  const handlePlayAgain = () => {
    playSound('modeBalanced');
    setEndModalDismissed(false);
    setLastModePick(null);
    resetTracking();
    runDry.clearLastResult();
    setViewPly(null); // clear scrub position synchronously so isReviewMode = false on the first new-game render
    resetGame();
  };

  // Handle Protocol: Run Dry "Next Tier" action
  const handleNextTier = () => {
    playSound('modeBalanced');
    setEndModalDismissed(false);
    resetTracking();
    runDry.clearLastResult();
    setViewPly(null); // clear scrub position synchronously so isReviewMode = false on the first new-game render
    resetGame();
  };

  // ── Uplink controls ──────────────────────────────────────────────────────────
  // The dropdown handler is shared across all modes; the Uplink-specific transitions
  // (open lobby / quiet-leave / forfeit / rematch) live in useUplinkGame.
  // The Play-menu opponent dropdown edits a DRAFT (committed on New Game). Uplink is the
  // exception — it's a networked action, so entering/leaving a live match stays immediate
  // (leaving a connected match still confirms, since it forfeits to the opponent).
  const handleDraftOpponent = (val: OpponentMode) => {
    // Picking a different opponent means you're reconfiguring away from the launched Sandbox
    // position — drop the "Edit position" (🧪) affordance so the center action reverts to the
    // normal Refresh / Flag control.
    if (val !== opponentMode) setFromSandbox(false);
    if (val === 'uplink') { uplinkGame.openLobby(); return; }
    if (isUplink) {
      if (uplink.status === 'connected' && !opponentLeft) {
        setPendingUplinkLeave(val);
        return; // dropdown stays on 'uplink' until they confirm
      }
      uplinkGame.leaveQuietly();
      if (val === 'protocol-run-dry') {
        // Run Dry must ALWAYS start from a fresh board — never inherit the lobby's position.
        setOpponentMode('protocol-run-dry');
        setLastModePick(null);
        setEndModalDismissed(false);
        resetTracking();
        runDry.clearLastResult();
        resetGame();
      } else {
        setOpponentMode(val); // just left the lobby — commit immediately
      }
      return;
    }
    setDraftOpponent(val);
    // Run Dry never uses a clock — snap the draft clock to 'none' so the selector immediately
    // shows "No clock" and the disabled state is visually coherent on the same render.
    if (val === 'protocol-run-dry') setDraftTimeControl('none');
  };
  
  // Board drag-and-drop: sensors, drag handlers, the dragged-piece overlay state, and the
  // one-frame "place instantly" animation toggle all live in this hook.
  const { sensors, draggedPiece, animateMoves, handleDragStart, handleDragEnd, onSquareClick } = useBoardDnD({
    board,
    turn,
    legalMoves,
    humanCanInteract,
    viewPly,
    handleSquareClick,
    makeMove,
    previewOpponent,
    clearPreview,
  });

  // Derive game-over state using extracted utilities
  const statusMessage = getStatusMessage({ status, turn, drawReason, inCheck });

  // S-tier defeat beat: on a decisive mate, hold the board (King topples + dims) for a
  // moment so the player *sees* the kill before the result modal slams up. Draws and
  // resigns reveal instantly — there's nothing to watch.
  const { isGameOver, endRevealReady } = useGameEndReveal(statusForReveal);

  // Auto-switch the PanelDeck to Replay when the game ends. The deck resets back to Charge
  // on new game via replayKey (gameId) — see PanelDeck's replayKey effect.
  useEffect(() => {
    if (isGameOver) setReplayFocusSignal((n) => n + 1);
  }, [isGameOver]);

  // peerResult fallback sound: in the rare charge-drift scenario the peer's game-over signal
  // triggers isGameOver before the local engine detects the terminal state. The normal
  // game-end sound fires inside the move-commit effect (which never runs in this path), so
  // we play it here instead. Guard: engineStatus === 'playing' detects the fallback path —
  // in the normal case engineStatus is already terminal when isGameOver flips.
  useEffect(() => {
    if (isGameOver && engineStatus === 'playing') playSound('gameEnd');
  }, [isGameOver, engineStatus, playSound]);

  // Uplink resolves resignation / abandonment out-of-band (it is not a board move),
  // so those outcomes drive the end modal via uplinkResult. Checkmate / stalemate /
  // draw still flow through `status` identically on both peers.
  const uplinkResolved = isUplink && uplinkResult !== null;
  const endModalType: GameEndType = uplinkResolved
    ? (uplinkResultReason === 'timeout' ? 'timeout' : 'resigned')
    : statusForReveal === 'gridlock-death'
      ? 'checkmate'
      : (statusForReveal as GameEndType);
  const endModalWinner = uplinkResolved
    ? uplinkResult === 'win'
      ? (myColor === 'white' ? 'White' : 'Black')
      : (myColor === 'white' ? 'Black' : 'White')
    : peerResult && engineStatus === 'playing'
      // peerResult fallback: use peer's authoritative winner directly — local `turn` is unreliable
      // when the local engine hasn't reached the terminal state yet (charge-state drift).
      ? peerResult.winner === 'white' ? 'White' : peerResult.winner === 'black' ? 'Black' : null
      : statusForReveal === 'checkmate' || statusForReveal === 'resigned' || statusForReveal === 'timeout'
        ? (turn === 'white' ? 'Black' : 'White')
        : statusForReveal === 'gridlock-death'
          ? (turn === 'white' ? 'White' : 'Black')
          : null;
  const endModalOpen =
    (isGameOver && endRevealReady && !endModalDismissed) || (uplinkResolved && !endModalDismissed);

  // Describe whoever owns `cardColor` for the player cards. Color-aware (not position-
  // assuming), so it stays correct when the human switches sides OR flips the board.
  const describePlayer = (cardColor: PieceColor): PlayerInfo => {
    // Bot modes: the human owns `humanColor`, the bot owns the other color.
    if (botActive) {
      // Both-Bots (Sandbox spectate): every seat is a bot — show the tier identity on BOTH sides and
      // keep them non-editable. Human-vs-bot keeps the human seat (its own colour) named + editable.
      if (!bothBots && cardColor === humanColor) {
        return { name: playerName, color: cardColor, isEditable: true, onNameChange: setPlayerName };
      }
      // Bot identity above the board: the PRIMARY line shows the tier name + level
      // (e.g. "Advanced 3") and the SUBTITLE shows the tier callsign (e.g. "Level 13").
      // activeBotDifficulty already resolves the Protocol: Run Dry tier vs. a directly-picked level.
      const tier = RUN_DRY_TIER_LABELS[displayDifficulty];
      return {
        name: tier.name,
        color: cardColor,
        isEditable: false,
        subtitle: tier.callsign,
        thinking: botThinking && turn === cardColor,
      };
    }
    // Uplink: you own `myColor`; the opponent is read-only.
    if (isUplink) {
      const isMe = cardColor === myColor;
      return {
        name: isMe ? playerName : (opponentName ?? 'Opponent'),
        color: cardColor,
        isEditable: isMe,
        onNameChange: isMe ? setPlayerName : undefined,
      };
    }
    // Offline PvP — both seats are local and editable.
    return {
      name: cardColor === 'white' ? playerName : player2Name,
      color: cardColor,
      isEditable: true,
      onNameChange: cardColor === 'white' ? setPlayerName : setPlayer2Name,
    };
  };
  // Fold ALL game status onto the player cards (there is no separate status bar). During play
  // the ACTIVE seat shows the clock time (when a clock is running) or "{Color} to move · Your turn
  // / Bot is thinking"; at game over each side shows its own outcome. Idle seats show their
  // static clock time (dimmed) when a clock is running, otherwise stay clean.
  const withTurnStatus = (info: PlayerInfo): PlayerInfo => {
    if (isGameOver) {
      if (statusForReveal === 'stalemate' || statusForReveal === 'draw') {
        return { ...info, statusText: 'Draw', statusTone: 'neutral' };
      }
      const winnerColor = endModalWinner === 'White' ? 'white' : endModalWinner === 'Black' ? 'black' : null;
      if (!winnerColor) return info;
      if (info.color === winnerColor) return { ...info, statusText: 'Winner', statusTone: 'win' };
      const defeat =
        statusForReveal === 'checkmate' ? 'Checkmated'
          : statusForReveal === 'gridlock-death' ? 'Gridlock Death'
            : statusForReveal === 'resigned' ? 'Resigned'
              : statusForReveal === 'timeout' ? 'Flagged'
                : 'Defeated';
      return { ...info, statusText: defeat, statusTone: 'danger' };
    }
    // Reconnection: opponent dropped → countdown on THEIR card; self dropped → countdown on OUR card.
    if (isUplink && selfDisconnected && selfReconnectSeconds != null && info.color === myColor) {
      return { ...info, statusText: `Connection lost ${selfReconnectSeconds}s…`, statusRole: undefined, statusTone: 'danger' };
    }
    if (isUplink && reconnecting && reconnectSeconds != null && info.color !== myColor) {
      return { ...info, statusText: `Reconnecting ${reconnectSeconds}s…`, statusRole: undefined, statusTone: 'danger' };
    }
    // Clock mode: replace the status with a dedicated clock display (icon + time).
    if (clock.enabled) {
      const row = clockRowFor(info.color);
      const timeStr = row.flagged ? '0:00' : formatClock(row.ms);
      const tone: 'danger' | 'neutral' = row.flagged || (row.low && turn === info.color && status === 'playing') ? 'danger' : 'neutral';
      return { ...info, statusText: undefined, statusRole: undefined, thinking: false, clockDisplay: { time: timeStr, tone } };
    }
    if (turn !== info.color) return info;
    const role = botActive
      ? (!bothBots && info.color === humanColor) ? 'Your turn' : (botThinking ? 'Bot is thinking' : "Bot's turn")
      : isUplink
        ? info.color === myColor ? 'Your turn' : "Opponent's turn"
        : 'Your turn';
    return { ...info, statusText: statusMessage, statusRole: role, statusTone: inCheck ? 'danger' : 'neutral' };
  };
  // Context-aware quick action, dead-center on your (bottom) player card. From the Sandbox it's
  // "Edit position" (back to the editor, setup kept); otherwise Refresh (deal a fresh opening) vs
  // a Bot / Protocol: Run Dry, or Flag (resign) in Offline / Uplink PvP.
  // Once the game is over, the bare refresh icon becomes a labeled "Play Again" accent pill so
  // a player reviewing the finished board clearly sees how to start the next game.
  const centerAction = fromSandbox ? (
    <button
      type="button"
      onClick={() => navigate('/sandbox', { state: { sandboxOpponent: opponentMode, sandboxHumanColor: humanColor, sandboxBothBots: botActive && bothBots } })}
      aria-label="Edit position — return to the Sandbox with this setup"
      title="Back to the Sandbox — your pieces are kept"
      className="justify-self-center grid place-items-center w-8 h-8 rounded-full bg-gc-panel-2/80 ring-1 ring-white/10 text-gc-text-dim hover:text-gc-accent hover:bg-gc-panel-2 hover:ring-gc-accent/40 active:scale-90 active:text-gc-accent active:bg-gc-accent/20 active:ring-gc-accent/60 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent"
    >
      {/* 🧪 — matches the Sandbox's brand glyph everywhere else (Opponent dropdown, saved list), so
          this reads as "back to the lab you built this in" rather than a generic edit. */}
      <span aria-hidden="true" className="text-[16px] leading-none">🧪</span>
    </button>
  ) : botActive ? (
    <button
      type="button"
      onClick={() => {
        setRestartFlash(true);
        if (isGameOver && opponentMode === 'protocol-run-dry') {
          runDry.lastResult === 'win' ? handleNextTier() : handlePlayAgain();
        } else {
          plainNewGame();
        }
      }}
      aria-label={
        isGameOver
          ? opponentMode === 'protocol-run-dry'
            ? runDry.lastResult === 'win' ? 'Next Level — advance to the next tier' : 'Retry Tier — try this level again'
            : 'Play again — deal a fresh opening'
          : 'New game — deal a fresh opening'
      }
      title="New board — deal a fresh opening"
      className={
        isGameOver
          ? 'justify-self-center inline-flex items-center gap-1.5 h-8 pl-3 pr-3.5 rounded-full bg-gc-accent/15 ring-1 ring-gc-accent/50 text-gc-accent font-semibold text-[13px] whitespace-nowrap hover:bg-gc-accent/25 active:scale-90 active:bg-gc-accent/35 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent'
          : `justify-self-center grid place-items-center w-8 h-8 rounded-full ring-1 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent ${
              restartFlash
                ? 'text-gc-accent bg-gc-accent/20 ring-gc-accent/60'
                : 'text-gc-text-dim bg-gc-panel-2/80 ring-white/10 hover:text-gc-accent hover:bg-gc-panel-2 hover:ring-gc-accent/40 active:scale-90'
            }`
      }
    >
      <svg
        viewBox="0 0 24 24"
        className={`h-4 w-4 shrink-0 ${restartFlash ? 'animate-[spin_0.4s_ease-in-out]' : ''}`}
        onAnimationEnd={() => setRestartFlash(false)}
        fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      >
        <path d="M4 4v5h5M20 20v-5h-5M20 9a8 8 0 0 0-14.9-3M4 15a8 8 0 0 0 14.9 3" />
      </svg>
      {isGameOver && (
        <span>
          {opponentMode === 'protocol-run-dry'
            ? runDry.lastResult === 'win' ? 'Next Level' : 'Retry Tier'
            : 'Play Again'}
        </span>
      )}
    </button>
  ) : !isGameOver && !uplinkResolved ? (
    <button
      type="button"
      onClick={() => setShowResignConfirm(true)}
      aria-label="Resign"
      title="Resign the game — raise the white flag"
      className="justify-self-center grid place-items-center w-8 h-8 rounded-full bg-gc-panel-2/80 ring-1 ring-white/10 text-white hover:bg-red-900/40 hover:ring-red-500/45 active:scale-90 active:bg-red-900/60 active:ring-red-500/70 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/70"
    >
      {/* White flag of surrender: filled waving cloth on a slim pole — the universally read "I resign". */}
      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
        <path d="M6 21V4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
        <path d="M6 4.2c2.2-1.1 4.4-1.1 6.6 0s4.4 1.1 5.4.5v7.8c-1 .6-3.2.6-5.4-.5s-4.4-1.1-6.6 0z" fill="currentColor" />
      </svg>
    </button>
  ) : isUplink && (isGameOver || uplinkResolved) ? (
    <UplinkPostGameAction
      isQuickMatch={uplinkGame.matchIsQuickMatch}
      opponentLeft={opponentLeft}
      myRematchPending={uplinkGame.myRematchPending}
      opponentWantsRematch={uplinkGame.opponentWantsRematch}
      remainingSeconds={uplinkGame.remainingSeconds}
      onRematch={uplinkGame.rematch}
      onLeave={uplinkGame.leaveToOffline}
    />
  ) : undefined;

  // The bottom seat is always the perspective (near) color; the top seat is its opposite. Only the
  // bottom (your) card carries the center action. Board rotation turns only the grid — the cards
  // stay top/bottom and upright.
  const bottomPlayer: PlayerInfo = { ...withTurnStatus(describePlayer(perspective)), centerAction };

  // Mode badge — shown dead-center on the opponent's (top) card, mirroring where the flag/restart
  // icon lives on the bottom card. Lets the player glance up and immediately know the game mode.
  const modeLabelText =
    opponentMode === 'offline' ? 'Pass & Play'
    : opponentMode === 'uplink'
      ? uplinkGame.matchIsQuickMatch ? 'Quick Match' : 'Play a Friend'
    : opponentMode === 'protocol-run-dry' ? 'Run Dry'
    : null;
  const topCenterAction = modeLabelText ? (
    <span className="inline-flex items-center h-5 px-2.5 rounded-full bg-white/[0.06] ring-1 ring-white/[0.08] select-none whitespace-nowrap pointer-events-none">
      <span className="text-[9px] uppercase tracking-[0.12em] font-semibold text-gc-text-dim/70">{modeLabelText}</span>
    </span>
  ) : undefined;

  const topPlayer: PlayerInfo = { ...withTurnStatus(describePlayer(perspective === 'white' ? 'black' : 'white')), centerAction: topCenterAction };

  // Twin clock: no longer rendered as a separate panel — times are shown on the player cards.
  const clockSlot = null;

  // ── Review mode (scrubbingHighlights) ──────────────────────────────────────────────────────────
  // Active when the game has ended (status !== 'playing') OR while scrubbing the replay.
  // In this mode every board click routes to the read-only inspector instead of the live
  // select/move path. Uses the SAME legal-move rules as live play (wouldBeInCheck filter),
  // so checkmate = 0 legal moves for all pieces = no highlights. The isInCheck red tint on
  // the King's square is untouched — it's a permanent indicator, not part of highlights.
  const isReviewMode = status !== 'playing' || isScrubbing;
  const inspectEnPassant: SquareType | null = scrubState ? scrubState.enPassant : (enPassantTarget ?? null);

  const onInspectClick = (sq: SquareType) => {
    if (inspector.square === sq || !displayBoard[sq]) inspector.clear();
    else inspector.inspect(sq, displayBoard, inspectEnPassant);
  };

  // Clear inspector when the viewed ply changes (scrubbing) or a new game starts.
  const { clear: clearInspector } = inspector;
  useEffect(() => { clearInspector(); }, [viewPly, gameId, clearInspector]);

  // ── Board highlight props ─────────────────────────────────────────────────────────────────────
  // Two named bundles: playingHighlights (live game, current behavior untouched) and
  // scrubbingHighlights (read-only inspector for post-game / replay). The active bundle is
  // spread onto Board — zero ternaries at the call site.
  const playingHighlights: BoardHighlightProps = {
    selectedSquare,
    legalMoves,
    legalMovesVectorMap,
    previewSquare,
    previewMoves,
    previewMovesVectorMap,
    onSquareClick,
    canInteract: humanCanInteract,
  };
  const scrubbingHighlights: BoardHighlightProps = {
    selectedSquare: inspector.square,
    legalMoves: inspector.moves,
    legalMovesVectorMap: inspector.vectorMap,
    previewSquare: null,
    previewMoves: [],
    previewMovesVectorMap: undefined,
    onSquareClick: onInspectClick,
    canInteract: false,
  };
  const boardHighlights = isReviewMode ? scrubbingHighlights : playingHighlights;

  // ── King mood — the board King's face reacts to the game: 🤔 thinking (it's your move) → 😮 in
  // check → 😅 just escaped → 😎 confident (waiting for the opponent), and 😵 knocked out (you lost) /
  // 🫡 salute (you won or drew) at game end. Written to a tiny reactive store the King glyph reads
  // (no prop-drilling); a piloted royal has no King face, so this is naturally inert while boarded.
  // Scrubbing faithfully replays every ply's mood; the terminal 😵/🫡 live at the final (live) view.
  const prevCheckColorRef = useRef<PieceColor | null>(null);
  const prevMoodGameIdRef = useRef(gameId);
  // LIVE moods (not scrubbing). Deliberately OFF the moveHistory/viewPly deps: those append one
  // render AFTER a move, so if this effect re-fired on them it would run a second time with the
  // escape ref already advanced and clobber the one-ply 😅 back to 😎. The decision itself is the
  // pure computeLiveKingMoods (lib/chess/kingMood); this shell just feeds it state + persists the ref.
  useEffect(() => {
    if (prevMoodGameIdRef.current !== gameId) {
      prevMoodGameIdRef.current = gameId;
      prevCheckColorRef.current = null;
    }
    if (isScrubbing) return; // reviewing history → handled by the scrub effect below
    const { moods, checkColor } = computeLiveKingMoods({
      turn, inCheck, isGameOver, status: statusForReveal, uplinkResolved, uplinkResult, myColor,
      prevCheckColor: prevCheckColorRef.current,
    });
    setKingMoods(moods);
    prevCheckColorRef.current = checkColor;
  }, [inCheck, turn, isGameOver, isScrubbing, statusForReveal, gameId, uplinkResolved, uplinkResult, myColor]);

  // SCRUB moods — faithfully replay the VIEWED ply's mood from the move log via the pure
  // computeScrubKingMoods. Stateless, so the extra per-move re-fire during live play is a harmless
  // no-op guarded out here. Terminal 😵/🫡 live at the final (live) view, which scrub snaps back to.
  useEffect(() => {
    if (!isScrubbing) return;
    setKingMoods(computeScrubKingMoods({ viewPly, displayTurn, displayInCheck, moveHistory }));
  }, [isScrubbing, displayInCheck, displayTurn, moveHistory, viewPly]);
  // Vector Battery meter — summed remaining L/O/D charges per side, across each army's
  // Anomalies (Omni promotions use a different pool and are skipped). Ticks down as
  // Anomalies spend charges or get captured. `charges` follows `displayBoard` so it tracks
  // move-history scrubbing in lock-step with the board. The `you` side (your fixed color vs
  // a bot / in Uplink, or the side to move) gets the accent marker in its column.
  const vectorChargeYou: PieceColor = botActive ? humanColor : isUplink ? myColor : (scrubState ? scrubState.turn : turn);
  const vectorCharges = computeVectorCharges(displayBoard, vectorChargeYou);

  // Ghost battery — a faded "before" copy of the moved Anomaly's battery, left on the square
  // it just vacated. Works both live AND while scrubbing (computed by vectorCharges.ts).
  const moveGhost = computeMoveGhost({ isScrubbing, viewPly, moveHistory, displayBoard, lastMove, lastVectorSpend, board });

  // Parse a browsed replay file and stage it for confirmation (no board change yet).
  const handleImportReplay = (json: string, fileName: string) => {
    try {
      const replayIn = parseReplay(json);
      replayTo(replayIn); // validate every move applies before offering to load
      setPendingImport({ replay: replayIn, fileName, plies: replayIn.moves.length });
    } catch {
      setImportError('That file isn\u2019t a valid Gridlock replay. Pick a JSON exported with \u201CCopy \u2192 JSON\u201D.');
    }
  };

  // Confirmed: load the imported game's full history so it's scrubbable, board at the end.
  const confirmImport = () => {
    if (!pendingImport) return;
    const r = pendingImport.replay;
    const final = replayTo(r);
    loadPendingReplay(r);                    // preserve start + moves through the gameId effect
    setMoveHistory(buildHistoryFromReplay(r));
    setOpponentMode('offline');
    loadState({ board: final.board, turn: final.turn, enPassantTarget: final.enPassant });
    setPendingImport(null);
  };

  return (
    <div className="min-h-[100svh] flex flex-col items-center justify-center pt-4 pb-[calc(0.5rem_+_env(safe-area-inset-bottom))] gap-6">
      {/* Screen-reader-only clock announcer — fires on threshold crossings only (30s / 10s /
          flag) for the side to move, never a per-second stream. */}
      <div className="sr-only" role="status" aria-live="polite">{clockAnnounce}</div>

      {/* Reconnection countdown is now shown inline on the opponent's player card
          (see withTurnStatus) — no floating banner blocking the board. */}

      {/* Fixed app header — brand (left) + sound toggle & menu (right). Replaces the old inline
          title/subtitle and the floating sound button; `pt-20` above clears its 3.5rem height. */}
      <Header
        muted={muted}
        onToggleMute={toggleMuted}
        onMenuOpen={syncDraftsToCommitted}
        revealSignal={headerRevealSignal}
        pinned={headerPinned}
        playSlot={
          <PlaySettings
            opponentMode={draftOpponent}
            onOpponentChange={handleDraftOpponent}
            botActive={draftBotActive}
            activeBotDifficulty={draftBotDifficulty}
            humanColor={draftColor}
            isUplink={isUplink}
            uplinkStatus={uplink.status}
            uplinkRoomCode={uplink.roomCode}
            myColor={myColor}
            opponentName={opponentName}
            unlockedBots={runDry.unlockedBots}
            onOpenSandbox={() => navigate('/sandbox')}
            onColorSwitch={setDraftColor}
            timeControlId={draftTimeControl}
            onTimeControlChange={setDraftTimeControl}
            timeControlDisabled={isUplink || draftOpponent === 'protocol-run-dry'}
            isQuickMatch={uplinkGame.matchIsQuickMatch}
            boardAngle={boardAngle}
            onSetBoardAngle={setBoardAngle}
            onNewGame={commitNewGame}
            runDrySlot={
              opponentMode === 'protocol-run-dry' ? (
                <ProtocolRunDryPanel
                  tier={runDry.tier}
                  bestStreak={runDry.bestStreak}
                  difficultyName={RUN_DRY_TIER_LABELS[displayDifficulty].name}
                  totalTiers={runDry.totalTiers}
                  onRestart={() => setShowRunDryRestartConfirm(true)}
                />
              ) : undefined
            }
          />
        }
      />

      {/* Game area — mobile board-first column: the board leads, panels follow below it.
          Capped at 640px + centered so the board doesn't stretch absurdly wide on tablets,
          foldable-unfolded, or desktop. No effect on phones (< 640px), so the portrait
          phone layout is unchanged; a square is therefore min(12.5vw, 80px). */}
      <div className="w-full max-w-[640px] mx-auto flex flex-col gap-4 items-center" ref={gameAreaRef}>
        {/* Board with Player Cards */}
        <div className="w-full">
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <Board
            key={gameId}
            board={displayBoard}
            {...boardHighlights}
            lastMove={displayLastMove}
            lastMoveVectorType={displayLastMoveVectorType}
            moveGhost={moveGhost}
            inCheck={displayInCheck}
            turn={displayTurn}
            angle={boardAngle}
            kingSquare={displayKingSquare}
            pilotTargets={isReviewMode ? new Set() : pilotTargets}
            animateMoves={animateMoves}
            defeatedSquare={displayDefeatedSquare}
            topPlayer={topPlayer}
            bottomPlayer={bottomPlayer}
          />

          {/* Drag overlay — sized to one board square so the lifted piece matches the
              on-board size (the glyph's own `scale-125` supplies the subtle lift). The board
              is full-bleed up to the 640px column cap, so a square is min(12.5vw, 80px). */}
          <DragOverlay dropAnimation={null}>
            {draggedPiece && board[draggedPiece.square] && (
              <div className="w-[min(12.5vw,80px)] h-[min(12.5vw,80px)] cursor-grabbing">
                <Piece piece={board[draggedPiece.square]!} isDragging />
              </div>
            )}
          </DragOverlay>
        </DndContext>
        </div>

        {/* Live game state — clock + swipeable Battery / Coach / History deck (one surface) */}
        <div className="w-full px-3">
        <GameInfoPanel
          vectorCharges={vectorCharges}
          gameId={gameId}
          viewPly={viewPly}
          plyCount={replayMoves.length}
          onSeek={seekPly}
          getReplayJson={() => (replay ? serializeReplay(replay) : '')}
          onImportReplay={handleImportReplay}
          onSaveGameplay={(ply) => { setSaveGameplayError(null); setSaveGameplayPly(ply); }}
          replayFocusSignal={replayFocusSignal}
          clockSlot={clockSlot}
          capturedPieces={capturedPieces}
          botActive={botActive}
          humanColor={humanColor}
          coachSlot={
            /* Contextual coach rail — non-blocking, shows the single most relevant
               Gridlock-specific rule for the current board state (Tutorial Mode only).
               Stays mounted across the whole game so it never shifts the layout. Perspective
               is pinned per mode: bot ⇒ the human's fixed `humanColor`; uplink ⇒ your fixed
               `myColor` (you're always the same side, so the rail never narrates the remote
               opponent's position while they think); offline hot-seat ⇒ `turn`, so it speaks
               for whoever is up to move. Each board scan also filters to that side's pieces.
               This keeps "you just spent / exhausted a charge" (and the Pawn/King recap) tied
               to the side's OWN move instead of surfacing only after the opponent replies. */
            <CoachPanel
              board={board}
              humanColor={botActive ? humanColor : isUplink ? myColor : turn}
              selectedPiece={selectedSquare ? board[selectedSquare] ?? null : null}
              pilotTargets={[...pilotTargets]}
              lastSpend={humanLastSpend}
              lastMovedType={lastMovedType}
              lastMoveGridlocked={lastMoveGridlocked}
              lastMoveOverride={lastMoveOverride}
              lastMovePromoted={lastMovePromoted}
              pickedMode={lastModePick}
              status={statusForReveal}
              matchContext={coachMatchContext}
            />
          }
        />
        </div>
      </div>

      <GameModals
        endModalOpen={endModalOpen}
        endModalType={endModalType}
        endModalWinner={endModalWinner}
        isUplink={isUplink}
        opponentLeft={opponentLeft}
        isQuickMatch={uplinkGame.matchIsQuickMatch}
        status={statusForReveal}
        drawReason={drawReason}
        opponentMode={opponentMode}
        totalMoves={moveHistory.length}
        onPlayAgain={handlePlayAgain}
        onNextTier={handleNextTier}
        onViewBoard={() => {
          setEndModalDismissed(true);
          setHeaderRevealSignal((n) => n + 1);
          if (isUplink && !opponentLeft) {
            uplinkGame.startReviewCountdown();
          }
        }}
        onLeaveUplink={uplinkGame.leaveToOffline}
        runDry={runDry}
        uplink={uplink}
        onRunDryReview={() => { runDry.dismissComplete(); setEndModalDismissed(true); }}
        pendingImport={pendingImport}
        onConfirmImport={confirmImport}
        onCancelImport={() => setPendingImport(null)}
        importError={importError}
        onClearImportError={() => setImportError(null)}
        showResignConfirm={showResignConfirm}
        resignTurn={turn}
        onConfirmResign={() => {
          if (isUplink) {
            uplinkGame.resignMatch();
          } else {
            resign();
          }
          setShowResignConfirm(false);
        }}
        onCancelResign={() => setShowResignConfirm(false)}
        showRunDryRestartConfirm={showRunDryRestartConfirm}
        onConfirmRunDryRestart={() => {
          runDry.resetProgress();
          handlePlayAgain();
          setShowRunDryRestartConfirm(false);
        }}
        onCancelRunDryRestart={() => setShowRunDryRestartConfirm(false)}
        showNewGameConfirm={showNewGameConfirm}
        newGameConfirmMessage={newGameConfirmMessage}
        onConfirmNewGame={applyDraftAndNewGame}
        onCancelNewGame={() => { syncDraftsToCommitted(); setShowNewGameConfirm(false); }}
        pendingUplinkLeave={pendingUplinkLeave}
        onConfirmUplinkLeave={() => {
          if (pendingUplinkLeave) uplinkGame.leaveTo(pendingUplinkLeave);
          setPendingUplinkLeave(null);
        }}
        onCancelUplinkLeave={() => setPendingUplinkLeave(null)}
        uplinkOpen={uplinkOpen}
        uplinkOnlineCount={onlineCount}
        uplinkTimeControlId={uplinkGame.timeControlId}
        quickMatch={quickMatch}
        onUplinkTimeControlChange={uplinkGame.setTimeControlId}
        onUplinkModalLeave={() => { uplink.leave(); setOpponentMode('offline'); }}
        onUplinkModalClose={() => uplinkGame.setLobbyOpen(false)}
      />

      {/* Name-and-save the game (up to the viewed ply) into the Sandbox library as a ⏪ replay. */}
      <NamePromptModal
        isOpen={saveGameplayPly !== null}
        title={`Save this ${saveGameplayPly ?? 0}/${replayMoves.length} gameplay to Sandbox`}
        message="It appears in your Sandbox saved list (⏪) — replay and rewind it anytime."
        placeholder="Name this game (optional)"
        confirmLabel="Save to Sandbox"
        error={saveGameplayError}
        onConfirm={handleSaveGameplay}
        onCancel={() => { setSaveGameplayPly(null); setSaveGameplayError(null); }}
      />
    </div>
  );
}

export { LocalGame as default };
