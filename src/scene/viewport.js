// The 3D view itself: renderer, camera, lights, floor grid, the draw loop,
// zoom / orbit / focus, and the small XYZ axes in the corner.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** Camera distance that reads as 100% in the zoom bar. */
export const START_DISTANCE = 12;
const MIN_DISTANCE = 2;
const MAX_DISTANCE = 40;

export const scene = new THREE.Scene();
/** @type {THREE.WebGLRenderer} */
export let renderer;
/** @type {THREE.PerspectiveCamera} */
export let camera;
/** @type {OrbitControls} */
export let controls;

let container;
/** @type {{ target: THREE.Vector3, position: THREE.Vector3 } | null} */
let focusGoal = null;
let orbitLeft = 0; // radians of orbit still to glide through
const UP = new THREE.Vector3(0, 1, 0);

/** Set up the renderer, camera, controls, lights and grid inside `el`, then start drawing. @param {HTMLElement} el */
export function initViewport(el) {
  container = el;

  // alpha now, so the camera feed can go behind the scene later
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  el.prepend(renderer.domElement);

  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
  const target = new THREE.Vector3(0, 0.5, 0);
  camera.position.copy(target).add(new THREE.Vector3(1, 0.75, 1.35).setLength(START_DISTANCE));

  // LMB drag = rotate view, wheel = zoom, RMB = pan (OrbitControls defaults)
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.minDistance = MIN_DISTANCE;
  controls.maxDistance = MAX_DISTANCE;
  controls.maxPolarAngle = Math.PI * 0.495; // stop just above the floor, can't look from underneath
  controls.update();

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a80, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(5, 10, 7);
  scene.add(sun);

  // Grid center lines match the grid so the red X / blue Z lines read clearly on the floor
  scene.add(new THREE.GridHelper(20, 20, 0xc4c2ba, 0xc9c7c0));
  scene.add(floorLine([-10, 0, 0], [10, 0, 0], 0xe53935));
  scene.add(floorLine([0, 0, -10], [0, 0, 10], 0x1e88e5));

  initAxesGizmo();
  resize();
  new ResizeObserver(resize).observe(el);
  requestAnimationFrame(tick);
}

/** A colored line lying on the floor from point a to point b. */
function floorLine(a, b, color) {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(a[0], 0.002, a[2]),
    new THREE.Vector3(b[0], 0.002, b[2]),
  ]);
  return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color }));
}

/** Match the canvas and camera to the workspace size. */
function resize() {
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

/** Runs every frame: glide the camera if focusing, update controls, draw. */
function tick() {
  requestAnimationFrame(tick);

  if (orbitLeft !== 0) {
    // glide: turn a quarter of what's left each frame (all of it once it's tiny)
    const step = Math.abs(orbitLeft) < 0.002 ? orbitLeft : orbitLeft * 0.25;
    orbitLeft -= step;
    // spin the camera's offset from the center around the vertical axis
    const offset = camera.position.clone().sub(controls.target).applyAxisAngle(UP, step);
    camera.position.copy(controls.target).add(offset);
  }

  if (focusGoal) {
    // move 20% of the way each frame: fast at first, then eases in
    controls.target.lerp(focusGoal.target, 0.2);
    camera.position.lerp(focusGoal.position, 0.2);
    if (camera.position.distanceTo(focusGoal.position) < 0.01) focusGoal = null;
  }
  controls.update();

  renderer.render(scene, camera);
  renderAxesGizmo();
}

// ---------- zoom bar ----------

/** Zoom shown in the bar: closer camera = bigger %. */
export function zoomPercent() {
  return Math.round((START_DISTANCE / camera.position.distanceTo(controls.target)) * 100);
}

/** Move the camera along its view direction. factor < 1 zooms in. */
export function zoomBy(factor) {
  focusGoal = null;
  const offset = camera.position.clone().sub(controls.target);
  const distance = THREE.MathUtils.clamp(offset.length() * factor, MIN_DISTANCE, MAX_DISTANCE);
  camera.position.copy(controls.target).add(offset.setLength(distance));
  controls.update();
}

/**
 * Turn the camera around the scene's center, smoothly. Positive = the same way as
 * dragging the mouse to the left with the left button.
 */
export function orbitBy(degrees) {
  focusGoal = null;
  orbitLeft += THREE.MathUtils.degToRad(degrees);
}

/** Call `fn` with the new zoom % whenever the camera moves. @param {(percent: number) => void} fn */
export function onZoomChange(fn) {
  controls.addEventListener('change', () => fn(zoomPercent()));
  fn(zoomPercent());
}

/** Glide the camera so the object fills the view (F key). @param {THREE.Object3D} object */
export function focusOn(object) {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  const distance = THREE.MathUtils.clamp(size * 2.2, MIN_DISTANCE + 0.5, MAX_DISTANCE);
  // keep looking from the same side, just closer / farther
  const direction = camera.position.clone().sub(controls.target).normalize();
  focusGoal = {
    target: center,
    position: center.clone().add(direction.multiplyScalar(distance)),
  };
}

// ---------- XYZ axes gizmo, bottom-left corner ----------

const AXES_SIZE = 96;
const AXES_MARGIN = 10;
const axesScene = new THREE.Scene();
const axesCamera = new THREE.OrthographicCamera(-1.7, 1.7, 1.7, -1.7, 0.1, 10);

/** Build the mini scene: three colored arrows with X, Y, Z labels. */
function initAxesGizmo() {
  const axes = [
    { dir: new THREE.Vector3(1, 0, 0), color: '#e53935', label: 'X' },
    { dir: new THREE.Vector3(0, 1, 0), color: '#43a047', label: 'Y' },
    { dir: new THREE.Vector3(0, 0, 1), color: '#1e88e5', label: 'Z' },
  ];
  const up = new THREE.Vector3(0, 1, 0);
  for (const { dir, color, label } of axes) {
    const material = new THREE.MeshBasicMaterial({ color });
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 8), material);
    stem.quaternion.setFromUnitVectors(up, dir); // cylinder points up by default: turn it to this axis
    stem.position.copy(dir).multiplyScalar(0.5);
    axesScene.add(stem);

    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(label, color) }));
    sprite.position.copy(dir).multiplyScalar(1.35);
    sprite.scale.setScalar(0.62);
    axesScene.add(sprite);
  }
  axesScene.add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), new THREE.MeshBasicMaterial({ color: 0x777777 })));
}

/** Draw a letter in a colored circle and turn it into a texture. */
function labelTexture(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(32, 32, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 32, 34);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Draw the mini axes into a small square in the bottom-left, turned like the main camera. */
function renderAxesGizmo() {
  // the mini camera copies the main camera's angle, so the arrows turn with the view
  axesCamera.quaternion.copy(camera.quaternion);
  axesCamera.position.set(0, 0, 5).applyQuaternion(camera.quaternion);

  // draw on top of the main picture, limited to a small square, then restore the full view
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.setScissorTest(true);
  renderer.setScissor(AXES_MARGIN, AXES_MARGIN, AXES_SIZE, AXES_SIZE);
  renderer.setViewport(AXES_MARGIN, AXES_MARGIN, AXES_SIZE, AXES_SIZE);
  renderer.render(axesScene, axesCamera);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, container.clientWidth, container.clientHeight);
  renderer.autoClear = true;
}
