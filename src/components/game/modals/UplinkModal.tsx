// components/game/modals/UplinkModal.tsx — Uplink (Online PvP) lobby dialog.
//
// Drives the pre-match flow: open a room (host), join one with a passcode (guest),
// or find any online opponent via Quick Match (FIFO matchmaking).
// Once both peers are present the parent closes this modal and the match begins.
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Share } from '@capacitor/share';
import { gcGradient, gcGradientGlow } from '@/constants/ui';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { readReconnectData, clearReconnectData, type UplinkStatus } from '@/hooks/useUplink';
import type { QuickMatchApi } from '@/hooks/useQuickMatch';
import type { UplinkRole } from '@/lib/net/protocol';
import { TIME_CONTROL_OPTIONS, type TimeControlId } from '@/constants/timeControls';
import { TimeControlSelect } from '@/components/game/TimeControlSelect';

export interface UplinkModalProps {
  isOpen: boolean;
  status: UplinkStatus;
  role: UplinkRole | null;
  roomCode: string | null;
  error: string | null;
  /** Approximate live player count derived from /presence/ children. */
  onlineCount: number;
  /** Host-selected clock for the match; the guest adopts it on connect. */
  timeControlId: TimeControlId;
  onTimeControlChange: (id: TimeControlId) => void;
  onHost: () => void;
  onJoin: (code: string) => void;
  onRejoin: (code: string, role: UplinkRole) => void;
  onLeave: () => void;
  onClose: () => void;
  quickMatch: QuickMatchApi;
}

function fmtElapsed(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}



