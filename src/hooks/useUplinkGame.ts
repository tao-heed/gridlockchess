// hooks/useUplinkGame.ts — Online PvP (Uplink) game orchestration.
//
// Owns ALL peer-to-peer concerns for the local game screen: the relay connection
// (via useUplink), the per-match color roll, opponent identity, the live position
// mirrors that async socket callbacks read, the ply counter + expected-hash guards
// that keep both peers in lockstep, and every transition (join / state-init / remote
// move / resign / rematch / resync / leave).
//
// LocalGame stays the single owner of board state; this hook drives it through the
// injected controls (makeMove / resetGame / loadState / setPerspective / …) and only
// asks the move-tracking effect to notify it once per committed move via
// `onMoveCommitted`. That keeps the netcode's stale-read guards (the cause of the old
// "my move snapped back" desync) in one cohesive place instead of scattered inline.
import { useEffect, useRef, useState } from 'react';
import { parseSquare, type PieceColor, type GameStatus, type Square, type Board, type Piece } from '@/types/game';
import type { GenerationMode } from '@/lib/chess/generator';
import {
  hashBoard,
  sanitizePlayerName,
  type GameMessage,
  type GameOverMessage,
  type UplinkRole,
} from '@/lib/net/protocol';
import { isTerminalStatus } from '@/utils/statusMessage';
import { useUplink, readReconnectData } from '@/hooks/useUplink';
import { cleanupRoom } from '@/lib/net/roomCleanup';
import type { OpponentMode } from '@/components/game/panels';
import { QUICK_MATCH_TIME_CONTROL, type ClockRemaining, type TimeControlId } from '@/constants/timeControls';

// How long a non-mover waits for the running side's own `timeout` self-report before claiming
// the win itself. Our local estimate of the opponent's clock runs slightly AHEAD of their real
// clock (it starts ticking when we made our move, they start when they receive it — the network
// latency), so we must give their authoritative flag time to arrive before claiming, or we'd rob
// them of up to one round-trip of time. 3s comfortably covers real-world relay latency.
const FLAG_CLAIM_GRACE_MS = 3000;

interface UseUplinkGameParams {
  /** Current opponent selection (the dropdown). Uplink is one of its values. */
  opponentMode: OpponentMode;
  setOpponentMode: (mode: OpponentMode) => void;
  /** Live committed position — mirrored into refs for async socket callbacks. */
  board: Board;
  turn: PieceColor;
  enPassantTarget: Square | undefined;
  generationMode: GenerationMode;
  playerName: string;
  /** Game-state controls (owned by LocalGame's useGameState). */
  makeMove: (from: Square, to: Square, promotionOverride?: Piece) => void;
  resetGame: () => void;
  loadState: (snapshot: {
    board: Board;
    turn: PieceColor;
    enPassantTarget?: Square | null;
  }) => void;
  /** Screen controls the hook drives on match transitions. */
  setPerspective: (color: PieceColor) => void;
  setGenerationMode: (mode: GenerationMode) => void;
  setEndModalDismissed: (value: boolean) => void;
  /** Current game status — used to detect board-level terminal states and notify the peer. */
  status: GameStatus;
  /** Clears the move-history list + the dedupe ref (owned by LocalGame). */
  resetTracking: () => void;
  /** Read the live clock remaining (both sides) to attach to an outgoing move, or null when
   *  the match is untimed / the clock is off. */
  getClockSnapshot: () => ClockRemaining | null;
  /** Adopt a peer's authoritative clock snapshot (re-syncs both sides on their move/resync). */
  onAdoptClock: (remaining: ClockRemaining) => void;
  /** Called when a rematch starts — lets LocalGame play the new-game sound. */
  onNewGame?: () => void;
}

