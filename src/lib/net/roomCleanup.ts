// lib/net/roomCleanup.ts — Delete a finished room from Firebase RTDB.
//
// Called when a game ends (resign, timeout, checkmate) so orphaned rooms don't
// accumulate. The host is authoritative for cleanup; guests skip this call.
// Failure is silent — orphaned rooms expire naturally and cost nothing at
// Gridlock's scale (~2 KB per room).
import { ref, remove } from 'firebase/database';
import { db } from './firebase';

export function cleanupRoom(roomCode: string): void {
  remove(ref(db, `rooms/${roomCode}`)).catch(() => {});
}
