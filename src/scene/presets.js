// The shape "recipes": how each shape is built in Three.js, its material,
// and the little preview pictures used on buttons.
import * as THREE from 'three';
import { SHAPES } from '../types.js';

/** Geometries are shared between meshes (materials are not), so build each shape once. */
const cache = new Map();

/** Make a fresh geometry for a shape. @param {import('../types.js').Shape} shape */
function build(shape) {
  switch (shape) {
    case 'cube':
      return new THREE.BoxGeometry(1, 1, 1);
    case 'sphere':
      return new THREE.SphereGeometry(0.5, 32, 16);
    case 'cone':
      return new THREE.ConeGeometry(0.5, 1, 32);
    case 'cylinder':
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
    case 'rod':
      return new THREE.CylinderGeometry(0.08, 0.08, 1.5, 16);
    case 'heart': {
      // draw a flat 2D heart outline with 4 curves, then extrude it to give it depth
      const h = new THREE.Shape();
      h.moveTo(0, 0.5);
      h.bezierCurveTo(0, 0.8, -0.5, 0.8, -0.5, 0.4);
      h.bezierCurveTo(-0.5, 0.1, 0, -0.1, 0, -0.5);
      h.bezierCurveTo(0, -0.1, 0.5, 0.1, 0.5, 0.4);
      h.bezierCurveTo(0.5, 0.8, 0, 0.8, 0, 0.5);
      return new THREE.ExtrudeGeometry(h, {
        depth: 0.3,
        bevelEnabled: true,
        bevelSize: 0.05,
        bevelThickness: 0.05,
        curveSegments: 24,
      }).center();
    }
    default:
      throw new Error(`Unknown shape: ${shape}`);
  }
}

/** The shared geometry for a shape, built on first use. @param {import('../types.js').Shape} shape @returns {THREE.BufferGeometry} */
export function geometryFor(shape) {
  if (!cache.has(shape)) {
    const geometry = build(shape);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    cache.set(shape, geometry);
  }
  return cache.get(shape);
}

/** Height to lift a new object by so it sits on the grid. */
export function restHeight(shape) {
  // shapes are centered on 0, so the bottom is below the floor; lift by that much
  return -geometryFor(shape).boundingBox.min.y;
}

/** A new material per object, so recoloring one doesn't recolor others. */
export function createMaterial(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 });
}

let iconCache = null; // icons are made once, then reused

/** Shape icons, rendered once and shared (toolbar, Hand settings, gesture ring). */
export function shapeIcons() {
  return (iconCache ??= renderIcons());
}

/**
 * Render each preset once with a small offscreen renderer and return data URLs,
 * so toolbar icons always match the real models.
 * @returns {Partial<Record<import('../types.js').Shape, string>>}
 */
export function renderIcons(color = '#8d97a8') {
  const icons = {};
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(64, 64, false);

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a80, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(3, 6, 5);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
    camera.position.set(2.2, 1.7, 3.2);
    camera.lookAt(0, 0, 0);

    const material = createMaterial(color);
    for (const shape of SHAPES) {
      const geometry = geometryFor(shape);
      const mesh = new THREE.Mesh(geometry, material);
      // scale every shape to the same size and center it, so all icons look evenly framed
      const center = geometry.boundingSphere.center;
      const fit = 0.95 / geometry.boundingSphere.radius;
      mesh.scale.setScalar(fit);
      mesh.position.copy(center).multiplyScalar(-fit);
      scene.add(mesh);
      renderer.render(scene, camera);
      icons[shape] = renderer.domElement.toDataURL('image/png');
      scene.remove(mesh);
    }
    material.dispose();
  } catch (err) {
    console.warn('Icon rendering failed, falling back to text buttons', err);
  } finally {
    renderer?.dispose();
    renderer?.forceContextLoss();
  }
  return icons;
}
