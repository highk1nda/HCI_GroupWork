import { SHAPES } from '../../types.js';
import { toast } from '../../ui/statusBar.js';

// Recorded gestures + settings. Lives in localStorage ("demo3d.gestures") and can be
// exported / imported as the same JSON. Format:
// { version: 1, settings, poses: { cube: [sample, ...] }, motions: { zoomIn: { rawFrames, trim, template } } }

const STORAGE_KEY = 'demo3d.gestures';
export const MOTIONS = ['zoomIn', 'zoomOut', 'orbit'];
export const MAX_SAMPLES = 5;
export const DEFAULT_SETTINGS = {
  enabled: true, // recognition on/off
  threshold: 0.35, // match threshold, in palm sizes (bigger = more forgiving)
  holdMs: 600, // how long a pose must be held before it fires
  cooldownMs: 1500, // pause after a gesture fired
  continuous: true, // zoom / orbit keep following the hand while the motion goes on
};

let data = emptyData();
const listeners = [];

/** A fresh store: default settings, no gestures. */
export function emptyData() {
  return { version: 1, settings: { ...DEFAULT_SETTINGS }, poses: {}, motions: {} };
}

/** Load from localStorage (call once on startup). */
export function initStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) data = parseGestures(raw);
  } catch (err) {
    console.warn('Ignoring unreadable gesture settings', err);
  }
}

/** Subscribe to any change (samples, motions, settings). */
export function onStoreChange(fn) {
  listeners.push(fn);
}

/** After every change: save to localStorage and tell subscribers. */
function changed() {
  try {
    localStorage.setItem(STORAGE_KEY, serialize());
  } catch {
    // storage blocked or full: gestures still work until reload
  }
  listeners.forEach((fn) => fn());
}

// ---------- reading ----------

export const settings = () => data.settings;
export const allPoses = () => data.poses;
export const poseSamples = (shape) => data.poses[shape] ?? [];

/** Saved motion with raw frames unpacked, or null. */
export function getMotion(action) {
  const m = data.motions[action];
  return m ? { ...m, rawFrames: unpackFrames(m.rawFrames) } : null;
}

/** Templates of every saved motion: { zoomIn: template, ... } */
export function motionTemplates() {
  return Object.fromEntries(Object.entries(data.motions).map(([k, m]) => [k, m.template]));
}

/** Is at least one gesture recorded? Recognition stays off until then. */
export function hasAnyGesture() {
  return Object.values(data.poses).some((s) => s.length) || Object.keys(data.motions).length > 0;
}

// ---------- writing ----------

/** Change some settings, keep the rest. */
export function updateSettings(patch) {
  data.settings = { ...data.settings, ...patch };
  changed();
}

/** Add one pose sample to a shape (up to MAX_SAMPLES). */
export function addPoseSample(shape, sample) {
  const list = poseSamples(shape);
  if (list.length >= MAX_SAMPLES) throw new Error(`Up to ${MAX_SAMPLES} samples per shape`);
  data.poses[shape] = [...list, sample];
  changed();
}

/** Replace all samples of a shape with this one. */
export function replacePoseSamples(shape, sample) {
  data.poses[shape] = [sample];
  changed();
}

/** Remove every sample of one shape. */
export function deletePoses(shape) {
  delete data.poses[shape];
  changed();
}

/** Save a motion: raw frames (kept for re-trimming), trim [start, end] in seconds, matching template. */
export function setMotion(action, { rawFrames, trim, template }) {
  data.motions[action] = { rawFrames: packFrames(rawFrames), trim, template };
  changed();
}

/** Remove one motion recording. */
export function deleteMotion(action) {
  delete data.motions[action];
  changed();
}

/** Wipe all gestures and settings. */
export function resetAll() {
  data = emptyData();
  changed();
}

// ---------- files ----------

/** Everything as one JSON string. */
export function serialize() {
  return JSON.stringify(data);
}

/** Download everything as gestures.json */
export function exportFile() {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'gestures.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Gestures exported · gestures.json downloaded');
}

/** Replace everything with a gestures.json file. @param {File} file */
export async function importFile(file) {
  try {
    data = parseGestures(await file.text());
    changed();
    toast(`Imported ${file.name}`);
    return true;
  } catch (err) {
    console.warn(err);
    toast(`Couldn't import ${file.name}: ${err.message}`);
    return false;
  }
}

