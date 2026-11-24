// Tiny in-browser test runner (stands in for Vitest until the project has a Node toolchain).
import { History } from '../src/commands/history.js';
import { parse } from '../src/input/parser.js';
import { poseFeatures, poseDistance, handSpeed, handSpread } from '../src/input/gestures/features.js';
import { parseGestures, emptyData } from '../src/input/gestures/store.js';
import { checkPose } from '../src/input/gestures/recorder.js';
import { distancesPerShape, pickBest, nearestOtherShape, HoldTrigger } from '../src/input/gestures/poseMatcher.js';
import { dtw, resample, autoTrim, buildTemplate, MotionWatcher, TEMPLATE_LEN } from '../src/input/gestures/motionMatcher.js';
import { describeScene, colorWord, MAX_LISTED } from '../src/ai/sceneContext.js';
import { parseReply, validateActions, UnreadableReply } from '../src/ai/validate.js';
import { buildMessages, REPLY_SCHEMA, SYSTEM_PROMPT } from '../src/ai/prompt.js';

const results = [];
// run one test and record pass / fail (a thrown error = fail)
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err });
  }
}
function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}
// deep equality by comparing the JSON text
function eq(actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}\n     got ${a}`);
}
const near = (a, b) => Math.abs(a - b) < 1e-9;

/** A command that appends to a log, so order of do/undo is visible. */
function cmd(log, name) {
  return { label: name, source: 'mouse', do: () => log.push(`do ${name}`), undo: () => log.push(`undo ${name}`) };
}

// ---------- History ----------

test('execute runs do() and enables undo', () => {
  const h = new History();
  const log = [];
  h.execute(cmd(log, 'a'));
  eq(log, ['do a']);
  assert(h.canUndo && !h.canRedo);
});

test('undo and redo move commands between stacks in order', () => {
  const h = new History();
  const log = [];
  h.execute(cmd(log, 'a'));
  h.execute(cmd(log, 'b'));
  h.undo();
  h.undo();
  h.redo();
  eq(log, ['do a', 'do b', 'undo b', 'undo a', 'do a']);
  eq(h.undoStack.map((c) => c.label), ['a']);
  eq(h.redoStack.map((c) => c.label), ['b']);
});

test('undo/redo on empty stacks are no-ops', () => {
  const h = new History();
  let events = 0;
  h.onChange(() => events++);
  h.undo();
  h.redo();
  eq(events, 0);
});

test('a new action clears the redo stack', () => {
  const h = new History();
  const log = [];
  h.execute(cmd(log, 'a'));
  h.undo();
  assert(h.canRedo);
  h.execute(cmd(log, 'b'));
  assert(!h.canRedo);
  eq(h.undoStack.map((c) => c.label), ['b']);
});

test('history is capped at the limit, dropping the oldest', () => {
  const h = new History(100);
  const log = [];
  for (let i = 0; i < 105; i++) h.execute(cmd(log, `c${i}`));
  eq(h.undoStack.length, 100);
  eq(h.undoStack[0].label, 'c5');
});

test('onChange reports kind and command; unsubscribe works', () => {
  const h = new History();
  const seen = [];
  const off = h.onChange((e) => seen.push(`${e.kind}:${e.command?.label ?? '-'}`));
  const log = [];
  h.execute(cmd(log, 'a'));
  h.undo();
  h.redo();
  h.clear();
  off();
  h.execute(cmd(log, 'b'));
  eq(seen, ['execute:a', 'undo:a', 'redo:a', 'clear:-']);
});

test('clear empties both stacks', () => {
  const h = new History();
  const log = [];
  h.execute(cmd(log, 'a'));
  h.execute(cmd(log, 'b'));
  h.undo();
  h.clear();
  assert(!h.canUndo && !h.canRedo);
});

// ---------- Parser (phase 2) ----------

const T = { position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
const ctx = { selectedId: 'cube-1', getTransform: () => structuredClone(T) };
const none = { selectedId: null, getTransform: () => structuredClone(T) };

test('parser: undo / redo / save', () => {
  eq(parse('Undo', ctx), { type: 'undo' });
  eq(parse('redo that', ctx), { type: 'redo' });
  eq(parse('save', ctx), { type: 'save' });
});

test('parser: add with and without color', () => {
  eq(parse('add a cube', none), { type: 'add', shape: 'cube' });
  eq(parse('add a blue cone', none), { type: 'add', shape: 'cone', color: '#1e88e5' });
  eq(parse('create a heart in red', none), { type: 'add', shape: 'heart', color: '#e53935' });
  eq(parse('add an orange ball', none), { type: 'add', shape: 'sphere', color: '#fb8c00' });
  eq(parse('add a sparkly cube', none), null);
});

test('parser: make it <color> needs a selection', () => {
  eq(parse('make it red', ctx), { type: 'setColor', id: 'cube-1', color: '#e53935' });
  eq(parse('Purple!', ctx), { type: 'setColor', id: 'cube-1', color: '#8e24aa' });
  eq(parse('make it red', none), null);
});

test('parser: delete it / delete <id>', () => {
  eq(parse('delete it', ctx), { type: 'delete', id: 'cube-1' });
  eq(parse('remove heart-2', ctx), { type: 'delete', id: 'heart-2' });
  eq(parse('delete sphere 3', ctx), { type: 'delete', id: 'sphere-3' });
  eq(parse('delete it', none), null);
});

test('parser: bigger / smaller use fixed steps', () => {
  const big = parse('make it bigger', ctx);
  eq(big.type, 'transform');
  eq(big.before.scale, [1, 1, 1]);
  eq(big.after.scale, [1.25, 1.25, 1.25]);
  eq(parse('smaller', ctx).after.scale, [0.8, 0.8, 0.8]);
});

test('parser: rotate and move', () => {
  assert(near(parse('rotate left', ctx).after.rotation[1], Math.PI / 4));
  assert(near(parse('turn it right', ctx).after.rotation[1], -Math.PI / 4));
  eq(parse('move it left', ctx).after.position, [-0.5, 0.5, 0]);
  eq(parse('move up', ctx).after.position, [0, 1, 0]);
  eq(parse('move up', none), null);
});

test('parser: unknown text returns null', () => {
  eq(parse('', ctx), null);
  eq(parse('sing me a song', ctx), null);
});

// ---------- Gestures: features, store, recorder ----------

// A made-up hand: 21 points around the wrist (cx, cy), size s. Right hands are mirrored.
const BASE = Array.from({ length: 21 }, (_, i) =>
  i === 0 ? [0, 0] : [((i - 1) % 4) * 0.12 - 0.2 + Math.floor((i - 1) / 4) * 0.05, -0.3 - Math.floor((i - 1) / 4) * 0.18],
);
function makeHand(label, cx, cy, s = 0.1, wiggle = 0, seed = 0) {
  const flip = label === 'Right' ? -1 : 1;
  return {
    label,
    points: BASE.map(([dx, dy], i) => ({
      x: cx + flip * dx * s + wiggle * Math.sin(i * 7 + seed),
      y: cy + dy * s + wiggle * Math.cos(i * 3 + seed),
    })),
  };
}
const twoHands = (dx = 0, dy = 0, s = 0.1, gap = 0.2) => [
  makeHand('Left', 0.4 + dx, 0.6 + dy, s),
  makeHand('Right', 0.4 + gap + dx, 0.6 + dy, s),
];
const sameNums = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-9);

test('poseFeatures: 84 numbers for two hands, 42 for one', () => {
  eq(poseFeatures(twoHands()).length, 84);
  eq(poseFeatures([makeHand('Left', 0.5, 0.5)]).length, 42);
});

test('poseFeatures: unchanged when hands move across the screen', () => {
  assert(sameNums(poseFeatures(twoHands()), poseFeatures(twoHands(0.25, -0.2))));
});

test('poseFeatures: unchanged when hands are closer or farther (uniform scale)', () => {
  // scale everything (hand size AND the gap between hands) by 1.8
  assert(sameNums(poseFeatures(twoHands(0, 0, 0.1, 0.2)), poseFeatures(twoHands(0, 0, 0.18, 0.36))));
});

test('poseFeatures: hand order is stable (Left first, whatever order MediaPipe gives)', () => {
  const [l, r] = twoHands();
  assert(sameNums(poseFeatures([l, r]), poseFeatures([r, l])));
});

test('poseDistance: 0 for the same pose, Infinity for different hand counts', () => {
  const f = poseFeatures(twoHands());
  eq(poseDistance(f, f), 0);
  eq(poseDistance(f, poseFeatures([makeHand('Left', 0.5, 0.5)])), Infinity);
});

test('handSpeed and handSpread', () => {
  const a = twoHands();
  const b = twoHands(0.1); // moved by 0.1 in 100 ms
  assert(handSpeed(a, b, 100) > 5, 'moving hands are fast');
  eq(handSpeed(a, a, 100), 0);
  assert(handSpread(twoHands(0, 0, 0.1, 0.4)) > handSpread(twoHands()), 'farther apart = bigger spread');
});

test('store: export/import round-trips the same data', () => {
  const data = emptyData();
  data.settings.threshold = 0.42;
  data.poses.cube = [{ hands: 2, frames: [poseFeatures(twoHands())], recordedAt: '2026-11-02T22:40:00Z' }];
  data.motions.zoomIn = { rawFrames: [], trim: [0.2, 1.1], template: { hands: 2, duration: 0.9, delta: { x: 0, spread: 1 }, frames: [[0, 1], [1, 2]] } };
  eq(parseGestures(JSON.stringify(data)), data);
});

test('store: import rejects bad files', () => {
  const bad = (obj, what) => {
    let threw = false;
    try {
      parseGestures(typeof obj === 'string' ? obj : JSON.stringify(obj));
    } catch {
      threw = true;
    }
    assert(threw, `accepted ${what}`);
  };
  bad('not json', 'non-JSON');
  bad({ version: 2 }, 'wrong version');
  bad({ version: 1, poses: { pyramid: [] } }, 'unknown shape');
  bad({ version: 1, poses: { cube: [{ hands: 2, frames: [[1, 2, 3]] }] } }, 'wrong frame length');
  bad({ version: 1, motions: { jump: {} } }, 'unknown motion');
});

const frames = (fn, n = 60) => Array.from({ length: n }, (_, i) => ({ t: i / 30, hands: fn(i) }));

test('checkPose: a still two-hand pose passes and keeps 10 frames', () => {
  const r = checkPose(frames((i) => [makeHand('Left', 0.4, 0.6, 0.1, 0.001, i), makeHand('Right', 0.6, 0.6, 0.1, 0.001, i)]));
  assert(r.ok, r.reasons.join());
  eq(r.hands, 2);
  eq(r.sample.frames.length, 10);
  eq(r.sample.frames[0].length, 84);
});

test('checkPose: fails when a hand is missing too often', () => {
  const r = checkPose(frames((i) => (i % 3 === 0 ? twoHands().slice(0, 1) : twoHands())));
  assert(!r.ok && r.reasons[0].includes('Both hands'), r.reasons.join());
});

test('checkPose: fails when the hands move', () => {
  const r = checkPose(frames((i) => [makeHand('Left', 0.4, 0.6, 0.1, 0.03, i), makeHand('Right', 0.6, 0.6, 0.1, 0.03, i * 2)]));
  assert(!r.ok && r.reasons.some((x) => x.includes('moved')), r.reasons.join());
});

test('checkPose: fails when the hands slide across the screen (same shape)', () => {
  const r = checkPose(frames((i) => twoHands(0.15 * Math.sin(i / 4))));
  assert(!r.ok && r.reasons.some((x) => x.includes('moved')), r.reasons.join());
});

test('checkPose: no hands at all', () => {
  const r = checkPose(frames(() => []));
  assert(!r.ok && r.sample === null);
});

// ---------- Gestures: pose matching ----------

// two different made-up poses: "open" fingers vs the base hand
const openHand = (label, cx, cy) => {
  const h = makeHand(label, cx, cy);
  h.points = h.points.map((p, i) => ({ x: p.x + (i % 4) * 0.01 * (label === 'Right' ? -1 : 1), y: p.y - (i % 3) * 0.01 }));
  return h;
};
const poseA = poseFeatures(twoHands());
const poseB = poseFeatures([openHand('Left', 0.4, 0.6), openHand('Right', 0.6, 0.6)]);
const POSES = { cube: [{ hands: 2, frames: [poseA] }], cone: [{ hands: 2, frames: [poseB] }], rod: [{ hands: 1, frames: [poseFeatures([makeHand('Left', 0.5, 0.5)])] }] };

test('distancesPerShape: nearest sample per shape, other hand counts ignored', () => {
  const d = distancesPerShape(poseA, 2, POSES);
  eq(d.cube, 0);
  assert(d.cone > 0 && Number.isFinite(d.cone));
  eq(d.rod, Infinity);
  eq(d.heart, Infinity);
});

test('pickBest: needs the threshold AND a 20% margin over the second best', () => {
  eq(pickBest({ cube: 0.1, cone: 0.5 }, 0.35).key, 'cube');
  eq(pickBest({ cube: 0.4, cone: 0.9 }, 0.35).key, null); // over the threshold
  eq(pickBest({ cube: 0.3, cone: 0.33 }, 0.35).key, null); // too close to the runner-up
  eq(pickBest({ cube: 0.3, cone: Infinity }, 0.35).key, 'cube');
  eq(pickBest({}, 0.35).key, null);
});

test('nearestOtherShape: finds the shape a new sample looks like', () => {
  const r = nearestOtherShape({ hands: 2, frames: [poseA] }, POSES, 'heart');
  eq(r.shape, 'cube');
  eq(r.distance, 0);
  eq(nearestOtherShape({ hands: 2, frames: [poseA] }, POSES, 'cube').shape, 'cone');
});

test('HoldTrigger: fires after the hold, then waits for cooldown and a pose change', () => {
  const t = new HoldTrigger();
  const opts = { holdMs: 600, cooldownMs: 1500 };
  eq(t.update('cube', 0, opts).fired, null);
  assert(near(t.update('cube', 300, opts).progress, 0.5));
  eq(t.update('cube', 600, opts).fired, 'cube');
  eq(t.update('cube', 3000, opts).fired, null, 'same pose still held: no repeat');
  eq(t.update(null, 3100, opts).fired, null); // hands leave the pose
  eq(t.update('cube', 3200, opts).fired, null);
  eq(t.update('cube', 3800, opts).fired, 'cube'); // held again for 600 ms
});

test('HoldTrigger: cooldown blocks a different pose too', () => {
  const t = new HoldTrigger();
  const opts = { holdMs: 0, cooldownMs: 1500 };
  eq(t.update('cube', 0, opts).fired, 'cube');
  eq(t.update('cone', 500, opts).fired, null);
  eq(t.update('cone', 1600, opts).fired, 'cone');
});

// ---------- Gestures: motions ----------

// A recording: still for `pre` s, then the hands move apart (or together / sideways) for 1 s, then still.
// gap/x are functions of motion progress p in 0..1.
function recording({ pre = 0.8, post = 0.8, gap = () => 0.2, x = () => 0.5, fps = 30, dur = 1 } = {}) {
  const out = [];
  const total = pre + dur + post;
  for (let i = 0; i <= total * fps; i++) {
    const t = i / fps;
    const p = Math.min(1, Math.max(0, (t - pre) / dur));
    const g = gap(p);
    const cx = x(p);
    out.push({ t, hands: [makeHand('Left', cx - g / 2, 0.6), makeHand('Right', cx + g / 2, 0.6)] });
  }
  return out;
}
const apart = recording({ gap: (p) => 0.15 + 0.35 * p });
const together = recording({ gap: (p) => 0.5 - 0.35 * p });
const sweepLeft = recording({ x: (p) => 0.7 - 0.4 * p });

test('dtw: identical sequences have distance 0', () => {
  const seq = [[0, 0, 1], [1, 0, 2], [2, 1, 3]];
  eq(dtw(seq, seq), 0);
});

test('dtw: a slower version of the same movement is closer than a different movement', () => {
  const ramp = (n, k = 1) => Array.from({ length: n }, (_, i) => [((i / (n - 1)) * 3) * k, 0, 0]);
  assert(dtw(ramp(32), ramp(20)) < dtw(ramp(32), ramp(32, -1)));
});

test('resample: fixed length, keeps the ends', () => {
  const r = resample([{ t: 0, v: [0] }, { t: 1, v: [10] }, { t: 3, v: [30] }], 7);
  eq(r.length, 7);
  eq(r[0], [0]);
  eq(r[6], [30]);
  assert(near(r[3][0], 15));
});

test('autoTrim: cuts the still parts before and after the motion', () => {
  const [a, b] = autoTrim(apart, 'zoomIn');
  assert(a > 0.5 && a < 0.9, `start ${a}`);
  assert(b > 1.7 && b < 2.1, `end ${b}`);
});

test('autoTrim: one glitchy frame does not pull the trim onto it', () => {
  const glitchy = apart.map((f, i) => (i === 65 ? { t: f.t, hands: twoHands(0.3) } : f)); // one jumpy frame at 2.17 s
  const [a, b] = autoTrim(glitchy, 'zoomIn');
  assert(a > 0.5 && a < 0.9 && b > 1.7 && b < 2.1, `${a}-${b}`);
});

test('buildTemplate: fixed length, records the direction of the motion', () => {
  const tpl = buildTemplate(apart, autoTrim(apart));
  eq(tpl.hands, 2);
  eq(tpl.frames.length, TEMPLATE_LEN);
  assert(tpl.delta.spread > 1, 'spread grows when hands move apart');
  const orbit = buildTemplate(sweepLeft, autoTrim(sweepLeft, 'orbit'));
  assert(orbit.delta.x < 0 && orbit.mirrored.length === TEMPLATE_LEN, 'sweep left = negative x');
});

test('MotionWatcher: matches zoom in vs zoom out, and orbit in both directions', () => {
  const templates = {
    zoomIn: buildTemplate(apart, autoTrim(apart)),
    zoomOut: buildTemplate(together, autoTrim(together)),
    orbit: buildTemplate(sweepLeft, autoTrim(sweepLeft, 'orbit')),
  };
  const play = (rec) => {
    const w = new MotionWatcher();
    // live: a bit faster than recorded, ends right after the motion
    rec.filter((f) => f.t <= 1.9).forEach((f) => w.push(f.hands, f.t * 900));
    return w.match(templates, 0.35);
  };
  eq(play(recording({ gap: (p) => 0.18 + 0.3 * p })).key, 'zoomIn');
  eq(play(recording({ gap: (p) => 0.48 - 0.3 * p })).key, 'zoomOut');
  const left = play(recording({ x: (p) => 0.65 - 0.35 * p }));
  eq([left.key, left.dirs.orbit], ['orbit', -1]);
  const right = play(recording({ x: (p) => 0.35 + 0.35 * p }));
  eq([right.key, right.dirs.orbit], ['orbit', 1]);
  eq(play(recording({})).key, null); // no movement: nothing
});

test('MotionWatcher: one right hand recorded sweeping left also matches sweeping right', () => {
  const oneHand = (x) => {
    const out = [];
    for (let i = 0; i <= 78; i++) {
      const t = i / 30;
      const p = Math.min(1, Math.max(0, (t - 0.8) / 1));
      out.push({ t, hands: [makeHand('Right', x(p), 0.6)] });
    }
    return out;
  };
  const rec = oneHand((p) => 0.7 - 0.4 * p);
  const templates = { orbit: buildTemplate(rec, autoTrim(rec, 'orbit')) };
  const play = (r) => {
    const w = new MotionWatcher();
    r.filter((f) => f.t <= 1.9).forEach((f) => w.push(f.hands, f.t * 1000));
    return w.match(templates, 0.35);
  };
  const right = play(oneHand((p) => 0.3 + 0.4 * p));
  eq([right.key, right.dirs.orbit], ['orbit', 1]);
  const left = play(oneHand((p) => 0.7 - 0.4 * p));
  eq([left.key, left.dirs.orbit], ['orbit', -1]);
});

// ---------- AI assistant: scene snapshot, validation ----------

const obj = (id, shape, color, position = [0, 0.5, 0], scale = [1, 1, 1]) => ({ id, shape, position, rotation: [0, 0, 0], scale, color });

test('describeScene: lines, counts, selection', () => {
  const text = describeScene(
    [obj('cube-1', 'cube', '#e53935'), obj('sphere-1', 'sphere', '#1e88e5', [1.5, 0.5, 0]), obj('cube-2', 'cube', '#e53935', [3, 0.5, 0])],
    'cube-1',
  );
  eq(text.split('\n'), [
    'Scene: 3 objects. Selected: cube-1.',
    '- cube-1: cube, red, at (0, 0.5, 0), size 1',
    '- sphere-1: sphere, blue, at (1.5, 0.5, 0), size 1',
    '- cube-2: cube, red, at (3, 0.5, 0), size 1',
    'Counts: cube 2, sphere 1.',
  ]);
});

test('describeScene: rounds to 1 decimal, size = average scale, no -0', () => {
  const line = describeScene([obj('heart-1', 'heart', '#8e24aa', [-1.4567, 0.5049, -0.01], [1.2, 1.25, 1.15])], null).split('\n')[1];
  eq(line, '- heart-1: heart, purple, at (-1.5, 0.5, 0), size 1.2');
});

test('describeScene: empty scene', () => {
  eq(describeScene([], null), 'Scene: 0 objects. Selected: none.\nCounts: none.');
});

test('describeScene: lists at most 40 objects, counts all of them', () => {
  const many = Array.from({ length: 52 }, (_, i) => obj(`cube-${i + 1}`, 'cube', '#ffffff'));
  const lines = describeScene(many, null).split('\n');
  eq(lines.length, 1 + MAX_LISTED + 1 + 1);
  eq(lines.at(-2), '...and 12 more');
  eq(lines.at(-1), 'Counts: cube 52.');
});

test('colorWord: palette names, anything else is custom', () => {
  eq(colorWord('#E53935'), 'red');
  eq(colorWord('#212121'), 'black');
  eq(colorWord('#123456'), 'custom');
});

test('prompt: starts with /no_think, scene + command last, schema allows only add', () => {
  assert(SYSTEM_PROMPT.startsWith('/no_think'));
  const msgs = buildMessages('Scene: 0 objects. Selected: none.\nCounts: none.', 'add a cube');
  eq(msgs[0].role, 'system');
  assert(msgs.at(-1).content.endsWith('Command: add a cube'));
  eq(REPLY_SCHEMA.properties.actions.items.properties.op.enum, ['add']);
  msgs.filter((m) => m.role === 'assistant').forEach((m) => parseReply(m.content)); // examples are valid JSON
});

test('parseReply: plain JSON, a leftover <think> block, text around it', () => {
  eq(parseReply('{"reply":"Hi","actions":[]}'), { reply: 'Hi', actions: [] });
  eq(parseReply('<think>hmm</think>\n{"reply":"Ok","actions":[]}').reply, 'Ok');
  eq(parseReply('Sure! {"reply":"Ok","actions":[{"op":"add"}]} done').actions.length, 1);
});

test('parseReply: garbage throws UnreadableReply', () => {
  let err = null;
  try {
    parseReply('I think you want a cube');
  } catch (e) {
    err = e;
  }
  assert(err instanceof UnreadableReply, 'should throw');
  eq(err.message, 'AI gave an unreadable answer, try again.');
});

test('validateActions: bad shape and unknown op dropped, colors mapped', () => {
  const r = validateActions([
    { op: 'add', shape: 'cube', color: 'red', count: 1 },
    { op: 'add', shape: 'banana', color: 'purple', count: 1 },
    { op: 'move', shape: 'cube', color: 'red', count: 1 },
    { op: 'add', shape: 'sphere', color: 'default', count: 2 },
  ]);
  eq(r.dropped, 2);
  eq(r.actions, [
    { shape: 'cube', color: '#e53935', colorName: 'red', count: 1 },
    { shape: 'sphere', color: undefined, colorName: 'default', count: 2 },
  ].map((a) => ({ ...a })));
});

test('validateActions: count clamped to 1-10, at most 10 objects per request', () => {
  eq(validateActions([{ op: 'add', shape: 'cube', color: 'red', count: 50 }]).actions[0].count, 10);
  eq(validateActions([{ op: 'add', shape: 'cube', color: 'red', count: 0 }]).actions[0].count, 1);
  eq(validateActions([{ op: 'add', shape: 'cube', color: 'red', count: 'x' }]).actions[0].count, 1);
  const r = validateActions([
    { op: 'add', shape: 'cube', color: 'red', count: 6 },
    { op: 'add', shape: 'cone', color: 'blue', count: 6 },
    { op: 'add', shape: 'rod', color: 'blue', count: 1 },
  ]);
  eq(r.actions.map((a) => a.count), [6, 4]);
  assert(r.capped, 'capped');
  eq(validateActions(undefined).actions, []);
});

// ---------- report ----------

const list = document.getElementById('results');
for (const r of results) {
  const li = document.createElement('li');
  li.className = r.ok ? 'pass' : 'fail';
  li.textContent = r.name;
  if (!r.ok) {
    const pre = document.createElement('pre');
    pre.textContent = r.err.message;
    li.append(pre);
  }
  list.append(li);
}
const failed = results.filter((r) => !r.ok).length;
const summary = document.getElementById('summary');
summary.textContent = failed ? `${failed} of ${results.length} failed` : `All ${results.length} tests passed`;
summary.className = failed ? 'bad' : 'ok';
document.title = failed ? `✗ ${failed} failed` : `✓ ${results.length} passed`;
