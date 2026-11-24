import { PALETTE } from '../types.js';

// "Reading the workspace": the model can't see the 3D view, so before each request
// the scene becomes a few short lines of text. That text is all the model knows.
// Pure function (pass in objects.all() and selection.get()), so it's unit-tested.

export const MAX_LISTED = 40; // keeps the prompt small for a 4k context

/** Palette name for a hex color; anything else is 'custom'. Words work better than hex for the model. */
export function colorWord(hex) {
  return PALETTE.find((c) => c.hex === String(hex).toLowerCase())?.name ?? 'custom';
}

const round1 = (n) => +n.toFixed(1); // also turns -0.0 into 0
const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * @param {import('../types.js').SceneObject[]} list
 * @param {string | null} selectedId
 * @returns {string} e.g.
 *   Scene: 2 objects. Selected: heart-1.
 *   - cube-1: cube, red, at (0, 0.5, 0), size 1
 *   - heart-1: heart, purple, at (-1.5, 0.5, 0), size 1.2
 *   Counts: cube 1, heart 1.
 */
export function describeScene(list, selectedId) {
  const counts = {}; // { cube: 2, heart: 1 }
  list.forEach((o) => (counts[o.shape] = (counts[o.shape] ?? 0) + 1));
  // one line per object; "size" is the average of the x/y/z scale
  const lines = list
    .slice(0, MAX_LISTED)
    .map(
      (o) =>
        `- ${o.id}: ${o.shape}, ${colorWord(o.color)}, at (${o.position.map(round1).join(', ')}), size ${round1(avg(o.scale))}`,
    );
  if (list.length > MAX_LISTED) lines.push(`...and ${list.length - MAX_LISTED} more`);
  const n = list.length;
  return [
    `Scene: ${n} object${n === 1 ? '' : 's'}. Selected: ${selectedId ?? 'none'}.`,
    ...lines,
    `Counts: ${Object.entries(counts).map(([shape, k]) => `${shape} ${k}`).join(', ') || 'none'}.`,
  ].join('\n');
}
