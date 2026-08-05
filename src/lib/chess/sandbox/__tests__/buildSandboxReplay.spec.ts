// lib/chess/sandbox/__tests__/buildSandboxReplay.spec.ts
import { describe, it, expect } from 'vitest';
import { buildSandboxReplay } from '../buildSandboxReplay';
import { serializePosition, positionToBoard, gridlockReplaySchema, REPLAY_VERSION } from '../../format';
import type { Board, PieceColor, King, Pawn, Anomaly, OmniAnomaly, VectorPool } from '@/types/game';

let seq = 0;
const uid = () => `p${seq++}`;
const king = (color: PieceColor): King => ({ id: uid(), color, type: 'king', icon: color === 'white' ? '♔' : '♚' });
const pawn = (color: PieceColor): Pawn => ({ id: uid(), color, type: 'pawn', icon: color === 'white' ? '♙' : '♟', hasMoved: false });
const anomaly = (color: PieceColor, archetype: Anomaly['archetype'], vectors: VectorPool): Anomaly =>
  ({ id: uid(), color, type: 'anomaly', archetype, icon: '🚗', vectors, isGridlocked: false });
const omni = (color: PieceColor, shared = 8): OmniAnomaly =>
  ({ id: uid(), color, type: 'anomaly', archetype: 'omni', icon: '🤖', vectors: { shared }, isGridlocked: false });

const sampleBoard = (): Board => ({
  e1: king('white'),
  e8: king('black'),
  a2: pawn('white'),
  d4: anomaly('white', 'highLeap', { L: 8, O: 1, D: 1 }),
  d5: anomaly('black', 'absOrtho', { L: 0, O: 10, D: 0 }),
  f6: omni('black', 8),
});

describe('buildSandboxReplay', () => {
  it('produces a schema-valid, zero-move replay', () => {
    const replay = buildSandboxReplay(sampleBoard(), 'white');
    expect(replay.v).toBe(REPLAY_VERSION);
    expect(replay.moves).toEqual([]);
    expect(() => gridlockReplaySchema.parse(replay)).not.toThrow();
  });

  it('carries the side-to-move into the start position', () => {
    expect(buildSandboxReplay(sampleBoard(), 'black').start.turn).toBe('black');
  });

  it('round-trips the board losslessly (position → board → position is identity)', () => {
    const start = buildSandboxReplay(sampleBoard(), 'white').start;
    // positionToBoard mints fresh ids/icons, so compare via re-serialization (id/icon-independent).
    const reserialized = serializePosition(positionToBoard(start), 'white', null, 0, 1);
    expect(reserialized).toEqual(start);
  });
});
