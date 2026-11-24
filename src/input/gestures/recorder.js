import { poseFeatures, poseDistance, avg, wristCenter, palmSize, dist } from './features.js';

// Recording state machine: countdown (frames ignored) -> capture (frames kept) -> result.
// camera frames reach feed() through the recognizer while a recording is running.

export const COUNTDOWN_MS = 3000;
export const POSE_CAPTURE_MS = 3000;
export const MOTION_MAX_MS = 5000;
const SAMPLE_FRAMES = 10; // frames kept per pose sample
const MIN_VISIBLE = 0.8; // hands must be seen in 80% of frames
const STILL_LIMIT = 0.15; // average change of the hand shape allowed, in palm sizes
const DRIFT_LIMIT = 0.35; // average travel of the hands across the screen allowed, in palm sizes

let job = null; // the recording in progress, or null
let timer = 0;

/** Counting down or capturing? (Then frames go here, not to recognition.) */
export const isRecording = () => job !== null;

/**
 * Record a still pose: 3 s countdown, 3 s capture, then onDone(checkPose(frames)).
 * onUpdate gets { phase: 'countdown', secondsLeft } or { phase: 'capture', progress, frames }.
 */
export function recordPose(callbacks) {
  begin({ kind: 'pose', maxMs: POSE_CAPTURE_MS, ...callbacks });
}

/** Record a motion: 3 s countdown, then up to 5 s (or stop()). onDone({ rawFrames }). */
export function recordMotion(callbacks) {
  begin({ kind: 'motion', maxMs: MOTION_MAX_MS, ...callbacks });
}

/** Finish the capture now (motion "Stop" button / Space). Cancels during the countdown. */
export function stop() {
  if (job?.phase === 'capture') finish();
  else cancel();
}

/** Throw the recording away. */
export function cancel() {
  clearInterval(timer);
  job = null;
}

/** A camera frame: kept only during the capture phase. */
export function feed(hands, t) {
  if (!job) return;
  tick(); // frames also move the phases along (page timers can be slowed down)
  if (job?.phase === 'capture') job.frames.push({ t, hands });
}

/** Start a new recording (any old one is thrown away). */
function begin(next) {
  cancel();
  job = { ...next, phase: 'countdown', startedAt: performance.now(), frames: [] };
  timer = setInterval(tick, 50);
  tick();
}

/** Every 50 ms: move between phases and report progress. */
function tick() {
  const now = performance.now();
  if (job.phase === 'countdown') {
    const left = COUNTDOWN_MS - (now - job.startedAt);
    if (left > 0) return job.onUpdate?.({ phase: 'countdown', secondsLeft: Math.ceil(left / 1000) });
    job.phase = 'capture';
    job.captureAt = now;
  }
  const elapsed = now - job.captureAt;
  if (elapsed >= job.maxMs) return finish();
  job.onUpdate?.({ phase: 'capture', progress: elapsed / job.maxMs, frames: job.frames.length });
}

/** Capture over: hand the frames to onDone (poses get checked first). */
function finish() {
  clearInterval(timer);
  const done = job;
  job = null;
  // times in seconds from the start of the capture
  const frames = done.frames.map((f) => ({ t: (f.t - done.captureAt) / 1000, hands: f.hands }));
  done.onDone?.(done.kind === 'pose' ? checkPose(frames) : { rawFrames: frames });
}

/**
 * Quality checks for a captured pose, and the sample to save.
 * @returns {{ ok: boolean, reasons: string[], hands: number, visible: number, wobble: number, drift: number, sample: object | null }}
 */
export function checkPose(frames) {
  const reasons = [];
  const counts = frames.map((f) => f.hands.length);
  const seen = counts.filter((c) => c > 0);
  if (!seen.length) {
    return { ok: false, reasons: ['No hands were seen. Keep your hands in the camera view.'], hands: 0, visible: 0, wobble: 0, drift: 0, sample: null };
  }

  // one- or two-hand pose: whichever count was seen most (ties go to two hands)
  const twos = seen.filter((c) => c === 2).length;
  const hands = twos >= seen.length - twos ? 2 : 1;
  const good = frames.filter((f) => f.hands.length === hands);
  const visible = good.length / frames.length;
  if (visible < MIN_VISIBLE) {
    reasons.push(hands === 2 ? "Both hands weren't visible the whole time." : "Your hand wasn't visible the whole time.");
  }

  // wobble = how far each frame's hand shape is from the average shape
  const feats = good.map((f) => poseFeatures(f.hands));
  const mean = feats[0].map((_, i) => avg(feats.map((f) => f[i])));
  const wobble = avg(feats.map((f) => poseDistance(f, mean)));
  // pose features ignore position, so also check the hands didn't slide across the screen
  const centers = good.map((f) => wristCenter(f.hands));
  const middle = { x: avg(centers.map((c) => c.x)), y: avg(centers.map((c) => c.y)) };
  const drift = avg(centers.map((c) => dist(c, middle))) / avg(good.map((f) => palmSize(f.hands)));
  if (wobble > STILL_LIMIT || drift > DRIFT_LIMIT) reasons.push('Your hands moved. Hold still and try again.');

  // keep ~10 evenly spaced frames
  const step = feats.length / Math.min(SAMPLE_FRAMES, feats.length);
  const picked = Array.from({ length: Math.min(SAMPLE_FRAMES, feats.length) }, (_, i) => feats[Math.floor(i * step)]);
  const sample = {
    hands,
    frames: picked.map((f) => f.map((v) => Math.round(v * 1e4) / 1e4)),
    recordedAt: new Date().toISOString(),
  };
  return { ok: reasons.length === 0, reasons, hands, visible, wobble, drift, sample };
}
