// components/docs/reference.tsx — Live, drift-proof reference tables for the Rules page.
//
// These render game facts from the SAME constants the engine and board use, so the
// docs can never fall out of sync with the actual game:
//   • <VectorTable> is keyed by the canonical VectorType union, using the same gc-leap /
//     gc-ortho / gc-diag color tokens as the board badges.

import type { VectorType } from '@/types/game';

// ── Vector reference ────────────────────────────────────────────────────────────
interface VectorRef {
  label: string;
  glyph: string;
  symbol: string;
  movesLike: string;
  note: string;
  /** Tailwind color token shared with the board's vector badges. */
  color: string;
}

const VECTOR_REFERENCE: Record<VectorType, VectorRef> = {
  L: { label: 'Leap', glyph: '♘', symbol: 'Coral', movesLike: 'Knight', note: 'Jumps over pieces', color: 'text-gc-leap' },
  O: { label: 'Orthogonal', glyph: '♖', symbol: 'Green', movesLike: 'Rook', note: 'Slides along files & ranks', color: 'text-gc-ortho' },
  D: { label: 'Diagonal', glyph: '♗', symbol: 'Yellow', movesLike: 'Bishop', note: 'Slides corner to corner', color: 'text-gc-diag' },
};

const VECTOR_ORDER: VectorType[] = ['O', 'D', 'L'];

export function VectorTable() {
  return (
    <div className="not-prose overflow-x-auto my-6">
      <table className="w-full border-collapse text-sm">
        <thead className="border-b border-white/20 bg-white/5">
          <tr>
            <th className="px-4 py-3 text-left font-semibold text-gc-text">Vector</th>
            <th className="px-4 py-3 text-left font-semibold text-gc-text">Color</th>
            <th className="px-4 py-3 text-left font-semibold text-gc-text">Moves Like</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {VECTOR_ORDER.map((v) => {
            const ref = VECTOR_REFERENCE[v];
            return (
              <tr key={v} className="hover:bg-white/5 transition-colors">
                <td className="px-4 py-3 font-medium">
                  <span className={ref.color}>{ref.label}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={`font-medium ${ref.color}`}>
                    {ref.symbol}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-2 ${ref.color}`}>
                    <span className="text-xl leading-none" aria-hidden="true">{ref.glyph}</span>
                    <span>{ref.movesLike}</span>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Archetype reference lives in the interactive <ArchetypeGuide> (Rules page). ──
