// Hand frames -> numbers that can be compared. Pure functions: no DOM, no Three.js.
//
// A hand here is { label: 'Left' | 'Right', points: [{ x, y, z } x 21] } in "user space":
// 0-1 coordinates as the user sees them in the mirrored preview, and Left = the user's own
// left hand (camera.js converts MediaPipe's output into this form).

/** @typedef {{ x: number, y: number, z?: number }} Point */
/** @typedef {{ label: 'Left' | 'Right', points: Point[] }} Hand */

export const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length; // average of a list
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y); // 2D distance between two points

/** Left hand first, then right. Two hands with the same label: leftmost wrist first. */
export function sortHands(hands) {
  return [...hands].sort((a, b) =>
    a.label === b.label ? a.points[0].x - b.points[0].x : a.label === 'Left' ? -1 : 1,
  );
}

/** Average palm size (wrist -> base of the middle finger, points 0 -> 9). */
export function palmSize(hands) {
  return avg(hands.map((h) => dist(h.points[0], h.points[9]))) || 1;
}

/** Midpoint between the wrists (or the wrist, for one hand). */
export function wristCenter(hands) {
  return { x: avg(hands.map((h) => h.points[0].x)), y: avg(hands.map((h) => h.points[0].y)) };
}

/**
 * Pose features: every point's x, y relative to the wrist center, divided by the palm size.
 * Same pose = same numbers, wherever the hands are and however far from the camera.
 * 42 numbers for one hand, 84 for two. z is left out (MediaPipe's z is noisy).
 * @param {Hand[]} hands
 */
export function poseFeatures(hands) {
  const sorted = sortHands(hands);
  const c = wristCenter(sorted);
  const size = palmSize(sorted);
  return sorted.flatMap((h) => h.points.flatMap((p) => [(p.x - c.x) / size, (p.y - c.y) / size]));
}

/** RMS distance per point between two pose feature vectors, in palm sizes. Different hand counts = Infinity. */
export function poseDistance(a, b) {
  if (a.length !== b.length || !a.length) return Infinity;
  let sum = 0;
  // numbers come in (x, y) pairs: add up the squared distance of each point
  for (let i = 0; i < a.length; i += 2) {
    const dx = a[i] - b[i];
    const dy = a[i + 1] - b[i + 1];
    sum += dx * dx + dy * dy;
  }
  return Math.sqrt(sum / (a.length / 2));
}

/** How fast the hands move, in palm sizes per second. 0 when the hand count changed. */
export function handSpeed(prev, cur, dtMs) {
  if (!prev?.length || prev.length !== cur.length || dtMs <= 0) return 0;
  const a = sortHands(prev);
  const b = sortHands(cur);
  let total = 0;
  let n = 0;
  a.forEach((h, i) =>
    h.points.forEach((p, j) => {
      total += dist(p, b[i].points[j]);
      n++;
    }),
  );
  // average point movement, in palm sizes, per second
  return total / n / palmSize(b) / (dtMs / 1000);
}

/** Distance between the two wrists in palm sizes (0 for one hand). Grows when hands move apart. */
export function handSpread(hands) {
  if (hands.length < 2) return 0;
  const [a, b] = sortHands(hands);
  return dist(a.points[0], b.points[0]) / palmSize(hands);
}
