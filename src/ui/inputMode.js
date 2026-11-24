// Input mode buttons (M+K / Mic / Cam / Both): switches how you control the editor.
import * as voice from '../input/voice.js';
import * as camera from '../input/camera.js';
import { FEATURES } from '../config.js';
import { toast } from './statusBar.js';
import { openChat, setSpacePushToTalk } from './chatPanel.js';

/**
 * Input group: Mouse and keyboard always works. Cam opens the camera source picker.
 * Mic opens the AI chat and turns on Space push-to-talk (needs FEATURES.voice + .ai).
 * Mic + cam ("Both") is still a dummy. Each mode's start() resolves true when ready.
 */
const MODES = [
  { id: 'mk', label: 'M+K', title: 'Mouse and keyboard', enabled: () => true, start: async () => true },
  {
    id: 'mic',
    label: 'Mic',
    title: 'Voice commands to the AI assistant',
    enabled: () => FEATURES.voice && FEATURES.ai,
    start: async () => {
      if (!(FEATURES.voice && FEATURES.ai)) return toast('Voice mode coming soon');
      openChat();
      if (!voice.isSupported()) {
        toast("This browser can't do speech recognition. Type in the AI chat instead.");
        return false;
      }
      setSpacePushToTalk(true);
      toast('Mic mode: hold Space (or the mic button) and speak');
      return true;
    },
  },
  { id: 'cam', label: 'Cam', title: 'Webcam hand tracking', enabled: () => FEATURES.camera, start: () => camera.start() },
  // dummy until Mic + cam is designed (voice acting on what the hands do)
  { id: 'both', label: 'Both', title: 'Mic and cam', enabled: () => false, start: async () => toast('Mic + webcam mode coming soon') },
];

let current = 'mk'; // active mode id
let select = (id) => {}; // replaced in initInputMode once the buttons exist

/**
 * Switch to an input mode, as if its button was clicked. Resolves true when that mode is on.
 * Cam while already in Cam reopens the camera picker (to switch cameras).
 */
export async function activateMode(id) {
  const mode = MODES.find((m) => m.id === id);
  if (!mode.enabled()) {
    await mode.start(); // dummy: shows its toast
    return false;
  }
  if (mode.id === current && mode.id !== 'cam') return true;
  if (await mode.start()) {
    select(mode.id);
    return true;
  }
  return false;
}

/** Draw the Input buttons and switch modes when they're clicked. */
export function initInputMode() {
  const row = document.getElementById('input-buttons');
  const buttons = MODES.map((mode) => {
    const btn = document.createElement('button');
    btn.textContent = mode.label;
    btn.title = mode.enabled() ? mode.title : `${mode.title} (coming soon)`;
    btn.className = 'input-btn' + (mode.enabled() ? '' : ' dummy');
    btn.setAttribute('role', 'radio');
    btn.addEventListener('click', () => activateMode(mode.id));
    row.append(btn);
    return { btn, mode };
  });

  // Highlight the active mode; leaving Cam stops the camera, leaving Mic stops Space push-to-talk
  select = (id) => {
    if (current === 'cam' && id !== 'cam') camera.stop();
    if (current === 'mic' && id !== 'mic') setSpacePushToTalk(false);
    current = id;
    for (const { btn, mode } of buttons) {
      btn.classList.toggle('active', mode.id === current);
      btn.setAttribute('aria-checked', String(mode.id === current));
    }
  };
  select(current);

  // Camera stopped by itself (error, unplugged): fall back to Mouse + keyboard
  camera.onCameraEnd(() => select('mk'));

  // Mic / webcam option panel in the workspace corner: greyed dummy for now
  document.getElementById('option-panel').addEventListener('click', () => toast('Mic / webcam options coming soon'));
}