export function useUplinkGame({
  opponentMode,
  setOpponentMode,
  board,
  turn,
  enPassantTarget,
  generationMode,
  playerName,
  status,
  makeMove,
  resetGame,
  loadState,
  setPerspective,
  setGenerationMode,
  setEndModalDismissed,
  resetTracking,
  getClockSnapshot,
  onAdoptClock,
  onNewGame,
}: UseUplinkGameParams) {
  const [uplinkOpen, setUplinkOpen] = useState(false);
  const [uplinkResult, setUplinkResult] = useState<'win' | 'loss' | null>(null);
  const [pendingInit, setPendingInit] = useState(false);
  // True for the duration of a Quick Match game — hides Rematch so players
  // search for a fresh random opponent rather than rematching the same person.
  const [matchIsQuickMatch, setMatchIsQuickMatch] = useState(false);
  // Color this client plays for the current Uplink match. Rolled randomly by the host
  // and adopted (inverted) by the guest — null when not in an active Uplink game.
  const [uplinkColor, setUplinkColor] = useState<PieceColor | null>(null);
  const uplinkColorRef = useRef<PieceColor | null>(null);
  // Opponent's announced display name (sanitized). Null until their `hello` arrives.
  const [opponentName, setOpponentName] = useState<string | null>(null);
  // Survivor-side flag: the opponent left the Uplink room entirely (not just resigned in
  // place). A rematch is impossible once they're gone, so we hide that action.
  const [opponentLeft, setOpponentLeft] = useState(false);
  const roleRef = useRef<UplinkRole | null>(null);
  const matchStartedRef = useRef(false);
  // Lets relay callbacks (which close over a stale `uplink`) send on the live socket.
  const sendRef = useRef<((msg: GameMessage) => void) | null>(null);
  // Live mirrors of position state for async (WebSocket) callbacks, which would
  // otherwise read stale values committed at the time the handler closure was built.
  const boardRef = useRef(board);
  const turnRef = useRef(turn);
  const enPassantRef = useRef(enPassantTarget);
  // Move count since the game (or last resync) began. Both peers increment it once per
  // applied move, so it stays in lockstep and lets us reject stale snapshots.
  const plyRef = useRef(0);
  // Hash a remote mover claims its board has AFTER the move it just sent. Consumed by
  // `onMoveCommitted` (which runs on COMMITTED state, so the comparison is never stale).
  const expectedRemoteHashRef = useRef<string | null>(null);
  // The clock this match runs. Host-chosen; the guest adopts the host's pick from `state-init`.
  // Mirrored to a ref so relay callbacks (stale closures) can read it.
  const [uplinkTimeControlId, setUplinkTimeControlId] = useState<TimeControlId>('10+5');
  const uplinkTimeControlIdRef = useRef<TimeControlId>('10+5');
  useEffect(() => { uplinkTimeControlIdRef.current = uplinkTimeControlId; });
  // How the current match ended out-of-band, for end-modal wording ('resign' | 'timeout').
  const [resultReason, setResultReason] = useState<'resign' | 'timeout' | null>(null);
  // A remote move carries the mover's authoritative clock; stashed here on arrival and
  // adopted in `onMoveCommitted` (which runs on committed state, after the clock's turn edge).
  const remoteClockRef = useRef<ClockRemaining | null>(null);
  // Pending "opponent flagged, waiting for their self-report" grace timer. See claimOpponentFlag.
  const flagClaimTimerRef = useRef<number | null>(null);
  const clearFlagClaim = () => {
    if (flagClaimTimerRef.current != null) {
      window.clearTimeout(flagClaimTimerRef.current);
      flagClaimTimerRef.current = null;
    }
  };

  // Rematch handshake (friend room only): both sides must opt in before the board resets.
  // myRematchPending = I sent { type:'rematch' }; opponentWantsRematch = they sent it first.
  // Refs mirror state so async socket callbacks always read the latest value (stale closure guard).
  const [myRematchPending, setMyRematchPending] = useState(false);
  const [opponentWantsRematch, setOpponentWantsRematch] = useState(false);
  const myRematchPendingRef = useRef(false);
  const opponentWantsRematchRef = useRef(false);

  // Peer-confirmed game result — set when the other peer sends { type: 'game-over' }.
  // Used as a fallback in LocalGame: if the local engine doesn't reach the same terminal
  // status (e.g. a charge-state discrepancy), this ensures the end modal still fires.
  const [peerConfirmedResult, setPeerConfirmedResult] = useState<{
    status: GameOverMessage['status'];
    winner: PieceColor | null;
  } | null>(null);

  // 30-second auto-leave countdown. Starts when View Board is clicked (review phase) and
  // restarts when Resume is clicked (waiting phase). Expiry auto-disconnects the player.
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const countdownRef = useRef<number | null>(null);
  const rematchDeadlineRef = useRef<number | null>(null);
  const autoLeaveRef = useRef<(() => void) | null>(null);

  const clearRematchCountdown = () => {
    if (countdownRef.current != null) {
      window.clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    rematchDeadlineRef.current = null;
    setRemainingSeconds(null);
  };

  const startRematchCountdown = () => {
    clearRematchCountdown();
    rematchDeadlineRef.current = Date.now() + 30000;
    setRemainingSeconds(30);
    countdownRef.current = window.setInterval(() => {
      const deadline = rematchDeadlineRef.current;
      if (deadline == null) return;
      const sec = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemainingSeconds(sec);
      if (sec <= 0) {
        clearRematchCountdown();
        autoLeaveRef.current?.();
      }
    }, 1000);
  };

  // Extracted helper — the single place that resets tracking and kicks off a new game.
  // Called when BOTH sides have confirmed: either rematch() sees opponentWantsRematchRef,
  // or onRematch sees myRematchPendingRef.
  const startNewGame = () => {
    onNewGame?.();
    setMyRematchPending(false);
    myRematchPendingRef.current = false;
    setOpponentWantsRematch(false);
    opponentWantsRematchRef.current = false;
    setPeerConfirmedResult(null);
    clearRematchCountdown();
    resetTracking();
    plyRef.current = 0;
    expectedRemoteHashRef.current = null;
    remoteClockRef.current = null;
    clearFlagClaim();
    setUplinkResult(null);
    setResultReason(null);
    setEndModalDismissed(false);
    if (roleRef.current === 'host') {
      const hostColor: PieceColor = Math.random() < 0.5 ? 'white' : 'black';
      setUplinkColor(hostColor);
      uplinkColorRef.current = hostColor;
      setPerspective(hostColor);
      setGenerationMode('balanced');
      resetGame();
      setPendingInit(true);
    }
    // Guest: waits for host's state-init (no action here).
  };

  const uplink = useUplink({
    // Host only: a guest just arrived. Roll a fresh board and queue it for transmit.
    onPeerJoined: () => {
      resetTracking();
      plyRef.current = 0;
      expectedRemoteHashRef.current = null;
      setUplinkResult(null);
      setEndModalDismissed(false);
      setOpponentName(null);
      setOpponentLeft(false);
      setMyRematchPending(false);
      myRematchPendingRef.current = false;
      setOpponentWantsRematch(false);
      opponentWantsRematchRef.current = false;
      setPeerConfirmedResult(null);
      clearRematchCountdown();
      const isQM = readReconnectData()?.source === 'quick-match';
      setMatchIsQuickMatch(isQM);
      // Quick Match always uses the fixed Rapid clock, ignoring the player's selection.
      if (isQM) {
        setUplinkTimeControlId(QUICK_MATCH_TIME_CONTROL);
        uplinkTimeControlIdRef.current = QUICK_MATCH_TIME_CONTROL;
      }
      // Roll a random color for fairness — neither player gets a permanent first-move edge.
      const hostColor: PieceColor = Math.random() < 0.5 ? 'white' : 'black';
      setUplinkColor(hostColor);
      uplinkColorRef.current = hostColor;
      setPerspective(hostColor);
      // Uplink is always Balanced — force it regardless of the prior local pick.
      setGenerationMode('balanced');
      resetGame();
      setPendingInit(true);
      setUplinkOpen(false);
    },
    onPeerLeft: () => {
      setOpponentName(null);
      // The opponent left the room — a rematch is no longer possible. Award the win if a
      // match was underway, and flag the departure so the end modal hides Rematch.
      setOpponentLeft(true);
      setMyRematchPending(false);
      myRematchPendingRef.current = false;
      setOpponentWantsRematch(false);
      opponentWantsRematchRef.current = false;
      clearRematchCountdown();
      if (matchStartedRef.current) setUplinkResult((r) => r ?? 'win');
    },
    // Opponent came back after a disconnect (or re-joined the room). The connected peer
    // (whichever side has the live board) re-asserts the current position so the returning
    // peer loads the correct board immediately — works for both host and guest reconnection.
    onPeerReconnected: () => {
      setOpponentLeft(false);
      setUplinkResult(null);
      setResultReason(null);
      // `hostColor` in the snapshot must always be the HOST's color, not the sender's.
      // When the guest sends this resync (host reconnected), uplinkColorRef is the guest's
      // color — invert it. When the host sends it (guest reconnected), it's already correct.
      const myColor = uplinkColorRef.current;
      const senderIsHost = roleRef.current === 'host';
      const hostColor: PieceColor = myColor == null
        ? 'white'
        : senderIsHost
          ? myColor
          : (myColor === 'white' ? 'black' : 'white');
      sendRef.current?.({
        type: 'resync',
        ply: plyRef.current,
        snapshot: {
          board: boardRef.current,
          turn: turnRef.current,
          ...(enPassantRef.current != null ? { enPassantTarget: enPassantRef.current } : {}),
          mode: generationMode,
          hostColor,
          timeControlId: uplinkTimeControlIdRef.current,
          ...(getClockSnapshot() != null ? { clock: getClockSnapshot()! } : {}),
        },
      });
    },
    // Guest only: adopt the host's authoritative position (skips random generation).
    onStateInit: (snapshot, ply) => {
      resetTracking();
      plyRef.current = ply;
      expectedRemoteHashRef.current = null;
      remoteClockRef.current = null;
      clearFlagClaim();
      setUplinkResult(null);
      setResultReason(null);
      setEndModalDismissed(false);
      setOpponentLeft(false);
      setPeerConfirmedResult(null);
      setMatchIsQuickMatch(readReconnectData()?.source === 'quick-match');
      // Adopt the host's chosen clock so both peers run the identical time control.
      setUplinkTimeControlId(snapshot.timeControlId);
      uplinkTimeControlIdRef.current = snapshot.timeControlId;
      // Derive our color from the snapshot. Host re-join: myColor = hostColor.
      // Guest (normal join or re-join): myColor = opposite of hostColor.
      const isHost = roleRef.current === 'host';
      const myUplinkColor: PieceColor = isHost
        ? snapshot.hostColor
        : (snapshot.hostColor === 'white' ? 'black' : 'white');
      setUplinkColor(myUplinkColor);
      uplinkColorRef.current = myUplinkColor;
      setPerspective(myUplinkColor);
      setGenerationMode(snapshot.mode);
      loadState({ board: snapshot.board, turn: snapshot.turn, enPassantTarget: snapshot.enPassantTarget });
      if (snapshot.clock) onAdoptClock(snapshot.clock);
      matchStartedRef.current = true;
      setUplinkOpen(false);
    },
    // Apply the opponent's move. The hash they sent is verified later on COMMITTED state
    // (in onMoveCommitted), so we never compare against a half-applied board here —
    // that stale read was the cause of the "my move snapped back" desync.
    // `promotion` is the exact piece the sender promoted to (if any); passing it through
    // ensures both peers apply the identical piece rather than each generating independently.
    onRemoteMove: (from, to, hash, clock, promotion) => {
      expectedRemoteHashRef.current = hash;
      // The opponent moved, so they did NOT flag — cancel any pending flag-claim, and stash
      // their authoritative clock for adoption once the move commits.
      clearFlagClaim();
      remoteClockRef.current = clock ?? null;
      makeMove(from as Square, to as Square, promotion);
    },
    onResign: () => {
      clearFlagClaim();
      setResultReason('resign');
      setUplinkResult('win');
    },
    // The opponent's own clock flagged and they self-reported: they lose, we win.
    onTimeout: () => {
      clearFlagClaim();
      setResultReason('timeout');
      setUplinkResult((r) => r ?? 'win');
    },
    onRematch: () => {
      if (myRematchPendingRef.current) {
        // Both sides confirmed — start the game.
        startNewGame();
      } else {
        // Opponent requested first — the center action pill updates to show
        // "[name] is ready · Rematch". No modal re-open needed.
        setOpponentWantsRematch(true);
        opponentWantsRematchRef.current = true;
      }
    },
    onGameOver: (rawStatus, rawWinner) => {
      // Peer confirmed the game ended at a board level. Store as fallback: LocalGame uses
      // this if the local engine hasn't reached the same terminal status yet.
      const validStatuses = ['checkmate', 'stalemate', 'draw', 'gridlock-death'] as const;
      const s = validStatuses.find((v) => v === rawStatus);
      if (!s) return; // malformed signal — ignore
      const w: PieceColor | null =
        rawWinner === 'white' ? 'white' : rawWinner === 'black' ? 'black' : null;
      setPeerConfirmedResult({ status: s, winner: w });
    },
    // Adopt the host's authoritative board — but ONLY if it isn't older than what we've
    // already applied. A resync lagging our own latest move would otherwise revert it
    // (the bug behind "my move snapped back"). The ply guard makes that impossible.
    onResync: (snapshot, ply) => {
      if (ply < plyRef.current) return; // stale — ignore
      plyRef.current = ply;
      expectedRemoteHashRef.current = null;
      loadState({ board: snapshot.board, turn: snapshot.turn, enPassantTarget: snapshot.enPassantTarget });
      if (snapshot.clock) onAdoptClock(snapshot.clock);
      // Re-join support: if the lobby is still open (player refreshed and re-joined mid-game),
      // adopt color/perspective and close the modal — same as onStateInit but for ply > 0.
      // Host re-join: myColor = hostColor. Guest re-join: myColor = opposite of hostColor.
      if (uplinkOpen) {
        const isHost = roleRef.current === 'host';
        const myUplinkColor: PieceColor = isHost
          ? snapshot.hostColor
          : (snapshot.hostColor === 'white' ? 'black' : 'white');
        setUplinkColor(myUplinkColor);
        uplinkColorRef.current = myUplinkColor;
        setPerspective(myUplinkColor);
        setGenerationMode(snapshot.mode);
        if (snapshot.timeControlId) {
          setUplinkTimeControlId(snapshot.timeControlId);
          uplinkTimeControlIdRef.current = snapshot.timeControlId;
        }
        setMatchIsQuickMatch(readReconnectData()?.source === 'quick-match');
        matchStartedRef.current = true;
        // Clear any stale result that may have been set before the resync arrived
        // (e.g. a historical resign signal that slipped through before skipKeys could
        // filter it). The resync confirms the game is live — no pending result should
        // survive the reconnect window.
        setUplinkResult(null);
        setResultReason(null);
        setOpponentLeft(false);
        setUplinkOpen(false);
      }
    },
    // Host only: a peer detected a desync and asked us to re-assert the truth.
    onResyncRequest: () => {
      if (roleRef.current !== 'host') return;
      sendRef.current?.({
        type: 'resync',
        ply: plyRef.current,
        snapshot: {
          board: boardRef.current,
          turn: turnRef.current,
          ...(enPassantRef.current != null ? { enPassantTarget: enPassantRef.current } : {}),
          mode: generationMode,
          hostColor: uplinkColorRef.current ?? 'white',
          timeControlId: uplinkTimeControlIdRef.current,
          ...(getClockSnapshot() != null ? { clock: getClockSnapshot()! } : {}),
        },
      });
    },
    // Opponent announced (or re-announced) their name. Sanitize untrusted remote input.
    onPeerHello: (name) => {
      setOpponentName(sanitizePlayerName(name));
    },
  });

  const isUplink = opponentMode === 'uplink';
  // The color this client controls: the rolled Uplink color when in a match, else the
  // role default (host White / guest Black) as a safe fallback before state-init lands.
  const myColor: PieceColor = uplinkColor ?? (uplink.role === 'guest' ? 'black' : 'white');

  // Keep a ref of the assigned role for use inside relay callbacks.
  useEffect(() => { roleRef.current = uplink.role; }, [uplink.role]);

  // Expose the live socket sender to relay callbacks (which capture a stale `uplink`).
  useEffect(() => { sendRef.current = uplink.send; });

  // Announce our name to the opponent on connect, and re-announce on every rename so
  // their card updates live mid-match. Cheap and idempotent — a `hello` is just a label.
  useEffect(() => {
    if (isUplink && uplink.status === 'connected') {
      // Use sendRef (always current) rather than uplink.send directly — uplink.send is a
      // new reference every render (no useCallback), so including it in deps would cause
      // this effect to fire on every render, pushing a hello signal to Firebase every tick.
      sendRef.current?.({ type: 'hello', name: playerName });
    }
  }, [isUplink, uplink.status, playerName]);

  // Mirror live position state into refs for async WebSocket callbacks.
  useEffect(() => {
    boardRef.current = board;
    turnRef.current = turn;
    enPassantRef.current = enPassantTarget;
  });

  // Explicitly signal board-level terminal states to the peer — resign/timeout have their
  // own dedicated signals; checkmate, stalemate, draw, and gridlock-death get this one.
  // Defence-in-depth: in the normal case both engines agree and the peer's local detection
  // is sufficient; if charge-state or ep-target drift causes divergence, this signal
  // ensures the peer's end modal still fires with the correct type and winner.
  // Both peers send it independently (whoever detects the terminal state), so the
  // recipient always gets at least one copy.
  useEffect(() => {
    if (!isUplink || !isTerminalStatus(status) || uplinkResult !== null) return;
    if (status === 'resigned' || status === 'timeout') return; // handled by their own signals
    const t = turnRef.current; // post-move turn: loser for checkmate, winner for gridlock-death
    const winner: PieceColor | null =
      status === 'checkmate'      ? (t === 'white' ? 'black' : 'white')
      : status === 'gridlock-death' ? t
      : null; // stalemate / draw
    sendRef.current?.({ type: 'game-over', status, winner });
  }, [isUplink, status, uplinkResult]);

  // Auto-dismiss the lobby: host dismisses via onPeerJoined (same render batch as
  // resetGame, so the board is correct on first paint). Guest dismisses via onStateInit
  // (after loadState, so the board is correct on first paint). No generic auto-dismiss
  // needed — each path closes the lobby at the exact moment the board is ready.

  // Host: transmit the authoritative position once a fresh board is queued.
  useEffect(() => {
    if (!isUplink || uplink.role !== 'host' || !pendingInit || uplink.status !== 'connected') return;
    plyRef.current = 0;
    sendRef.current?.({
      type: 'state-init',
      ply: 0,
      snapshot: {
        board,
        turn,
        ...(enPassantTarget != null ? { enPassantTarget } : {}),
        mode: generationMode,
        hostColor: uplinkColor ?? 'white',
        timeControlId: uplinkTimeControlId,
      },
    });
    matchStartedRef.current = true;
    setPendingInit(false);
  }, [pendingInit, board, turn, enPassantTarget, generationMode, isUplink, uplink.role, uplink.status, uplinkColor, uplinkTimeControlId]);

  // ── Move notification — called once per COMMITTED move by LocalGame's move effect ──
  // Runs on final board/turn/enPassant (the effect fires after commit), so the hashes
  // here are authoritative — never half-applied. Increments the shared ply counter for
  // both peers, then either announces our own move or verifies the opponent's and resyncs.
  const onMoveCommitted = (moverColor: PieceColor, from: Square, to: Square) => {
    plyRef.current += 1;
    if (!isUplink) return;
    if (moverColor === myColor) {
      // My own move: tell the opponent, with the resulting board hash and my authoritative
      // post-move clock (both sides), so they re-sync their estimate of both clocks.
      expectedRemoteHashRef.current = null;
      const snap = getClockSnapshot();
      // Detect pawn promotion: a pawn reaching the back rank is replaced by an Anomaly
      // inline by applyMoveToBoard. Send the exact piece so the receiver applies the
      // identical object rather than generating their own (guards against future RNG).
      const { rankIdx: toRank } = parseSquare(to);
      const backRank = myColor === 'white' ? 7 : 0;
      const promotedPiece = (toRank === backRank && board[to]?.type === 'anomaly')
        ? (board[to] as Piece)
        : undefined;
      uplink.send({
        type: 'move',
        from,
        to,
        hash: hashBoard(board, turn, enPassantTarget),
        ...(snap          ? { clock:     snap          } : {}),
        ...(promotedPiece ? { promotion: promotedPiece } : {}),
      });
    } else {
      // Opponent's move just applied locally: adopt their authoritative clock, then verify
      // our board matches theirs.
      const rc = remoteClockRef.current;
      remoteClockRef.current = null;
      if (rc) onAdoptClock(rc);
      const expected = expectedRemoteHashRef.current;
      expectedRemoteHashRef.current = null;
      if (expected && hashBoard(board, turn, enPassantTarget) !== expected) {
        console.warn('[Uplink] board divergence after remote move — resyncing from host');
        if (uplink.role === 'host') {
          uplink.send({
            type: 'resync',
            ply: plyRef.current,
            snapshot: {
              board,
              turn,
              ...(enPassantTarget != null ? { enPassantTarget } : {}),
              mode: generationMode,
              hostColor: uplinkColor ?? 'white',
              timeControlId: uplinkTimeControlIdRef.current,
              ...(getClockSnapshot() != null ? { clock: getClockSnapshot()! } : {}),
            },
          });
        } else {
          uplink.send({ type: 'resync-request' });
        }
      }
    }
  };

  // ── Controls surfaced to LocalGame ────────────────────────────────────────────
  // Open the Uplink lobby: lock Balanced (Uplink is Balanced-only) and switch the mode.
  const openLobby = () => {
    setOpponentMode('uplink');
    setGenerationMode('balanced');
    setUplinkOpen(true);
  };

  // Leave quietly — used when there's no live match to forfeit (solo in lobby, or the
  // opponent already left). The caller switches opponentMode afterward.
  const leaveQuietly = () => {
    if (roleRef.current === 'host' && uplink.roomCode) cleanupRoom(uplink.roomCode);
    uplink.leave();
    clearFlagClaim();
    clearRematchCountdown();
    setUplinkResult(null);
    setResultReason(null);
    setUplinkColor(null);
    uplinkColorRef.current = null;
    setOpponentLeft(false);
    setMatchIsQuickMatch(false);
    matchStartedRef.current = false;
    setMyRematchPending(false);
    myRematchPendingRef.current = false;
    setOpponentWantsRematch(false);
    opponentWantsRematchRef.current = false;
    setPeerConfirmedResult(null);
  };

  // Forfeit and exit a live Uplink match, then continue into the chosen local mode with a
  // fresh game. The resign frame is sent first so the opponent is notified before teardown.
  const leaveTo = (target: OpponentMode) => {
    if (matchStartedRef.current) uplink.send({ type: 'resign' });
    if (roleRef.current === 'host' && uplink.roomCode) cleanupRoom(uplink.roomCode);
    uplink.leave();
    clearFlagClaim();
    clearRematchCountdown();
    setUplinkResult(null);
    setResultReason(null);
    setUplinkColor(null);
    uplinkColorRef.current = null;
    setOpponentLeft(false);
    setMatchIsQuickMatch(false);
    matchStartedRef.current = false;
    setEndModalDismissed(true);
    resetTracking();
    setOpponentMode(target);
    resetGame();
    setMyRematchPending(false);
    myRematchPendingRef.current = false;
    setOpponentWantsRematch(false);
    opponentWantsRematchRef.current = false;
    setPeerConfirmedResult(null);
  };

  // Exit the match back to offline (from the end modal's Leave action).
  const leaveToOffline = () => {
    if (roleRef.current === 'host' && uplink.roomCode) cleanupRoom(uplink.roomCode);
    uplink.leave();
    clearFlagClaim();
    clearRematchCountdown();
    setUplinkResult(null);
    setResultReason(null);
    setUplinkColor(null);
    uplinkColorRef.current = null;
    setOpponentLeft(false);
    setMatchIsQuickMatch(false);
    matchStartedRef.current = false;
    setEndModalDismissed(true);
    setOpponentMode('offline');
    resetTracking();
    resetGame();
    setMyRematchPending(false);
    myRematchPendingRef.current = false;
    setOpponentWantsRematch(false);
    opponentWantsRematchRef.current = false;
    setPeerConfirmedResult(null);
  };

  const rematch = () => {
    uplink.send({ type: 'rematch' });
    setMyRematchPending(true);
    myRematchPendingRef.current = true;
    // Restart 30s countdown for the waiting phase.
    startRematchCountdown();
    // If opponent already requested, both sides are now confirmed → start immediately.
    // Reads the ref (not state) to avoid stale closure.
    if (opponentWantsRematchRef.current) {
      startNewGame();
    }
  };

  // Resign a live match: notify the opponent and record the loss for the end modal.
  const resignMatch = () => {
    uplink.send({ type: 'resign' });
    setResultReason('resign');
    setUplinkResult('loss');
  };

  // My own clock hit zero on my turn (my machine is authoritative over my clock). Tell the
  // opponent and record the loss. Idempotent-safe: onFlag fires once per flag.
  const reportOwnTimeout = () => {
    clearFlagClaim();
    uplink.send({ type: 'timeout' });
    setResultReason('timeout');
    setUplinkResult((r) => r ?? 'loss');
  };

  // My local estimate says the opponent's clock flagged. Because that estimate runs slightly
  // ahead of their real clock, wait a grace period for their authoritative `timeout` (or a
  // move, which cancels this) before claiming the win ourselves — covers a disconnected peer.
  const claimOpponentFlag = () => {
    if (flagClaimTimerRef.current != null) return; // already waiting
    flagClaimTimerRef.current = window.setTimeout(() => {
      flagClaimTimerRef.current = null;
      setResultReason('timeout');
      setUplinkResult((r) => r ?? 'win');
    }, FLAG_CLAIM_GRACE_MS);
  };

  // Keep autoLeaveRef pointed at the latest leaveToOffline so the countdown interval
  // (which captured a stale scope) always calls the current version.
  autoLeaveRef.current = leaveToOffline;

  // Cancel pending timers on unmount.
  useEffect(() => () => {
    if (flagClaimTimerRef.current != null) {
      window.clearTimeout(flagClaimTimerRef.current);
      flagClaimTimerRef.current = null;
    }
    clearRematchCountdown();
  }, []);

  return {
    uplink,
    isUplink,
    /** True once the Uplink match color has been rolled (host: onPeerJoined; guest: onStateInit).
     *  False while just browsing the lobby. Used by LocalGame to avoid switching the time
     *  control — and accidentally flagging the local clock at 0ms — before the match starts. */
    matchStarted: uplinkColor !== null,
    myColor,
    opponentName,
    opponentLeft,
    matchIsQuickMatch,
    myRematchPending,
    opponentWantsRematch,
    peerConfirmedResult,
    remainingSeconds,
    startReviewCountdown: startRematchCountdown,
    reconnecting: uplink.status === 'reconnecting',
    reconnectDeadline: uplink.reconnectDeadline,
    selfDisconnected: uplink.selfDisconnectDeadline != null,
    selfDisconnectDeadline: uplink.selfDisconnectDeadline,
    result: uplinkResult,
    resultReason,
    timeControlId: uplinkTimeControlId,
    setTimeControlId: setUplinkTimeControlId,
    reportOwnTimeout,
    claimOpponentFlag,
    lobbyOpen: uplinkOpen,
    setLobbyOpen: setUplinkOpen,
    onMoveCommitted,
    openLobby,
    leaveQuietly,
    leaveTo,
    leaveToOffline,
    rematch,
    resignMatch,
  };
}
