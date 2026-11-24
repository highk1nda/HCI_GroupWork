// Undoable move / rotate / scale for one object.
import * as objects from '../scene/objects.js';
import { cloneTransform, sameVec } from '../types.js';

/** Move / rotate / scale, stored as before/after snapshots. @implements {import('../types.js').Command} */
export class TransformCmd {
  /**
   * @param {string} id
   * @param {import('../types.js').Transform} before
   * @param {import('../types.js').Transform} after
   * @param {import('../types.js').Source} source
   */
  constructor(id, before, after, source) {
    this.id = id;
    this.before = cloneTransform(before);
    this.after = cloneTransform(after);
    this.source = source;
    // name it by what actually changed: scale wins over rotate, rotate over move
    const verb = !sameVec(before.scale, after.scale)
      ? 'Scale'
      : !sameVec(before.rotation, after.rotation)
        ? 'Rotate'
        : 'Move';
    this.label = `${verb} ${objects.toData(id).shape}`;
    this.targetId = id;
  }

  /** Put the object in its "after" pose. */
  do() {
    objects.apply(this.id, this.after);
  }

  /** Put it back in its "before" pose. */
  undo() {
    objects.apply(this.id, this.before);
  }
}
