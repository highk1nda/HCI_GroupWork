import { FEATURES } from '../../config.js';
import { dispatch } from '../../intents/dispatcher.js';
import * as recorder from './recorder.js';
import * as store from './store.js';
import { poseFeatures, handSpeed, handSpread, wristCenter } from './features.js';
import { distancesPerShape, pickBest, HoldTrigger } from './poseMatcher.js';
import { MotionWatcher } from './motionMatcher.js';

// Every camera frame comes here. While recording, frames go to the recorder.
// Otherwise the hands are either still or moving:
//   still  -> compare with recorded poses; one held long enough -> dispatch add
//   moving -> compare the last ~2 s with recorded motions (DTW) -> dispatch zoom / orbit
// With "continuous" on, a recognized zoom / orbit keeps following the hands until they
// stop or drop. Only intents are created; the scene and camera are never touched here.

const STILL_BELOW = 0.6; // palm sizes per second: below this the hands count as still
const MOVING_ABOVE = 1.2; // above this they count as moving (in between: keep the last state)
const ZOOM_STEP = 1.25; // discrete zoom, like the + button
const ORBIT_STEP = 30; // discrete orbit, degrees
const ORBIT_PER_SCREEN = 240; // continuous orbit: degrees for a hand sweep across the whole view
const FOLLOW_STILL_MS = 700; // continuous control ends after the hands rest this long
const MOTION_EVERY = 3; // run DTW every 3rd moving frame
const DROPOUT_MS = 300; // hands missing for less than this = a tracking glitch, not "hands gone"

let prev = null; // last frame { hands, t }
let speed = 0; // smoothed hand speed
let still = true;
let stillSince = 0;
let missingSince = null; // when the hands disappeared (null = they're visible)
let suppressed = false; // Hand settings open: show matches, never create anything
let frameNo = 0;
let lastMotion = null; // latest motion match (kept for the test bars)
let follow = null; // continuous control: { action, hands, spread, x }
const poseTrigger = new HoldTrigger();
const motionTrigger = new HoldTrigger();
const motions = new MotionWatcher();
const listeners = [];

/** Pause / resume firing (the Hand settings dialog pauses it while open). */
export function setSuppressed(value) {
  suppressed = value;
  poseTrigger.reset();
  motionTrigger.reset();
  follow = null;
}

/** Subscribe to what the recognizer sees each frame (test mode, hold ring, follow badge). */
export function onRecognizerUpdate(fn) {
  listeners.push(fn);
  return () => listeners.splice(listeners.indexOf(fn), 1);
}

/** @param {import('./features.js').Hand[]} hands @param {number} t ms */
export function onFrame(hands, t) {
  if (recorder.isRecording()) return recorder.feed(hands, t);
  if (!FEATURES.gestures) return;

  // MediaPipe sometimes loses the hands for a frame or two: skip short gaps
  if (!hands.length) {
    missingSince ??= t;
    if (t - missingSince < DROPOUT_MS) return;
  } else {
    missingSince = null;
  }

  // still or moving? (smoothed, with a gap between the two limits so it doesn't flicker)
  const sameCount = prev?.hands.length === hands.length;
  const raw = prev && sameCount ? handSpeed(prev.hands, hands, Math.max(10, t - prev.t)) : 0;
  speed = hands.length && sameCount ? speed * 0.6 + raw * 0.4 : 0; // mostly old value + a bit of new = smooth
  const wasStill = still;
  if (speed < STILL_BELOW) still = true;
  else if (speed > MOVING_ABOVE) still = false;
  if (still && !wasStill) stillSince = t;
  prev = { hands, t };

  const settings = store.settings();
  const live = settings.enabled && !suppressed && store.hasAnyGesture();
  const update = { hands, speed, still, live, pose: null, motion: null, follow: null, fired: null };

  if (hands.length) motions.push(hands, t);
  else motions.clear();

  // decide what to do this frame: keep following, check poses, check motions, or nothing
  if (follow) {
    followHands(hands, t, settings, update);
  } else if (hands.length && still) {
    matchPose(hands, t, settings, live, update);
    motionTrigger.update(null, t, settings);
  } else if (hands.length) {
    poseTrigger.update(null, t, settings);
    matchMotion(t, settings, live, update);
  } else {
    poseTrigger.update(null, t, settings);
    motionTrigger.update(null, t, settings);
  }
  update.motion ??= lastMotion && t - lastMotion.t < 1000 ? lastMotion : null;

  listeners.forEach((fn) => fn(update));
}

/** Still hands: nearest recorded pose; held for holdMs -> add that shape. */
function matchPose(hands, t, settings, live, update) {
  const distances = distancesPerShape(poseFeatures(hands), hands.length, store.allPoses());
  const best = pickBest(distances, settings.threshold);
  const hold = poseTrigger.update(best.key, t, settings);
  update.pose = { distances, ...best, progress: hold.progress };
  if (hold.fired && live) {
    update.fired = hold.fired;
    dispatch({ type: 'add', shape: hold.fired }, 'gesture');
  }
}

/** Moving hands: DTW against recorded motions; a match -> zoom / orbit step (and maybe follow). */
function matchMotion(t, settings, live, update) {
  const templates = store.motionTemplates();
  if (!Object.keys(templates).length || frameNo++ % MOTION_EVERY) return; // DTW is slow: not every frame
  const m = motions.match(templates, settings.threshold);
  lastMotion = { ...m, t };
  update.motion = lastMotion;
  const hit = motionTrigger.update(m.key, t, { holdMs: 0, cooldownMs: settings.cooldownMs });
  if (!hit.fired || !live) return;

  update.fired = hit.fired;
  const action = hit.fired;
  if (action === 'zoomIn') dispatch({ type: 'zoom', factor: ZOOM_STEP }, 'gesture');
  if (action === 'zoomOut') dispatch({ type: 'zoom', factor: 1 / ZOOM_STEP }, 'gesture');
  // hand moved left (dir -1) turns the view like dragging the mouse left
  if (action === 'orbit') dispatch({ type: 'orbit', degrees: -(m.dirs.orbit || 1) * ORBIT_STEP }, 'gesture');
  motions.clear();

  if (settings.continuous) {
    const hands = prev.hands;
    follow = { action, hands: hands.length, spread: handSpread(hands), x: wristCenter(hands).x };
  }
}

/** Continuous control: the camera follows the hands until they rest or drop. */
function followHands(hands, t, settings, update) {
  const end = () => {
    follow = null;
    // pause after the gesture, like after a discrete one
    poseTrigger.lastAt = motionTrigger.lastAt = t;
    motions.clear();
  };
  if (hands.length !== follow.hands || (still && t - stillSince > FOLLOW_STILL_MS)) return end();
  update.follow = follow.action;

  if (follow.action === 'orbit') {
    // turn by how far the hand moved since the last frame (x is 0-1 across the view)
    const x = wristCenter(hands).x;
    const degrees = -(x - follow.x) * ORBIT_PER_SCREEN;
    follow.x = x;
    if (Math.abs(degrees) > 0.05) dispatch({ type: 'orbit', degrees }, 'gesture');
  } else {
    // zoom by the change in hand distance: 10% further apart = 10% closer
    const spread = handSpread(hands);
    const factor = follow.spread > 0 ? spread / follow.spread : 1;
    follow.spread = spread;
    if (Math.abs(factor - 1) > 0.002) dispatch({ type: 'zoom', factor }, 'gesture');
  }
}
