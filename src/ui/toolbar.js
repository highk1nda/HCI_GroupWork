// Top toolbar buttons. Each button only sends an intent or calls save.js.
import { dispatch } from '../intents/dispatcher.js';
import { history } from '../commands/history.js';
import { shapeIcons } from '../scene/presets.js';
import * as save from '../storage/save.js';
import * as objects from '../scene/objects.js';
import { SHAPES, SHAPE_LABELS } from '../types.js';

/** File group (Save / Undo / Redo / Load / New / Clear) and the Models row. */
export function initToolbar() {
  const undoBtn = document.getElementById('btn-undo');
  const redoBtn = document.getElementById('btn-redo');
  const loadInput = /** @type {HTMLInputElement} */ (document.getElementById('load-input'));

  document.getElementById('btn-save').addEventListener('click', () => dispatch({ type: 'save' }, 'mouse'));
  undoBtn.addEventListener('click', () => dispatch({ type: 'undo' }, 'mouse'));
  redoBtn.addEventListener('click', () => dispatch({ type: 'redo' }, 'mouse'));

  document.getElementById('btn-load').addEventListener('click', () => loadInput.click());
  loadInput.addEventListener('change', async () => {
    const file = loadInput.files?.[0];
    loadInput.value = ''; // reset, so picking the same file again still triggers change
    if (file) await save.loadFile(file);
  });

  document.getElementById('btn-new').addEventListener('click', () => {
    if (confirm('Clear the whole scene? This also clears the undo history.')) save.clearScene();
  });

  const clearBtn = document.getElementById('btn-clear');
  clearBtn.addEventListener('click', () => dispatch({ type: 'clear' }, 'mouse'));

  // Grey out buttons that can't do anything right now
  const refresh = () => {
    undoBtn.disabled = !history.canUndo;
    redoBtn.disabled = !history.canRedo;
    clearBtn.disabled = objects.count() === 0;
  };
  history.onChange(refresh);
  objects.onObjectsChange(refresh);
  refresh();

  // One button per shape, with a picture of the real model
  const icons = shapeIcons();
  const row = document.getElementById('model-buttons');
  SHAPES.forEach((shape, n) => {
    const btn = document.createElement('button');
    btn.className = 'model-btn';
    btn.title = `Add ${shape} (${n + 1})`;
    if (icons[shape]) {
      const img = document.createElement('img');
      img.src = icons[shape];
      img.alt = '';
      btn.append(img);
    }
    btn.append(SHAPE_LABELS[shape]);
    btn.addEventListener('click', () => dispatch({ type: 'add', shape }, 'mouse'));
    row.append(btn);
  });
}
