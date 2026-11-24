// Undoable "clear workspace". Saves every object first so undo can put them all back.
import * as objects from '../scene/objects.js';

/** Remove every object in one undoable step. @implements {import('../types.js').Command} */
export class ClearAll {
  /** @param {import('../types.js').SceneObject[]} list @param {import('../types.js').Source} source */
  constructor(list, source) {
    this.list = structuredClone(list);
    this.source = source;
    this.label = 'Clear workspace';
    this.targetId = `${list.length} object${list.length === 1 ? '' : 's'}`;
  }

  /** Remove every saved object. */
  do() {
    for (const data of this.list) objects.remove(data.id);
  }

  /** Rebuild them all from the saved data. */
  undo() {
    for (const data of this.list) objects.create(data);
  }
}
