// components/game/panels/CoachPanel.tsx — Non-blocking contextual help rail (Tutorial Mode).
// Shows the single most relevant Gridlock-specific rule for the current board state,
// updating as the player moves. Replaces the occluding popup coachmarks: it never
// covers the board, so the player keeps full vision while learning.
import { motion, AnimatePresence } from 'framer-motion';
import type { Board as BoardType, Piece, PieceColor, VectorType, Anomaly, VectorPool, GameStatus, ArchetypeKey, Square } from '@/types/game';
import type { GenerationMode } from '@/lib/chess/generator';
import { isGridlocked } from '@/lib/chess/movement';
import { ARCHETYPE_REGISTRY } from '@/lib/chess/archetypes';
import { PIECE_REGISTRY, pieceLabel } from '@/lib/chess/pieces';

const VECTOR_META: Record<VectorType, { label: string; colorClass: string; hex: string }> = {
  L: { label: 'Leap', colorClass: 'text-gc-leap', hex: '#ff8f87' },
  O: { label: 'Orthogonal', colorClass: 'text-gc-ortho', hex: '#34d399' },
  D: { label: 'Diagonal', colorClass: 'text-gc-diag', hex: '#fbbf24' },
};

/** Shared pawn body JSX — reused by select-pawn and moved-pawn tips to stay DRY. */
const PAWN_BODY = (
  <>Moves like normal pawn — one step forward (two from its start), capturing
    diagonally. <span className="font-semibold">En passant</span> works normally. Pawns{' '}
    <span className="font-semibold text-gc-accent">never tire</span>. Reach the far rank and it
    auto-promotes to a <span className="font-semibold">{ARCHETYPE_REGISTRY.omni.alias}</span> — the only way to make one.</>
);

/** Shared king body JSX — reused by select-king and moved-king tips to stay DRY. */
const KING_BODY = (
  <>Moves one square in any direction, exactly like normal chess, and{' '}
    <span className="font-semibold text-gc-accent">never tires</span>. Step onto an adjacent
    friendly Anomaly to <span className="font-semibold text-amber-300">Override</span> it —
    piloting that piece and making it royal. Boarding is permanent (no dismount). Lose your
    King — or let a piloted Anomaly hit <span className="font-mono">0/0/0</span> — and the game is over.</>
);

/** Per-archetype coach prose — the ONLY archetype fact that lives here. Name and icon are
 *  derived from ARCHETYPE_REGISTRY (the single source of truth) in ARCHETYPE_DESC below, so
 *  a rename in archetypes.ts flows through automatically and can never drift. Grounded in
 *  each archetype's real vector roll: Absolute = all 10 in one style, High = one dominant,
 *  Hybrid = two styles, Balanced = 4/3/3, Omni = one shared pool. */
const ARCHETYPE_BODY: Record<ArchetypeKey, string> = {
  absLeap:   'Pure Leap (knight) jumps — hops over anything, never blocked. All 10 points are Leap, so it has no straight or diagonal moves at all.',
  absOrtho:  'Pure straight lines (rook) — long-range down ranks & files. All 10 points are Orthogonal; blocked by anything in its lane.',
  absDiag:   'Pure diagonals (bishop) — rules long diagonals but is locked to one color forever. All 10 points are Diagonal.',
  highLeap:  'Leap specialist (6–8) with a few backup straight/diagonal moves. Fork and evade with jumps; save the spares for escapes.',
  highOrtho: 'Straight-line specialist (6–8) with a few backup leaps/diagonals. Dominates open files and ranks.',
  highDiag:  'Diagonal specialist (6–8) with a few backups. Owns long diagonals; weaker once forced off its color.',
  hybridLO:  'Two-way mover: Leap + Straight (little to no diagonal). Knight hops plus rook lines — very flexible.',
  hybridLD:  'Two-way mover: Leap + Diagonal (little to no straight). Jumps in, and slices diagonally — strike-craft protocol.',
  hybridDO:  'Two-way mover: Diagonal + Straight (little to no leap) — essentially a queen-lite while charges last.',
  balanced:  'All-axis mover (4/3/3 split). Covers every angle, but no style runs deep — jack of all trades, master of none.',
  omni:      `Promotion-only. 8-point shared pool — spend on any direction, any time. 20% fewer charges, but ultimate flexibility. Your King cannot Override a ${ARCHETYPE_REGISTRY.omni.alias} — the pawn that promoted into it is already piloting.`,
};

