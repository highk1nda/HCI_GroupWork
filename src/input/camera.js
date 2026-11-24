import { FEATURES } from '../config.js';
import { toast } from '../ui/statusBar.js';
import { openSourcePicker } from '../ui/cameraPicker.js';
import { drawHands } from '../ui/handDraw.js';

// Cam mode: pick a video source, show it as a mirrored corner preview, and run
// MediaPipe HandLandmarker on it. Each frame's hands go to onHandsFrame() listeners
// (the gesture recognizer and the Hand settings dialog). This module emits no intents.

const STORAGE_KEY = 'demo3d.camera';
const MODEL_PATH = 'models/hand_landmarker.task';
const WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

/** @type {MediaStream | null} */
let stream = null;
let active = false;
let session = 0; // bumped on every start/stop, so stale async work can tell it's outdated
let frameId = 0;
/** @type {Promise<any> | null} */
let landmarkerPromise = null;

const endListeners = [];
const stopListeners = [];
const frameListeners = [];

/** Is Cam mode running? */
export const isActive = () => active;

/** The running MediaStream (for a second, bigger view), or null. */
export const getStream = () => stream;

/** Subscribe to the camera stopping by itself (error, unplugged). */
export function onCameraEnd(fn) {
  endListeners.push(fn);
}

/** Subscribe to the camera stopping for any reason (also leaving Cam mode). */
export function onCameraStop(fn) {
  stopListeners.push(fn);
}

/** Subscribe to hand results: fn(hands, timeMs) on every new video frame. Returns unsubscribe. */
export function onHandsFrame(fn) {
  frameListeners.push(fn);
  return () => frameListeners.splice(frameListeners.indexOf(fn), 1);
}

/**
 * Open the source picker. Resolves true once a camera is running, false if the
 * user cancelled or the camera failed (the caller then stays on Mouse + keyboard).
 */
export function start() {
  if (!FEATURES.camera) {
    toast('Webcam mode coming soon');
    return Promise.resolve(false);
  }
  // the promise only resolves once (settle), whichever happens first: camera started or dialog closed
  return new Promise((resolve) => {
    let settled = false;
    let pending = null; // a camera that is still starting
    const settle = (ok) => {
      if (!settled) {
        settled = true;
        resolve(ok);
      }
    };
    openSourcePicker({
      saved: loadChoice(),
      active,
      listCameras,
      currentDeviceId,
      onChoose: async (choice) => {
        pending = useSource(choice);
        const ok = await pending;
        pending = null;
        if (ok) settle(true);
        return ok;
      },
      // closed while a camera is still starting: wait for it, so the mode matches what really happened
      onClose: () => (pending ? pending.then((ok) => settle(ok || active)) : settle(active)),
    });
  });
}

/** Stop everything: camera tracks, preview, detection loop. */
export function stop() {
  session++;
  active = false;
  cancelAnimationFrame(frameId);
  stopStream();
  const { box, video, ctx, canvas } = previewParts();
  video.srcObject = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  box.hidden = true;
  document.getElementById('workspace').classList.remove('cam-on');
  stopListeners.forEach((fn) => fn());
}

/**
 * The ONE place that knows where video comes from. Returns a MediaStream.
 * A VDO.Ninja source gets added here later; nothing else needs to change.
 * @param {{kind: 'device', deviceId?: string, exact?: boolean} | {kind: 'vdoNinja', url: string}} choice
 */
export async function getVideoSource(choice) {
  if (choice.kind === 'device') {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw Object.assign(new Error('Camera needs a secure page (localhost or https)'), { name: 'InsecureContext' });
    }
    const video = { width: { ideal: 640 }, height: { ideal: 480 } };
    if (choice.deviceId) video.deviceId = choice.exact ? { exact: choice.deviceId } : { ideal: choice.deviceId };
    return navigator.mediaDevices.getUserMedia({ audio: false, video });
  }
  throw new Error(`Video source "${choice.kind}" isn't available yet`);
}

/** Every camera the browser can see (labels only show after permission). */
export async function listCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'videoinput').map((d) => ({ deviceId: d.deviceId, label: d.label }));
}

/** deviceId of the camera currently streaming, or '' */
export function currentDeviceId() {
  return stream?.getVideoTracks()[0]?.getSettings().deviceId ?? '';
}

