// Shared contracts. Agreed in week 1 and frozen: every layer codes against these.
// (JSDoc instead of TypeScript: the same shapes, checked by the editor.)

/** @typedef {'cube'|'sphere'|'cone'|'cylinder'|'rod'|'heart'} Shape */
/** @typedef {[number, number, number]} Vec3 */
/** @typedef {'mouse'|'keyboard'|'voice'|'gesture'|'ai'} Source */

/**
 * Plain data: what gets saved, undone and sent to an LLM later.
 * @typedef {object} SceneObject
 * @property {string} id         'cube-1', 'heart-2'
 * @property {Shape} shape
 * @property {Vec3} position
 * @property {Vec3} rotation     radians (Euler XYZ)
 * @property {Vec3} scale
 * @property {string} color      '#4f8cff'
 */

/** @typedef {Pick<SceneObject, 'position'|'rotation'|'scale'>} Transform */

/**
 * What any input wants to happen (mouse, voice, gesture all emit these).
 * @typedef {{ type: 'add', shape: Shape, color?: string }
 *   | { type: 'delete', id: string }
 *   | { type: 'select', id: string | null }
 *   | { type: 'transform', id: string, before: Transform, after: Transform }
 *   | { type: 'setColor', id: string, color: string }
 *   | { type: 'clear' }
 *   | { type: 'zoom', factor: number }       camera only, no history: >1 = closer
 *   | { type: 'orbit', degrees: number }     camera only, no history: + = like dragging left
 *   | { type: 'undo' } | { type: 'redo' } | { type: 'save' }} Intent
 */

/**
 * @typedef {object} Command
 * @property {string} label        shown in history panel: 'Scale cube'
 * @property {Source} source       icon in history panel
 * @property {string} [targetId]   small secondary text in the history panel
 * @property {string} [swatch]     color dot in the history panel
 * @property {() => void} do
 * @property {() => void} undo
 */

/** @type {readonly Shape[]} */
export const SHAPES = ['cube', 'sphere', 'cone', 'cylinder', 'rod', 'heart'];

/** Button text from the mockup's Models row. */
export const SHAPE_LABELS = {
  cube: 'cube',
  sphere: 'sphere',
  cone: 'cone',
  cylinder: 'cyl',
  rod: 'rod',
  heart: 'heart',
};

/** The 8 fixed swatches from the mockup. */
export const PALETTE = [
  { name: 'red', hex: '#e53935' },
  { name: 'orange', hex: '#fb8c00' },
  { name: 'yellow', hex: '#fdd835' },
  { name: 'green', hex: '#43a047' },
  { name: 'blue', hex: '#1e88e5' },
  { name: 'purple', hex: '#8e24aa' },
  { name: 'white', hex: '#ffffff' },
  { name: 'black', hex: '#212121' },
];

/** Palette name for a hex color ('#e53935' -> 'red'), or the hex itself if it's not in the palette. @param {string} hex */
export function colorName(hex) {
  return PALETTE.find((c) => c.hex === hex.toLowerCase())?.name ?? hex;
}

/** Deep copy of a transform, so editing the copy never changes the original. @param {Transform} t @returns {Transform} */
export function cloneTransform(t) {
  return {
    position: [...t.position],
    rotation: [...t.rotation],
    scale: [...t.scale],
  };
}

/** Are two vectors equal? Uses a tiny tolerance because floats are never exact. @param {Vec3} a @param {Vec3} b */
export function sameVec(a, b, eps = 1e-6) {
  return Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps && Math.abs(a[2] - b[2]) < eps;
}

/** Same position, rotation and scale? @param {Transform} a @param {Transform} b */
export function sameTransform(a, b) {
  return sameVec(a.position, b.position) && sameVec(a.rotation, b.rotation) && sameVec(a.scale, b.scale);
}
