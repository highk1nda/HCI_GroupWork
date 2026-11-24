// Drawing hands on a canvas. Hands are in user space (already mirrored, 0-1), so the
// canvas itself is NOT flipped.

// The 21 hand landmarks joined into a skeleton (wrist = 0, then thumb, index, middle, ring, pinky).
export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

/** Green = the user's left hand, blue = right. */
export const HAND_COLORS = { Left: '#43a047', Right: '#1e88e5' };

/** Clear the canvas and draw bones and joints for each hand. */
export function drawHands(ctx, w, h, hands) {
  ctx.clearRect(0, 0, w, h);
  ctx.lineWidth = Math.max(2, w / 160);
  ctx.lineCap = 'round';
  for (const hand of hands) {
    const pts = hand.points;
    ctx.strokeStyle = HAND_COLORS[hand.label] ?? '#43a047';
    ctx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      ctx.moveTo(pts[a].x * w, pts[a].y * h);
      ctx.lineTo(pts[b].x * w, pts[b].y * h);
    }
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, ctx.lineWidth * 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Center of all points of all hands (where the hold ring goes). */
export function handsCenter(hands) {
  const pts = hands.flatMap((h) => h.points);
  return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
}

/** A filling ring with a shape icon inside: "this gesture is about to fire". */
export function drawHoldRing(ctx, w, h, at, progress, icon) {
  const r = Math.max(18, h * 0.11);
  // keep the ring fully inside the canvas, even when the hands are near the edge
  const x = Math.min(w - r - 4, Math.max(r + 4, at.x * w));
  const y = Math.min(h - r - 4, Math.max(r + 4, at.y * h));
  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = Math.max(3, r * 0.18);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
  ctx.stroke();
  ctx.strokeStyle = '#1e6fe0';
  ctx.beginPath();
  ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2); // starts at 12 o'clock, goes clockwise
  ctx.stroke();
  if (icon?.complete && icon.naturalWidth) ctx.drawImage(icon, x - r * 0.7, y - r * 0.7, r * 1.4, r * 1.4);
  ctx.restore();
}
