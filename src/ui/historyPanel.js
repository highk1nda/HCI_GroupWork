// "Past actions" list on the side: shows the undo history and lets you jump back.
import { history } from '../commands/history.js';
import { dispatch } from '../intents/dispatcher.js';
import { SOURCE_ICONS, SOURCE_NAMES } from './icons.js';

/**
 * Past actions: undo-stack entries as rows, latest highlighted, redo-stack entries greyed below.
 * Clicking a row undoes or redoes until that entry is the latest.
 */
export function initHistoryPanel() {
  const list = document.getElementById('history-list');

  // Rebuild the whole list from the two history stacks
  const render = () => {
    list.replaceChildren();
    const done = history.undoStack;
    const undone = [...history.redoStack].reverse(); // next redo first

    if (!done.length && !undone.length) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'Actions you take show up here. Click one to jump back to it.';
      list.append(empty);
      return;
    }

    list.append(row({ label: 'Start', source: null }, 'start', () => jumpTo(0)));
    done.forEach((cmd, i) => {
      const latest = i === done.length - 1;
      list.append(row(cmd, latest ? 'latest' : '', () => jumpTo(i + 1)));
    });
    undone.forEach((cmd, j) => {
      list.append(
        row(cmd, 'redo', () => {
          // redo everything up to and including this row
          for (let k = 0; k <= j; k++) dispatch({ type: 'redo' }, 'mouse');
        }),
      );
    });

    list.querySelector('.latest')?.scrollIntoView({ block: 'nearest' });
  };

  history.onChange(render);
  render();
}

/** Undo until only `length` actions are left. */
function jumpTo(length) {
  while (history.undoStack.length > length) dispatch({ type: 'undo' }, 'mouse');
}

/** Build one list row: source icon, label, object id, color dot. @param {{label: string, source: string | null, targetId?: string, swatch?: string}} cmd */
function row(cmd, className, onClick) {
  const li = document.createElement('li');
  if (className) li.className = className;
  const btn = document.createElement('button');
  btn.type = 'button';

  if (cmd.source) {
    const icon = document.createElement('span');
    icon.className = 'src';
    icon.title = SOURCE_NAMES[cmd.source];
    icon.innerHTML = SOURCE_ICONS[cmd.source];
    btn.append(icon);
  }

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = cmd.label;
  if (cmd.targetId) {
    const target = document.createElement('span');
    target.className = 'target';
    target.textContent = cmd.targetId;
    label.append(target);
  }
  btn.append(label);

  if (cmd.swatch) {
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = cmd.swatch;
    btn.append(dot);
  }

  if (className === 'redo') btn.title = 'Undone: click to redo up to here';
  else if (className === 'start') btn.title = 'Undo everything';
  btn.addEventListener('click', onClick);
  li.append(btn);
  return li;
}
