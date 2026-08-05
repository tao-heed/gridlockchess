// components/board/boardOrientation.ts — Board view rotation, shared by the live board.
//
// The board can be viewed at four rotations. `angle` is a CLOCKWISE turn of the canonical
// "White-at-bottom" view (0°). Each case below is a rigid rotation (no reflection), so square
// colours and every piece relationship are preserved — pieces render upright and only the cell a
// square occupies on screen changes.
//
//   0°   — White army on the BOTTOM edge (a1 bottom-left; the classic view).
//   90°  — White army on the LEFT edge.
//   180° — White army on the TOP edge (equivalent to the old "Black perspective" flip).
//   270° — White army on the RIGHT edge.
import { FILES, RANKS, type Square } from '@/types/game';

export type BoardAngle = 0 | 90 | 180 | 270;

/** All angles in cycle order (used by the Play-menu rotation buttons). */
export const BOARD_ANGLES: readonly BoardAngle[] = [0, 90, 180, 270] as const;

/** Short label for a rotation angle (Play-menu buttons + tooltips). */
export const ANGLE_LABEL: Record<BoardAngle, string> = { 0: 'Normal', 90: '90°', 180: '180°', 270: '270°' };

/** The board square shown at screen cell (row 0 = top, col 0 = left) for a given rotation.
 *  f = file index 0..7 (a..h), r = rank index 0..7 (rank 1..8). */
export function squareAt(angle: BoardAngle, row: number, col: number): Square {
  let f: number;
  let r: number;
  switch (angle) {
    case 90: f = row; r = col; break;             // White → left edge
    case 180: f = 7 - col; r = row; break;        // White → top edge
    case 270: f = 7 - row; r = 7 - col; break;    // White → right edge
    case 0:
    default: f = col; r = 7 - row; break;         // White → bottom edge (classic)
  }
  return `${FILES[f]}${RANKS[r]}` as Square;
}