/** Replace everything with already-parsed JSON text (team gestures file). */
export function importText(text) {
  data = parseGestures(text);
  changed();
}

/** Check a gestures JSON text and return clean data; throws with a reason if it's wrong. */
export function parseGestures(text) {
  const raw = JSON.parse(text);
  if (!raw || raw.version !== 1) throw new Error('not a version 1 gestures file');
  const out = emptyData();

  const s = raw.settings ?? {};
  // a number inside [min, max], otherwise the default
  const num = (v, min, max, fallback) => (Number.isFinite(v) && v >= min && v <= max ? v : fallback);
  out.settings = {
    enabled: typeof s.enabled === 'boolean' ? s.enabled : DEFAULT_SETTINGS.enabled,
    threshold: num(s.threshold, 0.05, 2, DEFAULT_SETTINGS.threshold),
    holdMs: num(s.holdMs, 0, 5000, DEFAULT_SETTINGS.holdMs),
    cooldownMs: num(s.cooldownMs, 0, 10000, DEFAULT_SETTINGS.cooldownMs),
    continuous: typeof s.continuous === 'boolean' ? s.continuous : DEFAULT_SETTINGS.continuous,
  };

  const isNums = (a, len) => Array.isArray(a) && (len == null || a.length === len) && a.every(Number.isFinite);
  for (const [shape, samples] of Object.entries(raw.poses ?? {})) {
    if (!SHAPES.includes(shape)) throw new Error(`unknown shape "${shape}"`);
    if (!Array.isArray(samples) || samples.length > MAX_SAMPLES) throw new Error(`bad samples for ${shape}`);
    out.poses[shape] = samples.map((sm) => {
      const ok = (sm?.hands === 1 || sm?.hands === 2) && Array.isArray(sm.frames) && sm.frames.length > 0;
      // 21 points x (x, y) = 42 numbers per hand
      if (!ok || !sm.frames.every((f) => isNums(f, sm.hands * 42))) throw new Error(`bad sample for ${shape}`);
      return { hands: sm.hands, frames: sm.frames, recordedAt: String(sm.recordedAt ?? '') };
    });
  }

  for (const [action, m] of Object.entries(raw.motions ?? {})) {
    if (!MOTIONS.includes(action)) throw new Error(`unknown motion "${action}"`);
    const t = m?.template;
    const ok =
      Array.isArray(m?.rawFrames) &&
      isNums(m.trim, 2) &&
      t &&
      (t.hands === 1 || t.hands === 2) &&
      Number.isFinite(t.duration) &&
      Number.isFinite(t.delta?.x) &&
      Number.isFinite(t.delta?.spread) &&
      Array.isArray(t.frames) &&
      t.frames.length > 1 &&
      t.frames.every((f) => isNums(f)) &&
      (t.mirrored == null || (Array.isArray(t.mirrored) && t.mirrored.every((f) => isNums(f))));
    if (!ok) throw new Error(`bad motion "${action}"`);
    out.motions[action] = { rawFrames: m.rawFrames, trim: m.trim, template: t };
  }
  return out;
}

// Raw motion frames are stored compactly: { t, h: [{ l: 'L' | 'R', p: [x0, y0, x1, y1, ...] }] }
const r4 = (v) => Math.round(v * 1e4) / 1e4;

/** Full frames -> compact form (short keys, rounded numbers) to save space. */
function packFrames(frames) {
  return frames.map((f) => ({
    t: Math.round(f.t * 1000) / 1000,
    h: f.hands.map((h) => ({ l: h.label[0], p: h.points.flatMap((p) => [r4(p.x), r4(p.y)]) })),
  }));
}

/** Compact form -> full frames again (the reverse of packFrames). */
function unpackFrames(frames) {
  return frames.map((f) => ({
    t: f.t,
    hands: f.h.map((h) => ({
      label: h.l === 'L' ? 'Left' : 'Right',
      points: Array.from({ length: h.p.length / 2 }, (_, i) => ({ x: h.p[2 * i], y: h.p[2 * i + 1] })),
    })),
  }));
}
