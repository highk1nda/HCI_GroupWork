import { PALETTE, cloneTransform } from '../types.js';

// Phase 2: text -> Intent, rule based. Not wired to any input yet (voice.js is a stub),
// but pure, so it is unit-tested now and ready when voice lands.

const SHAPE_WORDS = {
  cube: 'cube',
  box: 'cube',
  block: 'cube',
  sphere: 'sphere',
  ball: 'sphere',
  cone: 'cone',
  cylinder: 'cylinder',
  rod: 'rod',
  stick: 'rod',
  heart: 'heart',
};
const COLORS = Object.fromEntries(PALETTE.map((c) => [c.name, c.hex]));
const IT = /^(it|this|that|this one|that one|selected|selected one)$/;

// Fixed steps for voice-made transforms
const SCALE_UP = 1.25;
const SCALE_DOWN = 0.8;
const ROTATE_STEP = Math.PI / 4;
const MOVE_STEP = 0.5;

/**
 * @typedef {object} ParseContext
 * @property {string | null} selectedId                 what "it" refers to
 * @property {(id: string) => import('../types.js').Transform} getTransform
 */

/**
 * Turn a spoken sentence into an intent, or null if no rule matches.
 * @param {string} text
 * @param {ParseContext} ctx
 * @returns {import('../types.js').Intent | null}
 */
export function parse(text, ctx) {
  // clean up: lowercase, no punctuation, drop filler words, single spaces
  const t = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\b(please|now|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return null;

  if (/^(undo|go back)( that)?$/.test(t)) return { type: 'undo' };
  if (/^redo( that)?$/.test(t)) return { type: 'redo' };
  if (/^save( scene)?$/.test(t)) return { type: 'save' };

  // make it <color> / paint it <color> / <color>
  let m = t.match(/^(?:make|paint|color|colour|turn)?\s?(?:it|this|that)?\s?([a-z]+)$/);
  if (m && COLORS[m[1]]) {
    return ctx.selectedId ? { type: 'setColor', id: ctx.selectedId, color: COLORS[m[1]] } : null;
  }

  // add <shape> [color] / add a [color] <shape>
  // m[1] = color before the shape, m[2] = shape (plural "s" ignored), m[3] = color after "in"
  m = t.match(/^(?:add|create|make|new)(?: an?)?(?: ([a-z]+))? ([a-z]+?)s?(?: in ([a-z]+))?$/);
  if (m && SHAPE_WORDS[m[2]]) {
    const color = COLORS[m[1]] ?? COLORS[m[3]];
    if (m[1] && !color) return null;
    return color ? { type: 'add', shape: SHAPE_WORDS[m[2]], color } : { type: 'add', shape: SHAPE_WORDS[m[2]] };
  }

  // delete (it | <id>)
  m = t.match(/^(?:delete|remove)(?: (.+))?$/);
  if (m) {
    const target = m[1] ?? 'it';
    // "it" -> selected object, "cube-2" stays as is, "cube 2" -> "cube-2"
    const id = IT.test(target) ? ctx.selectedId : /^[a-z]+-\d+$/.test(target) ? target : target.replace(/ (\d+)$/, '-$1');
    return id && /^[a-z]+-\d+$/.test(id) ? { type: 'delete', id } : null;
  }

  // everything below changes the selected object, so it needs one
  const id = ctx.selectedId;
  if (!id) return null;
  const before = ctx.getTransform(id);
  const after = cloneTransform(before);

  if (/^(make it )?(bigger|larger|grow)$/.test(t)) {
    after.scale = /** @type {any} */ (after.scale.map((v) => v * SCALE_UP));
  } else if (/^(make it )?(smaller|shrink)$/.test(t)) {
    after.scale = /** @type {any} */ (after.scale.map((v) => v * SCALE_DOWN));
  } else if ((m = t.match(/^(?:rotate|turn)(?: it)? (left|right)$/))) {
    after.rotation[1] += m[1] === 'left' ? ROTATE_STEP : -ROTATE_STEP;
  } else if ((m = t.match(/^move(?: it)? (left|right|up|down)$/))) {
    // axis 0 = x (left/right), axis 1 = y (up/down)
    const [axis, sign] = { left: [0, -1], right: [0, 1], up: [1, 1], down: [1, -1] }[m[1]];
    after.position[axis] += sign * MOVE_STEP;
  } else {
    return null;
  }
  return { type: 'transform', id, before, after };
}
