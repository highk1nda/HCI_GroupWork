import { sortHands, wristCenter, palmSize, poseFeatures, handSpeed, handSpread, avg } from './features.js';
import { pickBest } from './poseMatcher.js';

// Motions (zoom in / zoom out / orbit): a recorded stretch of frames, trimmed to just the
// gesture, resampled to TEMPLATE_LEN frames, compared with live frames using DTW
// (dynamic time warping), which tolerates the gesture being done faster or slower.

export const TEMPLATE_LEN = 32;
const POSE_WEIGHT = 0.3; // how much the hand shape counts vs. the movement itself
export const MOTION_SCALE = 2; // motion threshold = pose threshold x this (DTW costs are larger)
const BUFFER_MS = 2500; // live frames kept for matching
const MIN_FRAMES = 6;

// ---------- per-frame features ----------

/**
 * One frame of a motion: [center x, center y, spread, ...pose], all in palm sizes.
 * Center is relative to the first frame of the sequence (`origin`), so where the
 * gesture starts doesn't matter, but how far it travels does.
 */
export function motionFrame(hands, origin, size) {
  const sorted = sortHands(hands);
  const c = wristCenter(sorted);
  return [(c.x - origin.x) / size, (c.y - origin.y) / size, handSpread(sorted), ...poseFeatures(sorted)];
}

/** Distance between two motion frames: movement in full, hand shape at a lower weight. */
export function frameDistance(a, b) {
  let move = 0;
  for (let i = 0; i < 3; i++) move += (a[i] - b[i]) ** 2;
  let pose = 0;
  for (let i = 3; i < a.length; i++) pose += (a[i] - b[i]) ** 2;
  const n = Math.max(1, (a.length - 3) / 2); // points
  return Math.sqrt(move + POSE_WEIGHT * (pose / n));
}

/** DTW cost between two sequences, divided by their lengths (0 = identical). */
export function dtw(a, b, dist = frameDistance) {
  const n = a.length;
  const m = b.length;
  if (!n || !m) return Infinity;
  // Classic DTW table, kept one row at a time to save memory.
  // cell [i][j] = cheapest way to line up the first i frames of a with the first j of b.
  let prevRow = new Array(m + 1).fill(Infinity);
  prevRow[0] = 0;
  for (let i = 1; i <= n; i++) {
    const row = new Array(m + 1).fill(Infinity);
    for (let j = 1; j <= m; j++) {
      // cost of this pair + best of: a waits (up), b waits (left), both step (diagonal)
      row[j] = dist(a[i - 1], b[j - 1]) + Math.min(prevRow[j], row[j - 1], prevRow[j - 1]);
    }
    prevRow = row;
  }
  return (2 * prevRow[m]) / (n + m); // divide by length so long and short sequences compare fairly
}

/** Resample a sequence of { t, v: number[] } to `len` evenly spaced points in time. */
export function resample(items, len = TEMPLATE_LEN) {
  if (items.length === 1) return Array.from({ length: len }, () => items[0].v.slice());
  const t0 = items[0].t;
  const t1 = items.at(-1).t;
  const out = [];
  let k = 0;
  for (let i = 0; i < len; i++) {
    const t = t0 + ((t1 - t0) * i) / (len - 1); // evenly spaced target time
    while (k < items.length - 2 && items[k + 1].t < t) k++; // find the two real frames around it
    const a = items[k];
    const b = items[k + 1];
    // blend between them by how far t is from a to b (0 = a, 1 = b)
    const f = b.t === a.t ? 0 : Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
    out.push(a.v.map((v, d) => v + (b.v[d] - v) * f));
  }
  return out;
}

// middle value of a list (ignores single extreme values, unlike an average)
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** The hand count used by most frames (ties go to two hands); 0 if no hands. */
export function usualHandCount(frames) {
  const seen = frames.map((f) => f.hands.length).filter((c) => c > 0);
  if (!seen.length) return 0;
  const twos = seen.filter((c) => c === 2).length;
  return twos >= seen.length - twos ? 2 : 1;
}

/**
 * Motion features for a stretch of frames, resampled to TEMPLATE_LEN.
 * Returns null when there are too few usable frames.
 */
export function sequenceFeatures(frames, hands) {
  const good = frames.filter((f) => f.hands.length === hands);
  // need enough frames, and the right hand count in at least 80% of them
  if (good.length < MIN_FRAMES || good.length < frames.length * 0.8) return null;
  const origin = wristCenter(good[0].hands);
  const size = avg(good.map((f) => palmSize(f.hands)));
  return resample(good.map((f) => ({ t: f.t, v: motionFrame(f.hands, origin, size) })));
}

/** How the main channels changed over the sequence: horizontal travel and spread. */
function deltas(seq) {
  const a = seq[0];
  const b = seq.at(-1);
  return { x: b[0] - a[0], spread: b[2] - a[2] };
}

// ---------- recording: trim + template ----------