/** Full coach descriptor per archetype. `name` and `icon` derive from the registry; only
 *  the tactical `body` blurb is authored here (ARCHETYPE_BODY). */
const ARCHETYPE_DESC: Record<ArchetypeKey, { name: string; icon: string; body: string }> =
  Object.fromEntries(
    (Object.keys(ARCHETYPE_BODY) as ArchetypeKey[]).map((key) => [
      key,
      { name: ARCHETYPE_REGISTRY[key].alias, icon: ARCHETYPE_REGISTRY[key].icon, body: ARCHETYPE_BODY[key] },
    ]),
  ) as Record<ArchetypeKey, { name: string; icon: string; body: string }>;

export interface CoachPanelProps {
  board: BoardType;
  humanColor: PieceColor;
  /** The piece the player currently has selected (or null). Drives "what does this do". */
  selectedPiece: Piece | null;
  /** Squares the selected King can board right now (Override available when non-empty). */
  pilotTargets: string[];
  /** The human's most recent charge spend, or null. */
  lastSpend: { vector: VectorType; remaining: number } | null;
  /** The kind of piece behind the most recent (relevant) move. Drives the post-move recap
   *  so the rail reflects the move just made instead of repeating the generic mode primer.
   *  Anomaly moves are covered by `lastSpend`; this carries Pawn/King recaps. */
  lastMovedType?: 'pawn' | 'king' | 'anomaly' | null;
  /** Archetype of the piece the most recent move just pushed to a full Gridlock (0/0/0), or
   *  null. Headlines the "X Gridlocked" recap — outranks the single-vector exhaust tip. */
  lastMoveGridlocked?: ArchetypeKey | null;
  /** Archetype the most recent move just boarded via Override (King → Anomaly), or null.
   *  Headlines the "Override engaged" recap — boarding spends no charge, so the rail would
   *  otherwise fall back to the mode primer. */
  lastMoveOverride?: ArchetypeKey | null;
  /** True if the most recent move was a pawn promotion (Anomaly Synthesis). Headlines the
   *  new Mech recap — promotion spends no charge, so without this the rail would fall
   *  back to the idle primer. */
  lastMovePromoted?: boolean;
  /** The generation mode the player just picked (transient), or null once play begins. */
  pickedMode?: GenerationMode | null;
  status: GameStatus;
  /** Current match context — lets the idle primer greet each mode (Uplink / Pass & Play /
   *  Protocol: Run Dry) instead of a one-size-fits-all blurb. Omitted ⇒ single-bot default. */
  matchContext?: MatchContext;
}

/** Lightweight description of the active match mode, surfaced by the idle Coach primer. */
export interface MatchContext {
  mode: 'offline' | 'protocol-run-dry' | 'uplink' | 'bot';
  /** Uplink only: opponent's (sanitized) display name, if announced. */
  opponentName?: string | null;
  /** Protocol: Run Dry only — current rung's flavor + position in the ladder. */
  tierCallsign?: string;
  tierName?: string;
  tierDisplay?: number;
  totalTiers?: number;
}

interface Tip {
  id: string;
  icon: string;
  title: string;
  body: React.ReactNode;
  accent: string; // ring/title color
}