/** Start (or restart) the stream from a source, then the preview and detection. */
async function useSource(choice) {
  // remember which "start" this is; after every await, a different session number
  // means the user already started/stopped again, so this old start gives up
  const token = ++session;
  cancelAnimationFrame(frameId);
  stopStream();

  let next;
  try {
    next = await getVideoSource(choice);
  } catch (err) {
    if (token !== session) return false;
    console.warn('Camera failed', err);
    toast(reasonFor(err));
    stop();
    endListeners.forEach((fn) => fn());
    return false;
  }
  if (token !== session) {
    next.getTracks().forEach((t) => t.stop()); // a newer start/stop happened while we waited
    return false;
  }

  stream = next;
  const track = stream.getVideoTracks()[0];
  saveChoice({ kind: 'device', deviceId: track.getSettings().deviceId });
  track.addEventListener('ended', () => {
    if (token !== session) return;
    toast('Camera disconnected');
    stop();
    endListeners.forEach((fn) => fn());
  });

  try {
    await showPreview(stream);
  } catch (err) {
    if (token !== session) return false;
    toast(reasonFor(err));
    stop();
    endListeners.forEach((fn) => fn());
    return false;
  }
  if (token !== session) return false;
  active = true;
  startDetection(token);
  return true;
}

/** Stop every track of the current stream (turns the camera light off). */
function stopStream() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

/** A short, human reason for a getUserMedia error. */
function reasonFor(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera permission was denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera found';
    case 'NotReadableError':
      return 'Camera is busy in another app';
    case 'InsecureContext':
    case 'NoVideo':
      return err.message;
    default:
      return `Camera failed: ${err?.message || err}`;
  }
}

// ---------- preview ----------

/** The corner preview elements: box, video, drawing canvas and status text. */
function previewParts() {
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('cam-overlay'));
  return {
    box: document.getElementById('cam-preview'),
    video: /** @type {HTMLVideoElement} */ (document.getElementById('cam-video')),
    canvas,
    ctx: canvas.getContext('2d'),
    status: document.getElementById('cam-status'),
  };
}

/** Show the stream in the corner and size the overlay canvas to the video. */
async function showPreview(mediaStream) {
  const { box, video, canvas } = previewParts();
  video.srcObject = mediaStream;
  box.hidden = false;
  document.getElementById('workspace').classList.add('cam-on');
  await video.play().catch(() => {});
  if (!video.videoWidth) {
    // no size yet: wait for the first frame info, give up after 8 s
    const gotVideo = await new Promise((r) => {
      video.addEventListener('loadedmetadata', () => r(true), { once: true });
      setTimeout(() => r(false), 8000);
    });
    if (!gotVideo) throw Object.assign(new Error("The camera didn't send any video"), { name: 'NoVideo' });
  }
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
}

// ---------- hand tracking ----------

/** Load HandLandmarker once (GPU first, CPU if the GPU path fails). */
function loadLandmarker() {
  landmarkerPromise ??= (async () => {
    const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
    const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL_PATH, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
    });
    try {
      return await HandLandmarker.createFromOptions(vision, options('GPU'));
    } catch {
      return await HandLandmarker.createFromOptions(vision, options('CPU'));
    }
  })().catch((err) => {
    landmarkerPromise = null; // allow a retry next time
    throw err;
  });
  return landmarkerPromise;
}

/** Run detection whenever the video shows a new frame, and draw the result. */
async function startDetection(token) {
  const { video, ctx, canvas, status } = previewParts();
  status.textContent = 'Loading hand tracking…';

  let landmarker;
  try {
    landmarker = await loadLandmarker();
  } catch (err) {
    console.warn('Hand tracking failed to load', err);
    if (token === session) {
      status.textContent = 'Hand tracking unavailable';
      toast('Hand tracking failed to load');
    }
    return;
  }
  if (token !== session) return;

  let lastTime = -1;
  const frame = () => {
    if (token !== session) return;
    // only detect on a new video frame, not on every screen refresh
    if (video.readyState >= 2 && video.currentTime !== lastTime) {
      lastTime = video.currentTime;
      const now = performance.now();
      const hands = toUserHands(landmarker.detectForVideo(video, now));
      drawHands(ctx, canvas.width, canvas.height, hands);
      const n = hands.length;
      status.textContent = n ? `${n} hand${n > 1 ? 's' : ''}` : 'No hands';
      frameListeners.forEach((fn) => fn(hands, now));
    }
    frameId = requestAnimationFrame(frame);
  };
  frameId = requestAnimationFrame(frame);
}

/**
 * MediaPipe result -> hands as the user sees them in the mirrored preview:
 * x flipped, and Left / Right meaning the user's own hands.
 * MediaPipe labels handedness as if the image were mirrored (selfie); our video frames
 * aren't, so its labels come out swapped and are flipped back here.
 */
function toUserHands(result) {
  const sides = result.handedness ?? result.handednesses ?? [];
  return result.landmarks.map((points, i) => ({
    label: sides[i]?.[0]?.categoryName === 'Left' ? 'Right' : 'Left', // swap the label back
    points: points.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z })), // mirror x, like a selfie
  }));
}

// ---------- remembered choice ----------

/** The camera used last time (from localStorage), or null. */
function loadChoice() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    return null;
  }
}

/** Remember this camera for next time. */
function saveChoice(choice) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
  } catch {
    // storage blocked: just don't remember
  }
}
