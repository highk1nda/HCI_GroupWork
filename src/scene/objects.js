// All the 3D objects in the scene. Turns plain data into Three.js meshes and back,
// and tells the rest of the app when something was added, removed or changed.
import * as THREE from 'three';
import { scene } from './viewport.js';
import { geometryFor, restHeight, createMaterial } from './presets.js';

/** Registry: id -> mesh. Commands only call these functions, so undo can rebuild from plain data. */
/** @type {Map<string, THREE.Mesh>} */
const meshes = new Map();
/** Per-shape id counters: cube-1, cube-2 ... */
const counters = {};
let defaultColor = '#1e88e5';

/** @typedef {'add'|'remove'|'update'|'clear'} ObjectsEvent */
/** @type {((event: ObjectsEvent, id: string | null) => void)[]} */
const listeners = [];

/** Subscribe to changes: fn(event, id) runs after every add/remove/update/clear. */
export function onObjectsChange(fn) {
  listeners.push(fn);
}

/** Tell every subscriber what changed. */
function emit(event, id) {
  for (const fn of listeners) fn(event, id);
}

export const has = (id) => meshes.has(id); // does this id exist?
export const get = (id) => meshes.get(id); // the mesh for an id
export const count = () => meshes.size; // how many objects
export const meshList = () => [...meshes.values()]; // all meshes (for click picking)

export const getDefaultColor = () => defaultColor; // color new objects get
/** Color for the next new object (palette click with nothing selected). */
export function setDefaultColor(color) {
  defaultColor = color;
  emit('update', null);
}

/**
 * Data for a new object: next id for the shape, sitting on the grid,
 * offset if something already stands at the origin.
 * @param {import('../types.js').Shape} shape
 * @param {string} [color]
 * @returns {import('../types.js').SceneObject}
 */
export function newData(shape, color) {
  const n = (counters[shape] ?? 0) + 1;
  counters[shape] = n;
  return {
    id: `${shape}-${n}`,
    shape,
    position: spawnPosition(shape),
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: (color ?? defaultColor).toLowerCase(),
  };
}

/** Closest free floor spot to the center, checked in rings 1.5 units apart. */
function spawnPosition(shape) {
  const y = restHeight(shape);
  const taken = meshList().map((m) => m.position);
  const step = 1.5;
  // ring 0 = the center, ring 1 = the 8 spots around it, ring 2 = the next square out, ...
  for (let ring = 0; ring < 10; ring++) {
    const spots = [];
    for (let i = -ring; i <= ring; i++) {
      for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) === ring) spots.push([i * step, j * step]); // only the edge of the square
      }
    }
    // try the spots closest to the center first (ties: right side first)
    spots.sort((a, b) => Math.hypot(...a) - Math.hypot(...b) || b[0] - a[0]);
    for (const [x, z] of spots) {
      // free = no object within 1.1 units on the floor
      if (taken.every((p) => Math.hypot(p.x - x, p.z - z) > 1.1)) return [x, y, z];
    }
  }
  return [0, y, 0];
}

/** Build a mesh from plain data and add it to the scene. @param {import('../types.js').SceneObject} data */
export function create(data) {
  if (meshes.has(data.id)) remove(data.id);
  const mesh = new THREE.Mesh(geometryFor(data.shape), createMaterial(data.color));
  mesh.userData = { id: data.id, shape: data.shape };
  mesh.position.fromArray(data.position);
  mesh.rotation.fromArray([...data.rotation, 'XYZ']);
  mesh.scale.fromArray(data.scale);
  scene.add(mesh);
  meshes.set(data.id, mesh);

  // keep counters ahead of any id we see (redo, restore, load)
  const n = Number(data.id.split('-').pop());
  if (Number.isFinite(n)) counters[data.shape] = Math.max(counters[data.shape] ?? 0, n);

  emit('add', data.id);
}

/** Take an object out of the scene and free its material. */
export function remove(id) {
  const mesh = meshes.get(id);
  if (!mesh) return;
  scene.remove(mesh);
  /** @type {THREE.Material} */ (mesh.material).dispose(); // geometry is shared, keep it
  meshes.delete(id);
  emit('remove', id);
}

/** Remove everything and reset id counters (load / new scene). */
export function clear() {
  for (const id of [...meshes.keys()]) remove(id);
  for (const key of Object.keys(counters)) delete counters[key];
  emit('clear', null);
}

/** Read a mesh back into plain data (the reverse of create). @returns {import('../types.js').SceneObject} */
export function toData(id) {
  const mesh = meshes.get(id);
  if (!mesh) throw new Error(`No object ${id}`);
  const round = (v) => Math.round(v * 1e5) / 1e5; // cut float noise like 0.30000000004
  return {
    id,
    shape: mesh.userData.shape,
    position: mesh.position.toArray().map(round),
    rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z].map(round),
    scale: mesh.scale.toArray().map(round),
    color: '#' + /** @type {THREE.MeshStandardMaterial} */ (mesh.material).color.getHexString(),
  };
}

/** Every object as plain data (used for saving). @returns {import('../types.js').SceneObject[]} */
export function all() {
  return [...meshes.keys()].map(toData);
}

/** Set an object's position, rotation and scale. @param {string} id @param {import('../types.js').Transform} t */
export function apply(id, t) {
  const mesh = meshes.get(id);
  if (!mesh) return;
  mesh.position.fromArray(t.position);
  mesh.rotation.set(t.rotation[0], t.rotation[1], t.rotation[2]);
  mesh.scale.fromArray(t.scale);
  emit('update', id);
}

/** Repaint an object. */
export function setColor(id, color) {
  const mesh = meshes.get(id);
  if (!mesh) return;
  /** @type {THREE.MeshStandardMaterial} */ (mesh.material).color.set(color);
  emit('update', id);
}
