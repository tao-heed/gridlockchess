// components/game/sandbox/SandboxBoard.tsx — Editor board grid for the Sandbox.
//
// White perspective (a1 bottom-left) by default. Each square is a button; the page decides what a
// tap does (place the armed piece, or remove an occupied one). Placed pieces render with the real
// <Piece> (glyph + charge battery) so the editor looks exactly like the live game.
//
// Orientation is purely visual — square identities, taps, and every edit are unchanged; only the
// on-screen placement of each square changes. Four views are supported:
//   • white — a1 bottom-left (White at the bottom).
//   • black — 180° turn (Black at the bottom; a1 top-right).
//   • left  — 90° turn, White on the RIGHT / Black on the LEFT.
//   • right — 90° turn, White on the LEFT / Black on the RIGHT.
import { FILES, RANKS, type Board, type Square } from '@/types/game';
import { Piece } from '@/components/pieces/Piece';

export type BoardOrientation = 'white' | 'black' | 'left' | 'right';

/** The board square shown at screen cell (row 0 = top, col 0 = left) for a given orientation.
 *  f = file index 0..7 (a..h), r = rank index 0..7 (rank 1..8). Each case is a rigid rotation of
 *  the White view (no reflection), so square colours and piece relationships stay intact. */
function squareAt(orientation: BoardOrientation, row: number, col: number): Square {
  let f: number;
  let r: number;
  switch (orientation) {
    case 'black': f = 7 - col; r = row; break;       // 180°
    case 'right': f = row; r = col; break;           // 90° CW  → White on the left
    case 'left': f = 7 - row; r = 7 - col; break;    // 90° CCW → White on the right
    case 'white':
    default: f = col; r = 7 - row; break;            // a1 bottom-left
  }
  return `${FILES[f]}${RANKS[r]}` as Square;
}

const SCREEN_INDICES = [0, 1, 2, 3, 4, 5, 6, 7];

export interface SandboxBoardProps {
  board: Board;
  onSquareTap: (square: Square) => void;
  selected?: Square | null;
  /** Which perspective to render. Purely visual — see file header. */
  orientation?: BoardOrientation;
  /** Mirror mode: mark ranks 1–4 as the build zone — a red divider at the 4/5 boundary + a dim on
   *  the auto-generated ranks 5–8. */
  mirror?: boolean;
}

export function SandboxBoard({ board, onSquareTap, selected, orientation = 'white', mirror = false }: SandboxBoardProps) {
  // In the rotated (left/right) views the rank axis runs horizontally, so the Mirror build-zone
  // divider is a vertical centre line; in white/black it is horizontal.
  const rotated = orientation === 'left' || orientation === 'right';
  return (
    <div className="relative w-full aspect-square border-y border-white/10">
      <div className="grid grid-cols-8 grid-rows-8 w-full h-full select-none">
        {SCREEN_INDICES.map((row) =>
          SCREEN_INDICES.map((col) => {
            const square = squareAt(orientation, row, col);
            const file = square[0];
            const rank = square[1];
            // Square colour is a property of the SQUARE, not its screen position, so derive it from the
            // TRUE file/rank — this keeps a1 dark in every orientation.
            const fileNum = file.charCodeAt(0) - 'a'.charCodeAt(0) + 1;
            const isLight = (fileNum + Number(rank)) % 2 === 1;
            const piece = board[square];
            // Mirror mode: ranks 5–8 are the auto-generated (read-only) half — dim them so it reads as
            // "you build on ranks 1–4". Keyed on rank, so it's correct in every orientation.
            const mirrorHalf = mirror && Number(rank) >= 5;
            return (
              <button
                key={square}
                type="button"
                data-square={square}
                onClick={() => onSquareTap(square)}
                aria-label={piece ? `${square}, ${piece.type}` : square}
                className={`relative flex items-center justify-center ${isLight ? 'bg-gc-light-sq' : 'bg-gc-dark-sq'} ${
                  selected === square ? 'ring-2 ring-inset ring-gc-accent z-10' : ''
                }`}
              >
                {piece && <Piece piece={piece} animateMove={false} />}
                {mirrorHalf && <span className="pointer-events-none absolute inset-0 bg-gc-bg/40" aria-hidden="true" />}
              </button>
            );
          }),
        )}
      </div>
      {/* Mirror boundary: ranks 1–4 (yours) vs 5–8 (mirrored). The 4/5 split is ALWAYS the board's
          centre; it is a horizontal line in white/black views and a vertical line when rotated. */}
      {mirror && (
        <div
          className={
            rotated
              ? 'pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-red-500 shadow-[0_0_6px_1px_rgba(239,68,68,0.7)]'
              : 'pointer-events-none absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-red-500 shadow-[0_0_6px_1px_rgba(239,68,68,0.7)]'
          }
          aria-hidden="true"
        />
      )}
    </div>
  );
}

