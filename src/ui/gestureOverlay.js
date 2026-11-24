import { onRecognizerUpdate } from '../input/gestures/recognizer.js';
import { shapeIcons } from '../scene/presets.js';
import { drawHoldRing, handsCenter } from './handDraw.js';

// Hold ring on the camera preview: while a recognized pose is being held, a ring
// with the shape's icon fills up next to the hands. Full ring = the shape is added.

const images = {};

/** The shape icon as an <img> (for drawing on a canvas). */
export function shapeImage(shape) {
  if (!images[shape]) {
    images[shape] = new Image();
    images[shape].src = shapeIcons()[shape] ?? '';
  }
  return images[shape];
}

/** Draw the hold ring (or the "following" badge) on the corner preview every frame. */
export function initGestureOverlay() {
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('cam-overlay'));
  const ctx = canvas.getContext('2d');
  // camera.js has just drawn the skeleton for this frame; the ring goes on top
  onRecognizerUpdate((u) => {
    if (u.follow) return drawBadge(ctx, canvas, FOLLOW_LABELS[u.follow]);
    if (!u.live || !u.pose?.key || u.pose.progress <= 0) return;
    drawHoldRing(ctx, canvas.width, canvas.height, handsCenter(u.hands), u.pose.progress, shapeImage(u.pose.key));
  });
}

const FOLLOW_LABELS = { zoomIn: 'Zoom follows your hands', zoomOut: 'Zoom follows your hands', orbit: 'Orbit follows your hand' };

/** A pill at the bottom of the preview: "the camera is following your hands". */
function drawBadge(ctx, canvas, text) {
  const h = canvas.height;
  ctx.save();
  ctx.font = `600 ${Math.round(h * 0.06)}px system-ui, sans-serif`;
  const w = ctx.measureText(text).width + h * 0.08;
  const x = (canvas.width - w) / 2;
  const y = h * 0.84;
  ctx.fillStyle = 'rgba(30, 111, 224, 0.9)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h * 0.1, h * 0.05);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + h * 0.04, y + h * 0.05);
  ctx.restore();
}
