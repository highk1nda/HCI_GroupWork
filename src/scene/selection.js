// Which object is selected. Handles clicking objects, the orange highlight box,
// and the move / rotate / scale handles (the "gizmo") you drag with the mouse.
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { scene, camera, renderer, controls } from './viewport.js';
import * as objects from './objects.js';
import { dispatch } from '../intents/dispatcher.js';
import { cloneTransform } from '../types.js';

/** @typedef {'translate'|'rotate'|'scale'} GizmoMode */

/** @type {string | null} */
let selectedId = null;
/** @type {GizmoMode} */
let mode = 'translate';
/** @type {TransformControls} */
let gizmo;
/** @type {THREE.BoxHelper | null} */
let highlight = null;
/** @type {import('../types.js').Transform | null} */
let dragBefore = null;

const listeners = [];
/** Subscribe: fn runs when the selection or gizmo mode changes. @param {() => void} fn */
export function onSelectionChange(fn) {
  listeners.push(fn);
}
const emit = () => listeners.forEach((fn) => fn());

export const get = () => selectedId; // id of the selected object, or null
export const getMode = () => mode; // current gizmo mode

/** Create the gizmo and hook up dragging and click picking. */
export function initSelection() {
  gizmo = new TransformControls(camera, renderer.domElement);
  gizmo.setMode(mode);
  scene.add(gizmo.getHelper());

  gizmo.addEventListener('dragging-changed', (e) => {
    controls.enabled = !e.value; // don't rotate the view while dragging an object
  });
  // One drag = one undo step: snapshot on mouseDown, commit before/after on mouseUp.
  gizmo.addEventListener('mouseDown', () => {
    dragBefore = selectedId ? cloneTransform(objects.toData(selectedId)) : null;
  });
  gizmo.addEventListener('objectChange', () => highlight?.update());
  gizmo.addEventListener('mouseUp', () => {
    if (!selectedId || !dragBefore) return;
    const before = dragBefore;
    dragBefore = null;
    const after = cloneTransform(objects.toData(selectedId));
    dispatch({ type: 'transform', id: selectedId, before, after }, 'mouse');
  });

  objects.onObjectsChange((event, id) => {
    if (event === 'remove' && id === selectedId) set(null);
    if (event === 'update' && id === selectedId) highlight?.update();
  });

  initPicking();
}

/** Click an object to select it; click empty space to deselect. */
function initPicking() {
  const el = renderer.domElement;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  // Shoot a ray from the camera through the mouse; return the id of the first object hit
  const pick = (e) => {
    const rect = el.getBoundingClientRect();
    // mouse pixels -> -1..1 on both axes (y flipped), which is what Three.js expects
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(objects.meshList(), false)[0];
    return hit ? hit.object.userData.id : null;
  };

  // The gizmo's own pointerdown runs first (registered earlier), so gizmo.axis is fresh here.
  let down = null;
  el.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, button: e.button, onGizmo: !!selectedId && gizmo.axis !== null };
  });
  el.addEventListener('pointerup', (e) => {
    const start = down;
    down = null;
    if (!start || start.button !== 0 || e.button !== 0 || start.onGizmo) return;
    // ignore clicks that were really orbit drags
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) return;
    dispatch({ type: 'select', id: pick(e) }, 'mouse');
  });
  el.addEventListener('pointermove', (e) => {
    if (e.buttons || gizmo.dragging) return;
    // hand cursor over objects, normal cursor over the gizmo or empty space
    el.style.cursor = gizmo.axis !== null && selectedId ? '' : pick(e) ? 'pointer' : '';
  });
}

/** Select an object (or null for none): attach the gizmo and draw the highlight box. @param {string | null} id */
export function set(id) {
  if (id && !objects.has(id)) id = null;
  if (id === selectedId) return;
  selectedId = id;

  if (highlight) {
    scene.remove(highlight);
    highlight.dispose();
    highlight = null;
  }
  if (id) {
    const mesh = objects.get(id);
    gizmo.attach(mesh);
    highlight = new THREE.BoxHelper(mesh, 0xff9800);
    scene.add(highlight);
  } else {
    gizmo.detach();
  }
  emit();
}

/** Switch the gizmo between move, rotate and scale (W / E / R). @param {GizmoMode} next */
export function setMode(next) {
  mode = next;
  gizmo.setMode(next);
  emit();
}
