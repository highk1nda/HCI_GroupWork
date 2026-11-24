// Dev helper: a fake camera and made-up hand frames, for testing gestures where a real
// camera isn't available. Not loaded by the app. From the browser console on the app page:
//
//   const fh = await import('/tests/fake-hands.js');
//   fh.installFakeCamera();                       // then turn on Cam mode as usual
//   await fh.feed((i, ms) => fh.twoHands(), 6500); // send 6.5 s of a still two-hand pose
//
// Frames go to window.demo.recognizer.onFrame, exactly where camera.js sends real ones.

/**
 * Replace getUserMedia / enumerateDevices with a canvas stream. It sends one frame a
 * second (MediaPipe finds no hands in it), which also acts like a tracking dropout.
 */
export function installFakeCamera(cameras = ['Fake camera']) {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  let n = 0;
  const draw = () => {
    ctx.fillStyle = '#4a5160';
    ctx.fillRect(0, 0, 640, 480);
    ctx.fillStyle = '#fff';
    ctx.font = '36px sans-serif';
    ctx.fillText(`FAKE CAMERA ${n++}`, 40, 240);
  };
  draw();
  navigator.mediaDevices.getUserMedia = async (c) => {
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0];
    const tick = () => {
      draw();
      track.requestFrame();
    };
    setTimeout(tick, 50);
    setInterval(tick, 1000);
    const id = c?.video?.deviceId?.exact ?? c?.video?.deviceId?.ideal ?? 'fake-0';
    track.getSettings = () => ({ deviceId: id, width: 640, height: 480 });
    return stream;
  };
  navigator.mediaDevices.enumerateDevices = async () =>
    cameras.map((label, i) => ({ kind: 'videoinput', deviceId: `fake-${i}`, label }));
}

// 21 points around the wrist; `spread` opens the fingers (a different pose).
const BASE = Array.from({ length: 21 }, (_, i) =>
  i === 0 ? [0, 0] : [((i - 1) % 4) * 0.12 - 0.2 + Math.floor((i - 1) / 4) * 0.05, -0.3 - Math.floor((i - 1) / 4) * 0.18],
);

/** One made-up hand at (cx, cy), size s, with optional jitter and finger spread. */
export function hand(label, cx, cy, { s = 0.25, jitter = 0.002, spread = 0, seed = Math.random() * 100 } = {}) {
  const flip = label === 'Right' ? -1 : 1;
  return {
    label,
    points: BASE.map(([dx, dy], i) => ({
      x: cx + flip * (dx + spread * ((i - 1) % 4) * 0.15) * s + jitter * Math.sin(i * 7 + seed),
      y: cy + (dy - spread * Math.floor((i - 1) / 4) * 0.1) * s + jitter * Math.cos(i * 3 + seed),
    })),
  };
}

/** Two hands; `gap` = distance between the wrists, `x` = center. */
export function twoHands({ x = 0.5, y = 0.75, gap = 0.3, ...opts } = {}) {
  return [hand('Left', x - gap / 2, y, opts), hand('Right', x + gap / 2, y, opts)];
}

/**
 * Send frames for `ms` milliseconds at ~30 fps. fn(i, elapsedMs) returns the hands of each frame.
 * Ticks come from a Web Worker: page timers drop to 1 per second when the tab is hidden.
 */
export function feed(fn, ms) {
  return new Promise((resolve) => {
    const src = 'setInterval(() => postMessage(0), 33)';
    const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    const t0 = performance.now();
    let i = 0;
    worker.onmessage = () => {
      const now = performance.now();
      window.demo.recognizer.onFrame(fn(i++, now - t0), now);
      if (now - t0 >= ms) {
        worker.terminate();
        resolve(i);
      }
    };
  });
}

/** Turn on Cam mode with the fake camera and close the picker. */
export async function startCam() {
  document.querySelector('.input-btn[title="Webcam hand tracking"]').click();
  await wait(300);
  document.getElementById('src-device').click();
  for (let i = 0; i < 50 && !window.demo.camera.isActive(); i++) await wait(100);
  document.getElementById('cam-dialog-close')?.click();
  await wait(200);
  return window.demo.camera.isActive();
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * python http.server lets the browser cache files; this re-downloads every module
 * already loaded on the page so the next reload runs the newest code.
 * Use: (await import(`/tests/fake-hands.js?${Date.now()}`)).refreshCache().then(() => location.reload())
 */
export async function refreshCache() {
  const urls = performance
    .getEntriesByType('resource')
    .map((e) => e.name)
    .filter((u) => u.startsWith(location.origin) && !u.includes('?'));
  const pages = ['/', '/index.html', '/tests/', '/tests/index.html'].map((p) => location.origin + p);
  await Promise.all([...new Set([...urls, ...pages])].map((u) => fetch(u, { cache: 'reload' }).catch(() => {})));
}
