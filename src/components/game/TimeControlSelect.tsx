// components/game/TimeControlSelect.tsx — Shared clock picker for PlaySettings and UplinkModal.
//
// Centralises the option list, label format, and filtering in one place so both
// callers stay in sync automatically. Styling (className / style) is caller-supplied
// because the two contexts (side panel vs modal dialog) have different visual treatments.
import type { CSSProperties } from 'react';
import { TIME_CONTROL_OPTIONS, type TimeControlId } from '@/constants/timeControls';

interface TimeControlSelectProps {
  value: TimeControlId;
  onChange: (id: TimeControlId) => void;
  /** Include the "No clock" option. Default true (PlaySettings). Uplink passes false. */
  includeNone?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
  style?: CSSProperties;
}

export function TimeControlSelect({
  value,
  onChange,
  includeNone = true,
  disabled,
  title,
  className,
  style,
}: TimeControlSelectProps) {
  const options = includeNone
    ? TIME_CONTROL_OPTIONS
    : TIME_CONTROL_OPTIONS.filter((o) => o.id !== 'none');

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as TimeControlId)}
      disabled={disabled}
      title={title}
      className={className}
      style={style}
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.id === 'none'
            ? '♾️ No clock'
            : `⏱ ${o.label} · ${o.category}${o.recommended ? ' · Recommended' : ''}`}
        </option>
      ))}
    </select>
  );
}
