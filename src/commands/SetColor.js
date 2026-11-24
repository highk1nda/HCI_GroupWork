// Undoable recolor. Stores both colors, so do/undo just swap between them.
import * as objects from '../scene/objects.js';

/** @implements {import('../types.js').Command} */
export class SetColor {
  /**
   * @param {string} id
   * @param {string} oldColor
   * @param {string} newColor
   * @param {import('../types.js').Source} source
   */
  constructor(id, oldColor, newColor, source) {
    this.id = id;
    this.oldColor = oldColor;
    this.newColor = newColor;
    this.source = source;
    this.label = 'Change color';
    this.targetId = id;
    this.swatch = newColor;
  }

  /** Paint the new color. */
  do() {
    objects.setColor(this.id, this.newColor);
  }

  /** Paint the old color back. */
  undo() {
    objects.setColor(this.id, this.oldColor);
  }
}
