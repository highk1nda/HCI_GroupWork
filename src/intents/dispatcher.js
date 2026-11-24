// Central switchboard: every input says WHAT it wants (an intent), and this file decides
// HOW it happens. Scene changes become undoable commands; camera moves are done directly.
import { history } from '../commands/history.js';
import { AddObject } from '../commands/AddObject.js';
import { DeleteObject } from '../commands/DeleteObject.js';
import { TransformCmd } from '../commands/Transform.js';
import { SetColor } from '../commands/SetColor.js';
import { ClearAll } from '../commands/ClearAll.js';
import * as objects from '../scene/objects.js';
import * as selection from '../scene/selection.js';
import * as save from '../storage/save.js';
import { zoomBy, orbitBy } from '../scene/viewport.js';
import { sameTransform } from '../types.js';

/**
 * Intent -> Command. The ONLY function that creates commands; every input
 * (mouse, keyboard, later voice and gesture) goes through here.
 * select, zoom, orbit, undo, redo and save are handled directly and don't enter history.
 * @param {import('../types.js').Intent} i
 * @param {import('../types.js').Source} source
 */
export function dispatch(i, source) {
  switch (i.type) {
    case 'add': {
      const data = objects.newData(i.shape, i.color);
      history.execute(new AddObject(data, source));
      return selection.set(data.id);
    }
    case 'delete':
      if (!objects.has(i.id)) return;
      return history.execute(new DeleteObject(objects.toData(i.id), source));
    case 'transform':
      // skip "changes" that didn't move anything, so a plain click doesn't fill the history
      if (!objects.has(i.id) || sameTransform(i.before, i.after)) return;
      return history.execute(new TransformCmd(i.id, i.before, i.after, source));
    case 'setColor': {
      if (!objects.has(i.id)) return;
      const oldColor = objects.toData(i.id).color;
      const newColor = i.color.toLowerCase();
      if (oldColor === newColor) return;
      return history.execute(new SetColor(i.id, oldColor, newColor, source));
    }
    case 'clear':
      if (!objects.count()) return;
      return history.execute(new ClearAll(objects.all(), source));
    case 'select':
      return selection.set(i.id);
    case 'zoom': // camera, not the scene: no history
      return zoomBy(1 / i.factor); // intent factor >1 = closer, zoomBy wants <1 for closer, so flip it
    case 'orbit':
      return orbitBy(i.degrees);
    case 'undo':
      return history.undo();
    case 'redo':
      return history.redo();
    case 'save':
      return save.saveScene();
  }
}
