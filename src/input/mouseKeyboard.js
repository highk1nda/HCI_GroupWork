// Keyboard shortcuts: Ctrl+Z / Y / S, 1-6 add shapes, W/E/R gizmo mode, Del, Esc, F focus.
import { dispatch } from '../intents/dispatcher.js';
import * as selection from '../scene/selection.js';
import * as objects from '../scene/objects.js';
import { focusOn } from '../scene/viewport.js';
import { SHAPES } from '../types.js';

const MODE_KEYS = { w: 'translate', e: 'rotate', r: 'scale' };

/** Shortcuts never fire while focus is in a text field. */
function isTyping(target) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches('input, textarea, select, [role="textbox"]'))
  );
}

/** Listen for keys and turn each shortcut into an intent. */
export function initShortcuts() {
  window.addEventListener('keydown', (e) => {
    if (isTyping(e.target) || document.querySelector('dialog[open]')) return; // not while a dialog is open
    const key = e.key.toLowerCase();

    if (e.ctrlKey || e.metaKey) {
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        dispatch({ type: 'undo' }, 'keyboard');
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        dispatch({ type: 'redo' }, 'keyboard');
      } else if (key === 's') {
        e.preventDefault(); // not the browser's save dialog
        dispatch({ type: 'save' }, 'keyboard');
      }
      return;
    }
    if (e.altKey) return;

    const shapeIndex = Number(e.key) - 1; // key "1" -> first shape (cube), "2" -> sphere, ...
    if (SHAPES[shapeIndex] && !e.repeat) {
      dispatch({ type: 'add', shape: SHAPES[shapeIndex] }, 'keyboard');
      return;
    }

    const id = selection.get();
    if (MODE_KEYS[key]) {
      selection.setMode(MODE_KEYS[key]);
    } else if ((key === 'delete' || key === 'backspace') && id) {
      e.preventDefault();
      dispatch({ type: 'delete', id }, 'keyboard');
    } else if (key === 'escape') {
      dispatch({ type: 'select', id: null }, 'keyboard');
    } else if (key === 'f' && id) {
      focusOn(objects.get(id));
    }
  });
}