/** Pick the single highest-relevance Gridlock rule to surface for the current state. */
function selectTip(p: CoachPanelProps): Tip {
  const { board, humanColor, selectedPiece, pilotTargets, lastSpend, pickedMode, status } = p;
  // Scan once for the human's royal pilot, any frozen anomaly, and a pawn one step
  // from promotion (white pawn on rank 7 → 8, black pawn on rank 2 → 1).
  let pilotedTotal: number | null = null;
  let hasGridlockedAnomaly = false;
  let pawnNearPromotion = false;
  const promotionRank = humanColor === 'white' ? '7' : '2';
  for (const sq of Object.keys(board)) {
    const piece = board[sq as keyof typeof board];
    if (!piece || piece.color !== humanColor) continue;
    if (piece.type === 'pawn' && sq[1] === promotionRank) pawnNearPromotion = true;
    if (piece.type !== 'anomaly') continue;
    const a = piece as Anomaly;
    if (a.piloted) {
      const v = a.vectors as VectorPool;
      pilotedTotal = v.L + v.O + v.D;
    }
    if (isGridlocked(piece)) hasGridlockedAnomaly = true;
  }

  // Just-in-time detect: the player has their King selected and a friendly Omni sits
  // adjacent. The Omni gets NO gold Override ring (Override is blocked for Omni), so the
  // absence is silently confusing — teach exactly here, when they're looking for it.
  let kingNextToFriendlyOmni = false;
  if (selectedPiece && selectedPiece.color === humanColor && selectedPiece.type === 'king') {
    const kingSq = (Object.keys(board) as Square[]).find((s) => board[s]?.id === selectedPiece.id);
    if (kingSq) {
      const f = kingSq.charCodeAt(0);
      const r = kingSq.charCodeAt(1);
      for (let df = -1; df <= 1 && !kingNextToFriendlyOmni; df++) {
        for (let dr = -1; dr <= 1; dr++) {
          if (df === 0 && dr === 0) continue;
          const nf = f + df;
          const nr = r + dr;
          if (nf < 97 || nf > 104 || nr < 49 || nr > 56) continue; // off-board ('a'-'h', '1'-'8')
          const t = board[String.fromCharCode(nf, nr) as Square];
          if (t && t.color === humanColor && t.type === 'anomaly' && t.archetype === 'omni') {
            kingNextToFriendlyOmni = true;
            break;
          }
        }
      }
    }
  }

  // 1) Terminal: sealed-bunker loss.
  if (status === 'gridlock-death') {
    return {
      id: 'gridlock-death',
      icon: '🔒',
      title: 'Gridlock Death',
      accent: '#f87171',
      body: (
        <>A piloted King with <span className="font-mono">0</span> charges is sealed in its
          bunker — an instant loss, even without checkmate. Never let your pilot run dry.</>
      ),
    };
  }

  // 2) Explicit intent: the player selected one of their Anomalies — teach what it does.
  if (selectedPiece && selectedPiece.color === humanColor && selectedPiece.type === 'anomaly') {
    const desc = ARCHETYPE_DESC[selectedPiece.archetype];
    const frozen = isGridlocked(selectedPiece);
    // A piloted (royal) Anomaly carries the King's life — that outranks the generic blurb.
    // Only regular Anomalies can be boarded (Omni never), so `piloted` is on this type.
    const piloted = selectedPiece.archetype !== 'omni' && selectedPiece.piloted === true;
    if (piloted) {
      const v = selectedPiece.vectors as VectorPool;
      const total = v.L + v.O + v.D;
      const critical = total <= 3;
      return {
        id: `select-royal-${selectedPiece.id}`,
        icon: '👑',
        title: `Royal ${desc.name}`,
        accent: critical ? '#f87171' : '#fcd34d',
        body: (
          <>Your King is piloting this <span className="font-semibold">{desc.name}</span> — it{' '}
            <span className="font-semibold text-amber-300">is</span> your King now, with{' '}
            <span className={`font-mono ${critical ? 'text-red-400 font-bold' : 'text-gc-text'}`}>{total}</span>{' '}
            {total === 1 ? 'charge' : 'charges'} of life left.{' '}
            {critical
              ? <span className="font-semibold text-red-400">Danger zone — 0/0/0 is an instant loss.</span>
              : <>Hitting <span className="font-mono">0/0/0</span> means Gridlock Death.</>}{' '}
            It still moves as a <span className="font-semibold">{desc.name}</span>; there's no dismount.</>
        ),
      };
    }
    return {
      id: `select-${selectedPiece.id}`,
      icon: desc.icon,
      title: desc.name,
      accent: '#22e0ff',
      body: (
        <>
          {desc.body}
          {frozen && (
            <> <span className="font-semibold" style={{ color: '#9aa6bd' }}>This one is Gridlocked</span> —
              all charges at <span className="font-mono">0</span>, frozen for the rest of the game.</>
          )}
        </>
      ),
    };
  }

  // 2b) Explicit intent: the player selected one of their Pawns — teach what it does.
  if (selectedPiece && selectedPiece.color === humanColor && selectedPiece.type === 'pawn') {
    return {
      id: 'select-pawn',
      icon: PIECE_REGISTRY.pawn.icon,
      title: pieceLabel('pawn'),
      accent: '#22e0ff',
      body: PAWN_BODY,
    };
  }

  // 2c) Transient: the player just dealt a new board — explain the army balance. Retires
  //     once they make their first move, and yields to any explicit piece selection
  //     (clicking a piece is direct intent — show its rule).
  if (pickedMode && !selectedPiece) {
    return {
      id: 'mode-balanced',
      icon: '⚖',
      title: 'Fresh board',
      accent: '#22e0ff',
      body: (
        <>Each new game shuffles your back rank — <span className="font-semibold text-gc-text">which
          pieces you get and where they stand</span>. Both sides get the same mirrored army, so
          it's always a fair fight.{' '}
          <a
            href="/rules#random-openings"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-gc-accent underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gc-accent rounded-sm"
          >
            Read more ↗
          </a></>
      ),
    };
  }

  // 3) Override is available this selection.
  if (pilotTargets.length > 0) {
    return {
      id: 'override',
      icon: '👑',
      title: 'Override available',
      accent: '#fcd34d',
      body: (
        <>Your King can <span className="font-semibold text-amber-300">board</span> the adjacent
          Anomaly on the gold ring — move onto it to pilot. The Anomaly becomes royal;
          its charges become your King's life. <span className="font-semibold text-red-400">If it
          hits 0/0/0, you instantly lose</span> (Gridlock Death). There is no dismount.</>
      ),
    };
  }

  // 4) Just-in-time negative rule: King selected next to a friendly Mech, but no gold
  //    ring appears — explain the absence right where the player is looking for it.
  if (kingNextToFriendlyOmni) {
    return {
      id: 'no-board-omni',
      icon: '🚫',
      title: `Can't board a ${ARCHETYPE_REGISTRY.omni.alias}`,
      accent: '#fcd34d',
      body: (
        <>Your King can Override (board) most adjacent Anomalies — but never a
          <span className="font-semibold"> {ARCHETYPE_REGISTRY.omni.alias}</span>. That's why it has no gold ring: the
          pawn that synthesized it is already at the controls, and a {ARCHETYPE_REGISTRY.omni.alias} — a relic of the old
          world's machine mind — self-pilots. There's no seat for a Commander.</>
      ),
    };
  }

  // 4b) Explicit intent: the player selected their King with no boardable Anomaly or
  //     adjacent Omni nearby — teach what the King is. (Override / can't-board-Omni
  //     contexts above take precedence when they apply.)
  if (selectedPiece && selectedPiece.color === humanColor && selectedPiece.type === 'king') {
    return {
      id: 'select-king',
      icon: PIECE_REGISTRY.king.icon,
      title: pieceLabel('king'),
      accent: '#22e0ff',
      body: KING_BODY,
    };
  }

  // ── EVENT RECAPS — what just happened takes priority over anticipatory tips ──

  // 6) The move just boarded an Anomaly via Override (King → Anomaly). Boarding spends no
  //    charge, so without this the rail would fall through to the mode primer right after a
  //    pivotal moment. Headline it. Fires in every mode (the latch in LocalGame mirrors the
  //    human in bot/uplink and the mover in offline). In offline the perspective has already
  //    flipped, so the board-scan "piloting" tip (3) won't fire for the boarding side until
  //    their next turn — this event recap covers that gap.
  if (p.lastMoveOverride) {
    const desc = ARCHETYPE_DESC[p.lastMoveOverride];
    return {
      id: `override-now-${p.lastMoveOverride}`,
      icon: '👑',
      title: 'Override engaged',
      accent: '#fcd34d',
      body: (
        <>Your King boarded the <span className="font-semibold">{desc.name}</span> — it's now{' '}
          <span className="font-semibold text-amber-300">royal</span>, and its charges are your
          King's life. <span className="font-semibold text-red-400">If it hits 0/0/0, you instantly
          lose</span> (Gridlock Death). Boarding is permanent — there's no dismount.</>
      ),
    };
  }

  // 6a) The move just promoted a pawn to an Omni (Anomaly Synthesis). Promotion spends
  //     no charge, so without this the rail would fall through to the idle primer. Must
  //     come before pawnNearPromotion — after one promotion, other pawns might still be
  //     on the near-promotion rank, but the recap of what JUST happened takes priority.
  if (p.lastMovePromoted) {
    return {
      id: 'promoted-now',
      icon: ARCHETYPE_REGISTRY.omni.icon,
      title: `Anomaly Synthesis → ${ARCHETYPE_REGISTRY.omni.alias}`,
      accent: '#22e0ff',
      body: (
        <>Your pawn underwent <span className="font-semibold text-gc-accent">Anomaly Synthesis</span> —
          it's now a <span className="font-semibold">{ARCHETYPE_REGISTRY.omni.alias}</span> with a fresh
          8-point <span className="font-semibold">shared pool</span> (spend on any direction). It's the
          only way to make one. <span className="font-semibold text-amber-300">Your King can never board it</span> —
          a {ARCHETYPE_REGISTRY.omni.alias} self-pilots; your pawn is already at the controls.</>
      ),
    };
  }

  // 6b) The move just pushed the moving Anomaly to a FULL Gridlock (0/0/0) — the headline
  //     event. It outranks the single-vector "exhausted" tip below because a fully frozen
  //     piece is a far bigger deal than one locked-out vector. Fires in every mode (the
  //     latch in LocalGame mirrors the human in bot/uplink and the mover in offline).
  if (p.lastMoveGridlocked) {
    const desc = ARCHETYPE_DESC[p.lastMoveGridlocked];
    return {
      id: `gridlocked-now-${p.lastMoveGridlocked}`,
      icon: '🪫',
      title: `${desc.name} Gridlocked`,
      accent: '#f87171',
      body: (
        <>That <span className="font-semibold">{desc.name}</span> just hit{' '}
          <span className="font-mono">0/0/0</span> — it's <span className="font-semibold" style={{ color: '#f87171' }}>frozen
          for the rest of the game</span>. It can't move, threaten squares, or give check, but it
          can still be captured.</>
      ),
    };
  }

  // 6c) Just spent a charge — event recap of what just happened.
  if (lastSpend) {
    const meta = VECTOR_META[lastSpend.vector];
    const exhausted = lastSpend.remaining === 0;
    return {
      id: `spend-${lastSpend.vector}-${lastSpend.remaining}`,
      icon: exhausted ? '🪫' : '🔋',
      title: exhausted ? 'Vector exhausted' : 'Charge spent',
      accent: exhausted ? '#9aa6bd' : meta.hex,
      body: exhausted ? (
        <>That <span className={`font-semibold ${meta.colorClass}`}>{meta.label}</span> vector
          is now <span className="font-mono text-gc-text">0</span> — that movement type is{' '}
          <span className="font-semibold text-gc-text-dim">locked out</span> for the rest
          of the game. If all three hit 0, the piece Gridlocks completely.</>
      ) : (
        <>That move cost a <span className={`font-semibold ${meta.colorClass}`}>{meta.label}</span>{' '}
          charge — <span className="font-mono text-gc-text">{lastSpend.remaining}</span> left in that
          type. Anomalies never recharge.</>
      ),
    };
  }

  // ── ANTICIPATORY — what's about to happen ──

  // 7) Anticipatory: a pawn is one step from promotion — teach the Omni reward BEFORE
  //    the commit, since promotion is automatic (no choice modal reveals it).
  if (pawnNearPromotion) {
    return {
      id: 'promotion',
      icon: ARCHETYPE_REGISTRY.omni.icon,
      title: `Promotion → ${ARCHETYPE_REGISTRY.omni.alias}`,
      accent: '#22e0ff',
      body: (
        <>Push that pawn to the back rank and it undergoes <span className="font-semibold text-gc-accent">Anomaly
          Synthesis</span> — auto-promoting to an <span className="font-semibold">{ARCHETYPE_REGISTRY.omni.alias}</span> with a fresh
          8-point <span className="font-semibold">shared pool</span> (spend on any direction). It's the only
          way to make one.</>
      ),
    };
  }

  // ── POST-MOVE RECAPS — low-priority event recaps for pawn/king moves ──
  // (Anomaly moves are already recapped by "Charge spent" above; this handles
  // the non-charge-spending piece types.)

  // 8) Post-move recap for pawn. Nothing is selected and nothing urgent, but a pawn
  //    just moved — recap it instead of falling through to passive state reminders.
  if (p.lastMovedType === 'pawn') {
    // In Pass & Play (offline), the turn has already flipped to the opponent, but the MOVER's
    // pawn might now be on the near-promotion rank. Check the opposite color (the one who just
    // moved) so the promotion tip fires even after the turn flip. In bot/uplink modes,
    // humanColor IS the mover's color (lastMovedType is only set for the human's moves).
    const isOffline = p.matchContext?.mode === 'offline';
    const moverColor = isOffline ? (humanColor === 'white' ? 'black' : 'white') : humanColor;
    const moverPromotionRank = moverColor === 'white' ? '7' : '2';
    let moverPawnNearPromotion = false;
    for (const sq of Object.keys(board)) {
      const piece = board[sq as keyof typeof board];
      if (piece && piece.color === moverColor && piece.type === 'pawn' && sq[1] === moverPromotionRank) {
        moverPawnNearPromotion = true;
        break;
      }
    }
    if (moverPawnNearPromotion) {
      return {
        id: 'promotion-after-move',
        icon: ARCHETYPE_REGISTRY.omni.icon,
        title: `Promotion → ${ARCHETYPE_REGISTRY.omni.alias}`,
        accent: '#22e0ff',
        body: (
          <>That pawn is one step from the back rank — push it forward and it undergoes{' '}
            <span className="font-semibold text-gc-accent">Anomaly Synthesis</span>, auto-promoting to
            a <span className="font-semibold">{ARCHETYPE_REGISTRY.omni.alias}</span> with a fresh 8-point
            <span className="font-semibold"> shared pool</span>. It's the only way to make one.</>
        ),
      };
    }
    return {
      id: 'moved-pawn',
      icon: PIECE_REGISTRY.pawn.icon,
      title: pieceLabel('pawn'),
      accent: '#22e0ff',
      body: PAWN_BODY,
    };
  }

  // 8b) Post-move recap for king.
  if (p.lastMovedType === 'king') {
    return {
      id: 'moved-king',
      icon: PIECE_REGISTRY.king.icon,
      title: pieceLabel('king'),
      accent: '#22e0ff',
      body: KING_BODY,
    };
  }

  // ── PASSIVE STATE REMINDERS — persistent board conditions ──

  // 9) Piloting reminder. The piloted Anomaly persists every turn, so this is a PASSIVE state
  //    at ALL charge levels — it sits BELOW the event/post-move recaps (§6–8) so "Charge spent"
  //    and the pawn/king recaps always surface for the move just made. Danger (≤3 charges) is
  //    conveyed here via red styling rather than a high-priority interrupt (which would nag
  //    every turn and drown out recaps). The actual death is caught by the terminal tip (§1),
  //    and selecting the piece shows the royal detail (§2). Ranks above a stray gridlocked
  //    piece — it's YOUR King's life on the line.
  if (pilotedTotal !== null) {
    const critical = pilotedTotal <= 3;
    return {
      id: 'piloting',
      icon: '👑',
      title: critical ? 'Piloted King in danger' : 'Your King is piloting',
      accent: critical ? '#f87171' : '#fcd34d',
      body: (
        <>That Anomaly is now <span className="font-semibold text-amber-300">royal</span> — its
          charges are your King's life.{' '}
          <span className={`font-mono ${critical ? 'text-red-400 font-bold' : 'text-gc-text'}`}>{pilotedTotal}</span>{' '}
          {pilotedTotal === 1 ? 'move' : 'moves'} left{critical ? ' — ' : '. '}
          {critical
            ? <span className="font-semibold text-red-400">danger zone! 0/0/0 = instant loss.</span>
            : <>Hitting <span className="font-mono">0/0/0</span> means Gridlock Death.</>}</>
      ),
    };
  }

  // 9b) Something is frozen — remind the player what that means.
  if (hasGridlockedAnomaly) {
    return {
      id: 'gridlocked',
      icon: '🪫',
      title: 'A piece is Gridlocked',
      accent: '#9aa6bd',
      body: (
        <>An Anomaly at <span className="font-mono">0/0/0</span> is frozen for the rest of the
          game — it can't move, <span className="font-semibold">can't threaten squares or give check</span>,
          but can still be captured. Your King and pawns never tire.</>
      ),
    };
  }

  // ── IDLE PRIMERS — mode-aware greetings when nothing else applies ──

  // 10) Idle primer — mode-aware. With nothing pressing on the board, greet the player
  //     with context for the match they're in (Uplink / Pass & Play / Protocol: Run Dry),
  //     falling back to the generic Gridlock 101 for a single-bot game.
  const ctx = p.matchContext;
  if (ctx?.mode === 'uplink') {
    return {
      id: 'mode-uplink',
      icon: '🛰️',
      title: 'Uplink — Live Match',
      accent: '#22e0ff',
      body: (
        <>You're connected{ctx.opponentName ? <> to <span className="font-semibold text-gc-accent">{ctx.opponentName}</span></> : ' to a live opponent'}.
          Colors are <span className="font-semibold">rolled randomly</span> each game and both armies
          are <span className="font-semibold">Balanced</span> for a fair fight. Every move syncs in
          real time — <span className="font-semibold text-red-400">no take-backs</span>.</>
      ),
    };
  }
  if (ctx?.mode === 'offline') {
    return {
      id: 'mode-offline',
      icon: '👥',
      title: 'Pass & Play',
      accent: '#22e0ff',
      body: (
        <>Two commanders, one screen. Hand the device off each turn — the Coach speaks for
          whoever's <span className="font-semibold text-gc-accent">up to move</span>. No bot here —
          just you, a friend, and one board. Win by checkmate before your army runs dry.</>
      ),
    };
  }
  if (ctx?.mode === 'protocol-run-dry') {
    const ladder = ctx.tierDisplay && ctx.totalTiers
      ? <> — Level <span className="font-mono text-gc-text">{ctx.tierDisplay}</span>/<span className="font-mono">{ctx.totalTiers}</span></>
      : null;
    return {
      id: 'mode-run-dry',
      icon: '🪫',
      title: ctx.tierCallsign ? `Run Dry · ${ctx.tierCallsign}` : 'Protocol: Run Dry',
      accent: '#fbbf24',
      body: (
        <>Facing {ctx.tierName ? <span className="font-semibold text-gc-accent">{ctx.tierName}</span> : 'the next opponent'}{ladder}.
          Each win <span className="font-semibold">climbs the ladder</span> and escalates the bot's
          depth; a loss <span className="font-semibold text-red-400">resets your run</span>. Steady,
          clean play beats reckless aggression.</>
      ),
    };
  }

  // 10b) Generic primer — single-bot game (or unknown context).
  return {
    id: 'idle',
    icon: '🔋',
    title: 'Gridlock 101',
    accent: '#22e0ff',
    body: (
      <>Each Anomaly has <span className="font-mono text-gc-text">10</span> charges split
        across three movement types. Every move spends one and never refills — win by checkmate before
        your army runs dry.</>
    ),
  };
}

export function CoachPanel(props: CoachPanelProps) {
  const tip = selectTip(props);

  return (
    <div className="pt-2">
      <AnimatePresence mode="wait">
        <motion.div
          key={tip.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22 }}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center justify-center gap-2 mb-1">
            <span className="text-base leading-none">{tip.icon}</span>
            <span className="text-[13px] font-semibold" style={{ color: tip.accent }}>
              {tip.title}
            </span>
          </div>
          {/* Body stays LEFT-aligned for readability, with a subtle symmetric gutter (px-3) so lines
              never run edge-to-edge, plus a measure cap (~48ch) + mx-auto so it also stays tidy on
              wider screens — balanced under the centred title, without the ragged-left hit of centring. */}
          <p className="mx-auto max-w-[48ch] px-3 text-[12px] text-gc-text-dim leading-snug">{tip.body}</p>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export { CoachPanel as default };
