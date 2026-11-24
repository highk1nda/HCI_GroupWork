// Undoable "delete one object". Keeps its data so undo can rebuild it as it was.
import * as objects from '../scene/objects.js';

/** @implements {import('../types.js').Command} */
export class DeleteObject {
  /** @param {import('../types.js').SceneObject} data @param {import('../types.js').Source} source */
  constructor(data, source) {
    this.data = structuredClone(data);
    this.source = source;
    this.label = `Delete ${data.shape}`;
    this.targetId = data.id;
  }

  /** Remove the object. */
  do() {
    objects.remove(this.data.id);
  }

  /** Rebuild it from the saved data. */
  undo() {
    objects.create(this.data);
  }
}
