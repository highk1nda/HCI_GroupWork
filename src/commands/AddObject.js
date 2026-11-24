// Undoable "add a shape". Keeps a copy of the object's data so redo can rebuild it.
import * as objects from '../scene/objects.js';

/** @implements {import('../types.js').Command} */
export class AddObject {
  /** @param {import('../types.js').SceneObject} data @param {import('../types.js').Source} source */
  constructor(data, source) {
    this.data = structuredClone(data);
    this.source = source;
    this.label = `Add ${data.shape}`;
    this.targetId = data.id;
    this.swatch = data.color;
  }

  /** Put the object in the scene. */
  do() {
    objects.create(this.data);
  }

  /** Take it out again. */
  undo() {
    objects.remove(this.data.id);
  }
}