/** Per-frame curves for the trim graph: speed, and spread (zoom) or palm x (orbit). */
export function motionSeries(rawFrames, action) {
  const t = rawFrames.map((f) => f.t);
  const speed = rawFrames.map((f, i) =>
    i ? handSpeed(rawFrames[i - 1].hands, f.hands, Math.max(10, (f.t - rawFrames[i - 1].t) * 1000)) : 0,
  );
  // median of 5: one glitchy frame doesn't make a spike
  const smooth = speed.map((_, i) => median(speed.slice(Math.max(0, i - 2), i + 3)));
  const aux = rawFrames.map((f) => {
    if (!f.hands.length) return null;
    return action === 'orbit' ? wristCenter(f.hands).x : f.hands.length === 2 ? handSpread(f.hands) : null;
  });
  return { t, speed: smooth, aux, auxLabel: action === 'orbit' ? 'palm position' : 'distance between hands' };
}

/**
 * Auto-trim: from where the hands start moving to where they stop, plus ~0.1 s.
 * @returns {[number, number]} start and end in seconds
 */
export function autoTrim(rawFrames, action = 'zoomIn') {
  if (rawFrames.length < 2) return [0, rawFrames.at(-1)?.t ?? 0];
  const { t, speed } = motionSeries(rawFrames, action);
  // "moving" = faster than 30% of the typical top speed (90th percentile, not the single peak)
  const sorted = [...speed].sort((a, b) => a - b);
  const limit = Math.max(0.8, 0.3 * sorted[Math.floor(sorted.length * 0.9)]);
  const first = speed.findIndex((s) => s > limit); // first moving frame
  const last = speed.length - 1 - [...speed].reverse().findIndex((s) => s > limit); // last moving frame
  if (first < 0) return [t[0], t.at(-1)];
  return [Math.max(t[0], t[first] - 0.1), Math.min(t.at(-1), t[last] + 0.1)];
}

/**
 * Template for a trimmed recording: resampled features, plus how it moves.
 * A mirrored copy is kept too (sideways travel reversed, same hand shape), so one
 * orbit recording covers both directions.
 */
export function buildTemplate(rawFrames, trim) {
  const part = rawFrames.filter((f) => f.t >= trim[0] && f.t <= trim[1]);
  const hands = usualHandCount(part);
  if (!hands) return null;
  const frames = sequenceFeatures(part, hands);
  if (!frames) return null;
  const mirrored = frames.map((f) => [-f[0], ...f.slice(1)]); // flip only the sideways travel (x)
  const round = (seq) => seq.map((f) => f.map((v) => Math.round(v * 1e4) / 1e4));
  return { hands, duration: trim[1] - trim[0], delta: deltas(frames), frames: round(frames), mirrored: round(mirrored) };
}

// ---------- live matching ----------

/** Does the live movement go the same way as the template (and far enough)? */
function sameDirection(live, delta) {
  // look at whichever the template mostly does: hands apart/together (zoom) or sideways (orbit)
  // then require the same sign and at least 40% of the template's distance
  const key = Math.abs(delta.spread) > Math.abs(delta.x) ? 'spread' : 'x';
  return Math.sign(live[key]) === Math.sign(delta[key]) && Math.abs(live[key]) >= 0.4 * Math.abs(delta[key]);
}

/** Keeps the last ~2.5 s of frames and compares them with the motion templates. */
export class MotionWatcher {
  constructor() {
    this.frames = [];
  }

  /** Add a live frame and drop frames older than the buffer. */
  push(hands, t) {
    this.frames.push({ t: t / 1000, hands });
    while (this.frames.length && t / 1000 - this.frames[0].t > BUFFER_MS / 1000) this.frames.shift();
  }

  /** Forget all frames (hands gone, or a gesture just fired). */
  clear() {
    this.frames = [];
  }

  /**
   * Best DTW distance per motion over a few window lengths ending now.
   * @returns {{ distances: Record<string, number>, dirs: Record<string, number>, key: string|null, nearest: string|null, distance: number }}
   */
  match(templates, threshold) {
    const distances = {};
    const dirs = {}; // orbit: -1 = hand moved left, +1 = right
    const now = this.frames.at(-1)?.t ?? 0;
    for (const [action, tpl] of Object.entries(templates)) {
      distances[action] = Infinity;
      // try the last 0.7x, 1x and 1.4x of the recorded length, since people go faster or slower
      for (const k of [0.7, 1, 1.4]) {
        const win = Math.min(BUFFER_MS / 1000, Math.max(0.3, tpl.duration * k));
        const seq = sequenceFeatures(this.frames.filter((f) => f.t >= now - win), tpl.hands);
        if (!seq) continue;
        const live = deltas(seq);
        // the recording itself, plus (for orbit) its mirror image for the other direction
        const variants = [{ frames: tpl.frames, delta: tpl.delta, dir: Math.sign(tpl.delta.x) }];
        if (action === 'orbit' && tpl.mirrored) {
          variants.push({ frames: tpl.mirrored, delta: { x: -tpl.delta.x, spread: tpl.delta.spread }, dir: -Math.sign(tpl.delta.x) });
        }
        for (const v of variants) {
          if (!sameDirection(live, v.delta)) continue; // cheap check first, skip the slow DTW
          const d = dtw(seq, v.frames);
          if (d < distances[action]) {
            distances[action] = d;
            dirs[action] = v.dir;
          }
        }
      }
    }
    return { distances, dirs, ...pickBest(distances, threshold * MOTION_SCALE) };
  }
}
