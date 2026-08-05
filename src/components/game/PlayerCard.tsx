// components/game/PlayerCard.tsx — Minimal player identity strip inside board panel
import { useState, useRef, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { PieceColor } from '@/types/game';

interface PlayerCardProps {
  /** Player's display name */
  name: string;
  /** Which color pieces this player controls */
  color: PieceColor;
  /** Whether this card is editable */
  isEditable?: boolean;
  /** Callback when name is edited */
  onNameChange?: (newName: string) => void;
  /** Optional subtitle (e.g., "Level 13 · Advanced 3") */
  subtitle?: string;
  /** Whether it's this player's turn */
  isActive?: boolean;
  /** Whether this player (a bot) is currently computing its move — shows a live indicator. */
  thinking?: boolean;
  /** Live status shown on the ACTIVE seat only (e.g. "White to move" / "White is in check"). */
  statusText?: string;
  /** Role qualifier paired with statusText (e.g. "Your turn" / "Bot is thinking"). */
  statusRole?: string;
  /** Visual tone for statusText: 'win' (accent), 'danger' (red — check/defeat), 'neutral'. */
  statusTone?: 'neutral' | 'win' | 'danger';
  /** When set, replaces the right-column status with a styled clock display (icon + time). */
  clockDisplay?: { time: string; tone: 'danger' | 'neutral' };
  /** Optional context-aware action rendered dead-center of the card (New Game / Resign). */
  centerAction?: ReactNode;
  /** Position relative to board — affects styling */
  position: 'top' | 'bottom';
}

export function PlayerCard({
  name,
  color,
  isEditable = false,
  onNameChange,
  subtitle,
  isActive = false,
  thinking = false,
  statusText,
  statusRole,
  statusTone = 'neutral',
  clockDisplay,
  centerAction,
  position,
}: PlayerCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Sync editValue when name prop changes
  useEffect(() => {
    setEditValue(name);
  }, [name]);

  const handleStartEdit = () => {
    if (!isEditable || !onNameChange) return;
    setEditValue(name);
    setIsEditing(true);
  };

  const handleSave = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== name) {
      onNameChange?.(trimmed);
    } else {
      setEditValue(name);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      setEditValue(name);
      setIsEditing(false);
    }
  };

  // Minimal avatar: just the initial with color-coded styling
  const initial = name.charAt(0).toUpperCase();
  const avatarStyle = color === 'white'
    ? 'bg-slate-200 text-slate-800'
    : 'bg-slate-700 text-slate-200';

  return (
    <div
      className={`
        group grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-1
        ${position === 'top' ? 'pb-1.5' : 'pt-1.5'}
      `}
    >
      {/* Identity: avatar + name + subtitle + edit (left column) */}
      <div className="flex items-center gap-2.5 min-w-0">
        {/* Minimal avatar */}
        <div className={`
          w-6 h-6 rounded-full flex items-center justify-center
          text-xs font-bold select-none shrink-0
          ${avatarStyle}
          ${isActive ? 'ring-2 ring-gc-accent ring-offset-1 ring-offset-gc-panel' : ''}
          transition-all duration-200
        `}>
          {initial}
        </div>

        {/* Name (+ edit) over subtitle — two-line identity so a bot's rating stays visible. */}
        <div className="min-w-0 flex flex-col justify-center">
        <div className="min-w-0 flex items-center gap-1.5">
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value.slice(0, 20))}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            maxLength={20}
            className="
              bg-transparent border-b border-gc-accent/50 text-gc-text text-sm font-medium
              focus:outline-none focus:border-gc-accent w-full max-w-[120px]
            "
            aria-label="Edit player name"
          />
        ) : (
          <button
            onClick={handleStartEdit}
            disabled={!isEditable}
            className={`
              font-medium transition-colors text-left
              ${isEditable ? 'text-sm truncate max-w-[120px]' : 'text-xs leading-tight'}
              ${isActive ? 'text-gc-text' : 'text-gc-text-dim'}
              ${isEditable ? 'hover:text-gc-accent cursor-pointer' : 'cursor-default'}
            `}
            title={isEditable ? 'Click to edit' : undefined}
          >
            {name}
          </button>
        )}

        {/* Pencil icon — sits next to name, revealed on hover */}
        {isEditable && !isEditing && (
          <button
            onClick={handleStartEdit}
            className="
              text-gc-text-dim/40 hover:text-gc-accent transition-all shrink-0
              opacity-0 group-hover:opacity-100 focus-visible:opacity-100
            "
            aria-label="Edit name"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
        )}

        </div>

        {/* Subtitle (bot callsign e.g. "Level 13") — always visible, on its own line under the name. */}
        {subtitle && (
          <span className="text-[10px] text-gc-text-dim/70 truncate leading-tight">
            {subtitle}
          </span>
        )}

        {/* Status is rendered in the right grid column below. */}
        </div>
      </div>

      {/* Center action — dead-center quick action (New Game / Resign). The empty placeholder
          keeps the 3-column grid balanced when no action is supplied. */}
      {centerAction ?? <span aria-hidden="true" />}

      {/* Right column — clock display takes priority over generic status text. */}
      {clockDisplay ? (
        <span
          role="timer"
          aria-label="Clock"
          className={`justify-self-end ${subtitle ? 'self-end' : 'self-center'} inline-flex items-center gap-1 font-mono font-semibold tabular-nums text-[15px] whitespace-nowrap ${
            clockDisplay.tone === 'danger' ? 'text-red-300' : 'text-gc-text'
          }`}
        >
          <span aria-hidden="true" className="text-[13px] leading-none">🕰️</span>
          {clockDisplay.time}
        </span>
      ) : statusText ? (
        <span
          role="status"
          aria-live="polite"
          className={`justify-self-end min-w-0 inline-flex flex-col items-end leading-tight text-[11px] font-medium whitespace-nowrap ${subtitle ? 'self-end' : 'self-center'}`}
        >
          <span className={
            statusTone === 'win' ? 'font-semibold text-gc-accent'
              : statusTone === 'danger' ? 'text-red-300'
                : 'text-gc-text-dim'
          }>{statusText}</span>
          {statusRole && (
            <span className="inline-flex items-center gap-1 font-semibold text-gc-accent">
              {statusRole}
              {thinking && (
                <span className="inline-flex gap-0.5" aria-hidden="true">
                  <span className="w-1 h-1 rounded-full bg-gc-accent animate-bounce [animation-delay:-0.3s]" />
                  <span className="w-1 h-1 rounded-full bg-gc-accent animate-bounce [animation-delay:-0.15s]" />
                  <span className="w-1 h-1 rounded-full bg-gc-accent animate-bounce" />
                </span>
              )}
            </span>
          )}
        </span>
      ) : (
        <span aria-hidden="true" />
      )}
    </div>
  );
}

export default PlayerCard;
