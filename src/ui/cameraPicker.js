// Popup for choosing where the camera video comes from.
import { FEATURES } from '../config.js';
import { toast } from './statusBar.js';

/**
 * The "Camera source" dialog. It only handles the UI; camera.js does the work
 * through the callbacks passed in.
 * @param {{
 *   saved: any,                                   last choice from localStorage (or null)
 *   active: boolean,                              is a camera already running?
 *   listCameras: () => Promise<{deviceId: string, label: string}[]>,
 *   currentDeviceId: () => string,
 *   onChoose: (choice: any) => Promise<boolean>,  start a source; false = failed
 *   onClose: () => void,
 * }} opts
 */
export function openSourcePicker(opts) {
  const dialog = /** @type {HTMLDialogElement} */ (document.getElementById('cam-dialog'));
  dialog.innerHTML = `
    <h2>Camera source</h2>
    <p class="dialog-lead">Where should the video come from?</p>
    <button type="button" class="source-option" id="src-device">
      <strong>This device's camera</strong>
      <span>Your webcam. The browser will ask for permission.</span>
      <em class="last-used" hidden>Last used</em>
    </button>

    // Creates a field where you paste the VDO.Ninja link and a button to connect.
    <div class="source-option vdo-option" id="src-vdo">
      <strong>VDO.Ninja link</strong>
      <span>Use the VIEW link for a live phone or remote camera.</span>
      <input
        type="url"
        id="vdo-link"
        placeholder="https://vdo.ninja/?view=YOUR_STREAM_ID"
        autocomplete="off"
        spellcheck="false"
      />
      <button type="button" id="src-vdo-connect">
        Connect camera
      </button>
      <em class="last-used" id="vdo-last-used" hidden>
        Last used
      </em>
    </div>


    <label class="cam-select-row" id="cam-select-row" hidden>
      Camera
      <select id="cam-select"></select>
    </label>
    <p class="dialog-status" id="cam-dialog-status" role="status"></p>
    <div class="dialog-actions"><button type="button" id="cam-dialog-close">Cancel</button></div>`;

  const q = (sel) => dialog.querySelector(sel); // shortcut to find elements inside the dialog
  const deviceBtn = q('#src-device');
  const vdo = q('#src-vdo');
  //gives JavaScript access to the new input field and button
  const vdoLink = q('#vdo-link');
  const vdoConnect = q('#src-vdo-connect');
  const row = q('#cam-select-row');
  const select = /** @type {HTMLSelectElement} */ (q('#cam-select'));
  const status = q('#cam-dialog-status');
  const closeBtn = q('#cam-dialog-close');

  // Preselect the remembered source
  if (opts.saved?.kind === 'device') {
    deviceBtn.classList.add('selected');
    q('.last-used').hidden = false;
  }

  // Camera is running: list cameras (dropdown only when there are several)
  const showRunning = async () => {
    deviceBtn.classList.add('selected');
    closeBtn.textContent = 'Done';
    status.textContent = 'Camera on. The preview is in the bottom-right corner.';
    const cams = await opts.listCameras();
    if (cams.length > 1) {
      select.replaceChildren(...cams.map((c, i) => new Option(c.label || `Camera ${i + 1}`, c.deviceId)));
      select.value = opts.currentDeviceId();
      row.hidden = false;
    }
  };

  // Start a source; on failure camera.js has already shown the reason, so just close
  const choose = async (choice) => {
    deviceBtn.disabled = true;
    select.disabled = true;
    status.textContent = 'Waiting for camera permission…';
    const ok = await opts.onChoose(choice);
    deviceBtn.disabled = false;
    select.disabled = false;
    if (!ok) {
      if (dialog.open) dialog.close();
      return;
    }
    await showRunning();
  };

  deviceBtn.addEventListener('click', () => choose({ kind: 'device', deviceId: opts.saved?.deviceId }));
  select.addEventListener('change', () => choose({ kind: 'device', deviceId: select.value, exact: true }));

  // VDO.Ninja: makes the Connect camera button work and allows you to press Enter to connect
  const pickVdo = () => {
    if (!FEATURES.vdoNinja)
      return toast('VDO.Ninja input is disabled');

    if (!vdoLink.value.trim()) {
      status.textContent =
        'Paste the VIEW link from your phone camera first.';
      vdoLink.focus();
      return;
    }

    choose({
      kind: 'vdoNinja',
      url: vdoLink.value.trim()
    });
  };

  vdoConnect.addEventListener('click', pickVdo);

  vdoLink.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      pickVdo();
    }
  });

  closeBtn.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => opts.onClose(), { once: true });

  dialog.showModal();
  if (opts.active) showRunning();
}
