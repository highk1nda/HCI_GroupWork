import { SHAPES } from '../../types.js';
import { poseDistance } from './features.js';

// Which recorded pose does the current frame look like? Nearest sample (k-NN, k = 1),
// a threshold, and a margin over the second-best so near-ties don't fire.

export const MARGIN = 0.8; // the best must be at least 20% closer than the second best

/**
 * Distance from the current features to the closest sample of each shape.
 * Only samples with the same number of hands count; shapes without one get Infinity.
 * @returns {Record<string, number>}
 */
export function distancesPerShape(features, handCount, poses) {
  const out = {};
  for (const shape of SHAPES) {
    let best = Infinity;
    for (const sample of poses[shape] ?? []) {
      if (sample.hands !== handCount) continue;
      for (const frame of sample.frames) best = Math.min(best, poseDistance(features, frame));
    }
    out[shape] = best;
  }
  return out;
}

/**
 * Pick the winner from { key: distance }: under the threshold and clearly ahead of the runner-up.
 * @returns {{ key: string | null, nearest: string | null, distance: number }}
 */
export function pickBest(distances, threshold, margin = MARGIN) {
  const ranked = Object.entries(distances)
    .filter(([, d]) => Number.isFinite(d))
    .sort((a, b) => a[1] - b[1]);
  const [best, second] = ranked;
  if (!best) return { key: null, nearest: null, distance: Infinity };
  // close enough AND clearly better than the next one, otherwise it's a guess
  const ok = best[1] < threshold && (!second || best[1] < second[1] * margin);
  return { key: ok ? best[0] : null, nearest: best[0], distance: best[1] };
}

/** Closest other shape to a new sample (for the "Looks like Cube, save anyway?" warning). */
export function nearestOtherShape(sample, poses, exceptShape) {
  let found = { shape: null, distance: Infinity };
  for (const frame of sample.frames) {
    const d = distancesPerShape(frame, sample.hands, { ...poses, [exceptShape]: [] }); // hide its own shape
    for (const [shape, dist] of Object.entries(d)) if (dist < found.distance) found = { shape, distance: dist };
  }
  return found;
}

/**
 * Hold + cooldown: a candidate fires only after being seen continuously for holdMs,
 * then nothing fires for cooldownMs, and the same one can't fire again until the
 * hands leave that pose (or change to another).
 */
export class HoldTrigger {
  constructor() {
    this.current = null; // what is being held right now
    this.since = 0; // when that hold started
    this.lastKey = null; // what fired last
    this.lastAt = -Infinity; // when it fired
    this.armed = true; // false = same pose must be let go before it can fire again
  }

  /** @returns {{ fired: string | null, progress: number }} progress 0-1 of the hold */
  update(candidate, now, { holdMs, cooldownMs }) {
    if (candidate !== this.lastKey) this.armed = true; // pose left or changed: may fire again
    if (candidate !== this.current) {
      this.current = candidate;
      this.since = now;
    }
    const blocked = !candidate || now - this.lastAt < cooldownMs || (candidate === this.lastKey && !this.armed);
    if (blocked) {
      this.since = now; // the hold only starts counting once nothing blocks it
      return { fired: null, progress: 0 };
    }
    const progress = holdMs > 0 ? Math.min(1, (now - this.since) / holdMs) : 1;
    if (progress < 1) return { fired: null, progress };
    this.lastKey = candidate;
    this.lastAt = now;
    this.armed = false;
    this.since = now;
    return { fired: candidate, progress: 1 };
  }

  /** Start fresh (used when recognition is paused / resumed). */
  reset() {
    this.current = null;
    this.armed = true;
  }
}
