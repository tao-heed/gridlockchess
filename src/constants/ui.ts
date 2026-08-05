// constants/ui.ts — Shared Tailwind class fragments to keep styling DRY.

/** Cyan→violet gradient fill used by primary action buttons. */
export const gcGradient = 'bg-gradient-to-r from-gc-accent to-gc-violet text-gc-bg';

/** Primary gradient button with the standard cyan glow + hover glow. */
export const gcGradientGlow =
  `${gcGradient} shadow-[0_4px_20px_-4px_rgba(34,224,255,0.5)] hover:shadow-[0_6px_28px_-4px_rgba(34,224,255,0.6)]`;

/** Shared side-rail vertical stack — FLAT (no card box): sections are separated by their own
 *  dividers/spacing instead of a rounded container, so Vector Battery / Move History / Tutorial
 *  read as inline sections rather than boxes (GameInfoPanel / GameSetupPanel). */
export const panelStack = 'flex flex-col gap-4';