export function UplinkModal({
  isOpen,
  status,
  role,
  roomCode,
  error,
  onlineCount,
  timeControlId,
  onTimeControlChange,
  onHost,
  onJoin,
  onRejoin,
  onLeave,
  onClose,
  quickMatch,
}: UplinkModalProps) {
  const [screen, setScreen] = useState<'choice' | 'join'>('choice');
  const [codeInput, setCodeInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const online = useOnlineStatus();

  // Auto-reconnect: check localStorage for a room from a prior session.
  const [reconnect, setReconnect] = useState(readReconnectData);

  useEffect(() => {
    Share.canShare().then(({ value }) => setCanShare(value)).catch(() => {});
  }, []);

  // Refresh reconnect data each time the lobby opens.
  useEffect(() => {
    if (!isOpen || status !== 'idle') { setReconnect(null); return; }
    setReconnect(readReconnectData());
  }, [isOpen, status]);

  // Reset the lobby UI whenever it is freshly opened or the connection is dropped.
  useEffect(() => {
    if (isOpen && status === 'idle') {
      setScreen('choice');
      setCodeInput('');
      setCopied(false);
    }
  }, [isOpen, status]);

  // When quick match is cancelled, return to the choice screen.
  useEffect(() => {
    if (quickMatch.status === 'idle') setScreen('choice');
  }, [quickMatch.status]);

  const copyCode = async () => {
    if (!roomCode) return;
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — the code is still shown on screen */
    }
  };

  const shareCode = async () => {
    if (!roomCode) return;
    try {
      await Share.share({
        title: 'Join my Gridlock Chess game',
        text: `Join my Gridlock Chess game — room code: ${roomCode}`,
        dialogTitle: 'Share Room Code',
      });
    } catch {
      /* user cancelled or share unavailable */
    }
  };

  const cancel = () => {
    if (quickMatch.status === 'searching') quickMatch.cancel();
    onLeave();
    onClose();
  };

  // Back from the "Play a Friend" waiting screen: stop hosting but stay in the lobby.
  const backFromWaiting = () => {
    onLeave();
    setScreen('choice');
  };
  // Always-current ref so the 30s timeout fires with the latest onLeave/screen state.
  const backFromWaitingRef = useRef(backFromWaiting);
  backFromWaitingRef.current = backFromWaiting;

  const isWaiting    = status === 'waiting';
  const isConnecting = status === 'connecting';
  const isConnected  = status === 'connected';
  const isSearching  = quickMatch.status === 'searching';
  const isQmMatched  = quickMatch.status === 'matched';

  // Auto-reset: if Quick Match paired us but the guest doesn't join within 30s,
  // leave the room and go back to the lobby so the user can retry.
  useEffect(() => {
    if (!isWaiting || !isQmMatched) return;
    const t = window.setTimeout(() => backFromWaitingRef.current(), 30_000);
    return () => window.clearTimeout(t);
  }, [isWaiting, isQmMatched]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4"
          onClick={cancel}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 8 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="relative overflow-hidden bg-gc-panel/95 backdrop-blur-xl border border-white/10 rounded-2xl p-6 max-w-sm w-full shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]"
          >
            <div className="absolute inset-0 -z-10 opacity-50 bg-gradient-to-br from-gc-accent/15 via-gc-violet/10 to-gc-accent/15" />

            {/* Header */}
            <div className="flex flex-col items-center text-center mb-5">
              <div className="text-4xl mb-2 drop-shadow-[0_0_20px_rgba(34,224,255,0.5)]">🛰</div>
              <h2 className="text-xl font-bold text-white tracking-tight">Uplink</h2>
              <p className="text-sm text-white/50 mt-0.5">Online PvP — play anyone, anywhere</p>
              {onlineCount > 0 && (
                <p className="text-xs text-gc-accent/70 mt-1">~{onlineCount} online</p>
              )}
            </div>

            {/* Error banner */}
            {error && (
              <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300 text-center">
                {error}
              </div>
            )}

            {/* Offline notice — Uplink needs a network connection */}
            {!online && status === 'idle' && !isSearching && (
              <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200 text-center">
                You're offline. Online PvP needs an internet connection.
              </div>
            )}

            {/* ── Quick Match — searching ── */}
            {isSearching && (
              <div className="flex flex-col items-center gap-4 py-2">
                <motion.div
                  className="h-10 w-10 rounded-full border-2 border-gc-accent/30 border-t-gc-accent"
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }}
                />
                <div className="text-center">
                  <p className="text-sm text-white/70">Searching for an opponent…</p>
                  <p className="text-xs text-white/40 mt-1 font-mono">{fmtElapsed(quickMatch.elapsed)}</p>
                </div>
                <p className="text-xs text-gc-accent/70">
                  {quickMatch.othersSearching > 0
                    ? `${quickMatch.othersSearching} other${quickMatch.othersSearching === 1 ? '' : 's'} searching`
                    : 'No one else searching yet…'}
                </p>
                <button
                  onClick={quickMatch.cancel}
                  className="w-full rounded-xl px-4 py-2 text-sm text-white/50 hover:text-white/80 transition-colors"
                >
                  ← Back
                </button>
              </div>
            )}

            {/* ── Choice screen ── */}
            {status === 'idle' && !isSearching && screen === 'choice' && (
              <div className="flex flex-col gap-3">

                {/* ── Auto-reconnect: active room from a prior session ── */}
                {reconnect ? (
                  <>
                    <button
                      onClick={() => { onRejoin(reconnect.code, reconnect.role); setReconnect(null); }}
                      disabled={!online}
                      className={`flex items-center justify-center gap-2 w-full rounded-xl px-4 py-3 font-semibold ${gcGradientGlow} transition-shadow disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      {reconnect.source === 'quick-match'
                        ? '🔄 Reconnect to Quick Match'
                        : `🔄 Reconnect to Room ${reconnect.code}`}
                    </button>
                    <p className="text-[11px] text-white/40 text-center leading-snug">
                      You have an active match. Reconnect before your opponent claims the win.
                    </p>
                    <button
                      onClick={() => { clearReconnectData(); setReconnect(null); }}
                      className="w-full rounded-xl px-4 py-2 text-sm text-white/40 hover:text-white/70 transition-colors"
                    >
                      Abandon match
                    </button>
                  </>
                ) : (
                  /* ── Normal lobby buttons ── */
                  <>
                <button
                  onClick={quickMatch.enter}
                  disabled={!online}
                  className={`flex items-center justify-center gap-2 w-full rounded-xl px-4 py-3 font-semibold ${gcGradientGlow} transition-shadow disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  🌐 Quick Match
                </button>
                <p className="text-[11px] text-white/40 text-center -mt-1 mb-2">Play a random opponent · 10 min + 5 sec clock</p>
                <div className="flex flex-col gap-1.5 border-t border-white/5 pt-4">
                  <label className="text-xs uppercase tracking-wider text-white/40">
                    Friend Room Clock
                  </label>
                  <TimeControlSelect
                    value={timeControlId}
                    onChange={onTimeControlChange}
                    includeNone={false}
                    disabled={quickMatch.status !== 'idle'}
                    className="w-full rounded-xl bg-gc-bg/60 border border-white/15 pl-4 pr-10 py-2.5 text-sm text-white cursor-pointer focus:outline-none focus:border-gc-accent/60 appearance-none disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%238896b0' d='M2 4l4 4 4-4'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 14px center' }}
                  />
                </div>
                <button
                  onClick={onHost}
                  disabled={!online}
                  className="flex items-center justify-center gap-2 w-full rounded-xl px-4 py-3 font-semibold bg-white/5 border border-white/10 text-white hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  📡 Play a Friend
                </button>
                <button
                  onClick={() => setScreen('join')}
                  disabled={!online}
                  className="flex items-center justify-center gap-2 w-full rounded-xl px-4 py-3 font-semibold bg-white/5 border border-white/10 text-white hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  🔗 Join with Code
                </button>
                  </>
                )}
              </div>
            )}

            {/* ── Join screen ── */}
            {status === 'idle' && !isSearching && screen === 'join' && (
              <div className="flex flex-col gap-3">
                <label className="text-xs uppercase tracking-wider text-white/40">Room code</label>
                <input
                  autoFocus
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && codeInput.trim()) onJoin(codeInput);
                  }}
                  placeholder="e.g. K7QM2"
                  maxLength={8}
                  className="w-full rounded-xl bg-gc-bg/60 border border-white/15 px-4 py-3 text-center text-2xl font-mono tracking-[0.4em] text-gc-accent placeholder:text-white/20 focus:outline-none focus:border-gc-accent/60"
                />
                <button
                  onClick={() => onJoin(codeInput)}
                  disabled={!codeInput.trim() || !online}
                  className={`flex items-center justify-center gap-2 w-full rounded-xl px-4 py-3 font-semibold ${gcGradient} shadow-[0_4px_20px_-4px_rgba(34,224,255,0.5)] disabled:opacity-40 disabled:shadow-none transition-all`}
                >
                  🔗 Connect
                </button>
                <button
                  onClick={() => setScreen('choice')}
                  className="w-full rounded-xl px-4 py-2 text-sm text-white/50 hover:text-white/80 transition-colors"
                >
                  ← Back
                </button>
              </div>
            )}

            {/* ── Connecting ── */}
            {isConnecting && (
              <div className="flex flex-col items-center gap-3 py-4">
                <motion.div
                  className="h-8 w-8 rounded-full border-2 border-gc-accent/30 border-t-gc-accent"
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}
                />
                <p className="text-sm text-white/60">Connecting…</p>
              </div>
            )}

            {/* ── Host waiting for opponent ── */}
            {isWaiting && role === 'host' && (
              <div className="flex flex-col items-center gap-4">
                {isQmMatched ? (
                  /* Quick Match — opponent is joining automatically; no code to share */
                  <>
                    <motion.div
                      className="h-8 w-8 rounded-full border-2 border-gc-accent/30 border-t-gc-accent"
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}
                    />
                    <p className="text-sm text-white/60 text-center">
                      Opponent found — connecting…
                    </p>
                    <p className="text-[11px] text-white/30 text-center leading-snug">
                      This may take a few seconds on slower connections.
                    </p>
                    <button
                      onClick={backFromWaiting}
                      className="w-full rounded-xl px-4 py-2 text-sm text-white/50 hover:text-white/80 transition-colors"
                    >
                      ← Back
                    </button>
                  </>
                ) : (
                  /* Play a Friend — share the code manually */
                  <>
                    <p className="text-sm text-white/60 text-center">
                      Share this code with your opponent.
                    </p>
                    <button
                      onClick={copyCode}
                      className="group relative w-full rounded-xl bg-gc-bg/60 border border-gc-accent/30 px-4 py-4 transition-colors hover:border-gc-accent/60"
                      title="Copy room code"
                    >
                      <span className="block text-3xl font-mono tracking-[0.4em] text-gc-accent text-center">
                        {roomCode}
                      </span>
                      <span className="mt-1 block text-xs text-white/40 text-center">
                        {copied ? '✓ Copied!' : 'Tap to copy'}
                      </span>
                    </button>
                    {canShare && (
                      <button
                        onClick={shareCode}
                        className="flex items-center justify-center gap-2 w-full rounded-xl px-4 py-2.5 text-sm font-medium bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white transition-colors"
                      >
                        📤 Share Code
                      </button>
                    )}
                    <div className="flex items-center gap-2 text-sm text-white/50">
                      <motion.span
                        className="inline-block h-2 w-2 rounded-full bg-gc-accent"
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ repeat: Infinity, duration: 1.4 }}
                      />
                      Waiting for opponent to join…
                    </div>
                    <p className="text-xs text-white/40 text-center">
                      {(() => {
                        const o = TIME_CONTROL_OPTIONS.find((opt) => opt.id === timeControlId);
                        return o
                          ? `⏱ ${o.label} · ${o.category}${o.recommended ? ' · Recommended' : ''}`
                          : '♾️ No clock';
                      })()}
                    </p>
                    <button
                      onClick={backFromWaiting}
                      className="w-full rounded-xl px-4 py-2 text-sm text-white/50 hover:text-white/80 transition-colors"
                    >
                      ← Back
                    </button>
                  </>
                )}
              </div>
            )}

            {/* ── Connected ── */}
            {isConnected && (
              <div className="flex flex-col items-center gap-3 py-4">
                <div className="text-3xl">✅</div>
                <p className="text-sm text-white/70 text-center">
                  Opponent connected — entering match…
                </p>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
