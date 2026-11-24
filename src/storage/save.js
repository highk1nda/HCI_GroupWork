import * as objects from '../scene/objects.js';
import * as selection from '../scene/selection.js';
import { history } from '../commands/history.js';
import { toast } from '../ui/statusBar.js';
import { SHAPES } from '../types.js';

// Saving and loading: autosave in the browser, download / upload of scene.json, New scene.
// Save the scene, not the history: the format stays tiny and stable.
const STORAGE_KEY = 'demo3d.scene';

/** The scene as a saveable object. */
export function serialize() {
  return { version: 1, objects: objects.all() };
}

/** Autosave to localStorage (called on every history change). */
export function toLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize()));
  } catch {
    // storage blocked or full: the editor keeps working without autosave
  }
}

/** Restore the autosaved scene on page load. Returns true if anything was restored. */
export function restore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    replaceScene(validate(JSON.parse(raw)));
    return objects.count() > 0;
  } catch (err) {
    console.warn('Ignoring unreadable autosave', err);
    return false;
  }
}

/** Save button / Ctrl+S: autosave now and download scene.json. */
export function saveScene() {
  toLocal();
  // make a temporary file link in memory and "click" it to start the download
  const blob = new Blob([JSON.stringify(serialize(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'scene.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Saved · scene.json downloaded');
}

/** Load button: clear scene, rebuild from file, clear history. @param {File} file */
export async function loadFile(file) {
  try {
    const list = validate(JSON.parse(await file.text()));
    replaceScene(list);
    history.clear();
    toLocal();
    toast(`Loaded ${file.name} · ${list.length} object${list.length === 1 ? '' : 's'}`);
  } catch (err) {
    console.warn(err);
    toast(`Couldn't load ${file.name}: ${err.message}`);
  }
}

/** New button: empty scene, empty history. */
export function clearScene() {
  replaceScene([]);
  history.clear();
  toLocal();
}

/** Throw away the current objects and build the given ones. */
function replaceScene(list) {
  selection.set(null);
  objects.clear();
  list.forEach(objects.create);
}

/** Check a loaded file is a real scene; throw with a reason if not. @returns {import('../types.js').SceneObject[]} */
function validate(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.objects)) {
    throw new Error('not a version 1 scene file');
  }
  const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  const ids = new Set(); // to catch duplicate ids
  return data.objects.map((o, n) => {
    const ok =
      o &&
      typeof o.id === 'string' &&
      !ids.has(o.id) &&
      SHAPES.includes(o.shape) &&
      isVec3(o.position) &&
      isVec3(o.rotation) &&
      isVec3(o.scale) &&
      /^#[0-9a-f]{6}$/i.test(o.color);
    if (!ok) throw new Error(`object ${n + 1} is invalid`);
    ids.add(o.id);
    return {
      id: o.id,
      shape: o.shape,
      position: o.position,
      rotation: o.rotation,
      scale: o.scale,
      color: o.color.toLowerCase(),
    };
  });
}
