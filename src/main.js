// Boot: create scene, UI, history, wire inputs.
import { initViewport, onZoomChange, zoomBy } from './scene/viewport.js';
import { initSelection, onSelectionChange, getMode, get as getSelected } from './scene/selection.js';
import * as objects from './scene/objects.js';
import { history } from './commands/history.js';
import { dispatch } from './intents/dispatcher.js';
import * as save from './storage/save.js';
import * as camera from './input/camera.js';
import { initStatusBar, setBaseStatus, flashStatus, setZoom } from './ui/statusBar.js';
import { initToolbar } from './ui/toolbar.js';
import { initPalette } from './ui/palette.js';
import { initHistoryPanel } from './ui/historyPanel.js';
import { initInputMode } from './ui/inputMode.js';
import { initShortcuts } from './input/mouseKeyboard.js';
import * as gestureStore from './input/gestures/store.js';
import * as recognizer from './input/gestures/recognizer.js';
import { initHandSettings } from './ui/handSettings.js';
import { initGestureOverlay } from './ui/gestureOverlay.js';
import { initChatPanel } from './ui/chatPanel.js';

const MODE_NAMES = { translate: 'Move', rotate: 'Rotate', scale: 'Scale' };

initStatusBar();
initViewport(document.getElementById('workspace'));
initSelection();
initToolbar();
initPalette();
initHistoryPanel();
initChatPanel();
initInputMode();
initShortcuts();

// Gestures: every camera frame goes to the recognizer (or the recorder while recording)
gestureStore.initStore();
camera.onHandsFrame(recognizer.onFrame);
initHandSettings();
initGestureOverlay();

// Zoom bar: − / + buttons and the wheel both update the %
onZoomChange(setZoom);
document.getElementById('zoom-in').addEventListener('click', () => zoomBy(1 / 1.25));
document.getElementById('zoom-out').addEventListener('click', () => zoomBy(1.25));

// Status text: selection + gizmo mode (the mockup has no mode buttons, so W/E/R is shown here)
const refreshStatus = () => {
  const id = getSelected();
  const mode = `Gizmo: ${MODE_NAMES[getMode()]} · W move · E rotate · R scale`;
  setBaseStatus(id ? `Selected ${id} · ${mode} · F focus · Del delete` : `Nothing selected · click an object · ${mode}`);
};
onSelectionChange(refreshStatus);
refreshStatus();

history.onChange(({ kind, command }) => {
  if (kind === 'undo') flashStatus(`Undid: ${command.label}`);
  if (kind === 'redo') flashStatus(`Redid: ${command.label}`);
});

// Empty-scene start hint
const hint = document.getElementById('start-hint');
const refreshHint = () => hint.classList.toggle('hidden', objects.count() > 0);
objects.onObjectsChange(refreshHint);

// Restore the autosave, then autosave on every history change
save.restore();
history.onChange(save.toLocal);
refreshHint();

// Handy in the console while developing, and for later inputs
window.demo = { dispatch, objects, history, camera, gestureStore, recognizer };
