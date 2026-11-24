// Color swatches in the toolbar.
import { dispatch } from '../intents/dispatcher.js';
import * as objects from '../scene/objects.js';
import * as selection from '../scene/selection.js';
import { flashStatus } from './statusBar.js';
import { PALETTE } from '../types.js';

/**
 * Fixed 8 swatches. With a selection: setColor intent.
 * With nothing selected: default color for the next added object (no history entry).
 */
export function initPalette() {
  const row = document.getElementById('swatches');
  const buttons = PALETTE.map(({ name, hex }) => {
    const btn = document.createElement('button');
    btn.className = `swatch ${name}`;
    btn.style.background = hex;
    btn.title = name[0].toUpperCase() + name.slice(1);
    btn.setAttribute('aria-label', name);
    btn.addEventListener('click', () => {
      const id = selection.get();
      if (id) {
        dispatch({ type: 'setColor', id, color: hex }, 'mouse');
      } else {
        objects.setDefaultColor(hex);
        flashStatus(`New objects will be ${name}`);
      }
    });
    row.append(btn);
    return { btn, hex };
  });

  // Ring around the swatch matching the selected object (or the default color when nothing is selected).
  const refresh = () => {
    const id = selection.get();
    const current = id && objects.has(id) ? objects.toData(id).color : objects.getDefaultColor();
    for (const { btn, hex } of buttons) {
      const active = hex === current;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
  };
  selection.onSelectionChange(refresh);
  objects.onObjectsChange(refresh);
  refresh();
}
