import { FEATURES } from '../config.js';
import { SHAPES } from '../types.js';
import * as camera from '../input/camera.js';
import * as store from '../input/gestures/store.js';
import * as recorder from '../input/gestures/recorder.js';
import * as recognizer from '../input/gestures/recognizer.js';
import { nearestOtherShape } from '../input/gestures/poseMatcher.js';
import { shapeIcons } from '../scene/presets.js';
import { drawHands, drawHoldRing, handsCenter } from './handDraw.js';
import { shapeImage } from './gestureOverlay.js';
import { openTrimEditor } from './trimEditor.js';
import { autoTrim, buildTemplate, MOTION_SCALE } from '../input/gestures/motionMatcher.js';
import { toast } from './statusBar.js';
import { activateMode } from './inputMode.js';

// "Hand settings" dialog: a big live camera view on the left, and on the right the
// recorded gestures (one row per shape), recording screens and general settings.

export const SHAPE_NAMES = { cube: 'Cube', sphere: 'Sphere', cone: 'Cone', cylinder: 'Cylinder', rod: 'Rod', heart: 'Heart' };
const POSE_HINTS = {
  cube: 'Square: thumbs and index fingers of both hands make a frame.',
  sphere: 'Circle: fingers of both hands curved, fingertips touching.',
  cone: 'Triangle: thumbs touch at the bottom, index fingers at the top.',
  cylinder: 'Both palms parallel and upright, as if holding a can.',
  rod: 'Both index fingers in one horizontal line.',
  heart: 'A heart made with both hands.',
};
const RECOMMENDED = 3;
export const MOTION_INFO = {
  zoomIn: { name: 'Zoom in', hint: 'Move your hands apart.' },
  zoomOut: { name: 'Zoom out', hint: 'Bring your hands together.' },
  orbit: { name: 'Orbit', hint: 'Open palm, sweep it sideways once. The opposite direction works automatically.' },
};

/** @type {HTMLDialogElement} */
let dialog;
let ui = null; // elements of the open dialog
let unsubscribeFrames = null;
let unsubscribeRecognizer = null;

/** Wire the two entry points: gear on the camera preview and "Hands" in the Input group. */
export function initHandSettings() {
  dialog = /** @type {HTMLDialogElement} */ (document.getElementById('hand-dialog'));
  const gear = document.getElementById('cam-gear');
  const handsBtn = document.getElementById('btn-hands');
  if (!FEATURES.gestures) {
    gear.hidden = true;
    handsBtn.classList.add('dummy');
    handsBtn.title = 'Hand settings (coming soon)';
  }
  gear.addEventListener('click', openHandSettings);
  handsBtn.addEventListener('click', openHandSettings);

  dialog.addEventListener('close', onClosed);
  dialog.addEventListener('keydown', (e) => {
    if (e.key === ' ' && ui?.view === 'record-motion') {
      e.preventDefault();
      recorder.stop();
    }
  });
  // camera switched off while the dialog is open: nothing to show any more
  camera.onCameraStop(() => {
    if (dialog.open) {
      dialog.close();
      toast('Camera stopped');
    }
  });
  store.onStoreChange(() => {
    if (ui?.view === 'main') renderMain();
  });
}

/** Open the dialog (needs the camera running). */
export function openHandSettings() {
  if (!FEATURES.gestures) return toast('Hand gestures coming soon');
  if (!camera.isActive()) {
    return toast('Turn on the camera first', {
      label: 'Turn on',
      onClick: async () => {
        if (!(await activateMode('cam'))) return;
        await untilClosed(document.getElementById('cam-dialog'));
        if (camera.isActive()) openHandSettings();
      },
    });
  }
  build();
  recognizer.setSuppressed(true); // nothing gets created while configuring
  dialog.showModal();
}

// waits until a dialog is closed (right away if it's already closed)
const untilClosed = (d) => new Promise((r) => (d.open ? d.addEventListener('close', r, { once: true }) : r()));

/** Dialog closed: stop recording / replay, unpause recognition, unhook listeners. */
function onClosed() {
  recorder.cancel();
  stopReplay();
  recognizer.setSuppressed(false);
  unsubscribeFrames?.();
  unsubscribeRecognizer?.();
  unsubscribeFrames = unsubscribeRecognizer = null;
  if (ui) ui.video.srcObject = null;
  ui = null;
}

// ---------- layout ----------

/** Create the dialog's layout and hook the live camera view to it. */
function build() {
  dialog.innerHTML = `
    <div class="hs-head">
      <h2>Hand settings</h2>
      <button type="button" class="hs-x" aria-label="Close">×</button>
    </div>
    <div class="hs-body">
      <div class="hs-stage">
        <video muted playsinline></video>
        <canvas></canvas>
        <div class="hs-stage-hint" hidden></div>
        <div class="hs-count" hidden></div>
        <svg class="hs-ring" viewBox="0 0 100 100" hidden>
          <circle cx="50" cy="50" r="44" class="hs-ring-track"/>
          <circle cx="50" cy="50" r="44" class="hs-ring-fill" pathLength="100"/>
        </svg>
      </div>
      <div class="hs-panel"></div>
    </div>`;
  const q = (s) => dialog.querySelector(s);
  ui = {
    view: 'main',
    testing: false, // Test mode: live confidence bars, nothing is created
    lastUpdate: null, // latest recognizer result (it runs just before the drawing below)
    replayId: 0, // trim replay running: the big view shows the recording, not the live hands
    stage: q('.hs-stage'),
    video: q('video'),
    canvas: q('canvas'),
    hint: q('.hs-stage-hint'),
    count: q('.hs-count'),
    ring: q('.hs-ring'),
    ringFill: q('.hs-ring-fill'),
    panel: q('.hs-panel'),
  };
  q('.hs-x').addEventListener('click', () => dialog.close());

  // live view: same camera stream, skeleton drawn from the shared hand results
  ui.video.srcObject = camera.getStream();
  ui.video.play().catch(() => {});
  ui.canvas.width = 640;
  ui.canvas.height = 480;
  const ctx = ui.canvas.getContext('2d');
  unsubscribeRecognizer = recognizer.onRecognizerUpdate((u) => {
    ui.lastUpdate = u;
    if (ui.testing && ui.view === 'main') showTestResult(u);
  });
  unsubscribeFrames = camera.onHandsFrame((hands) => {
    if (ui.replayId) return;
    const { width: w, height: h } = ui.canvas;
    drawHands(ctx, w, h, hands);
    const pose = ui.lastUpdate?.pose;
    if (ui.testing && ui.view === 'main' && pose?.key && pose.progress > 0 && hands.length) {
      drawHoldRing(ctx, w, h, handsCenter(hands), pose.progress, shapeImage(pose.key));
    }
  });

  renderMain();
}

/** Overlay on the live view: hint at the top, big countdown number, progress ring. */
function setStage({ hint = '', count = '', ring = null } = {}) {
  ui.hint.hidden = !hint;
  ui.hint.textContent = hint;
  ui.count.hidden = !count;
  ui.count.textContent = count;
  ui.ring.hidden = ring === null;
  if (ring !== null) ui.ringFill.style.strokeDasharray = `${ring * 100} 100`;
}

// ---------- main view: rows of shapes ----------

/** The main screen: one row per shape and motion, general settings, import / export. */
function renderMain() {
  ui.view = 'main';
  setStage(ui.testing ? { hint: 'Test mode: nothing is created' } : {});
  const icons = shapeIcons();
  const s = store.settings();
  ui.panel.innerHTML = `
    <section>
      <h3 class="hs-h3-row">Shapes <span>still poses</span>
        <button type="button" class="hs-test-toggle ${ui.testing ? 'on' : ''}" aria-pressed="${ui.testing}">${ui.testing ? 'Stop test' : 'Test'}</button>
      </h3>
      <p class="hs-test-line" ${ui.testing ? '' : 'hidden'}>Make a pose or a motion: the bars show how close it is to each recording.
        Past the middle line = it would fire. The number is the distance (lower = closer).
        <strong class="hs-test-live"></strong></p>
      <div class="hs-rows" id="hs-shapes"></div>
    </section>
    <section>
      <h3>Motions <span>camera zoom and orbit</span></h3>
      <div class="hs-rows" id="hs-motions"></div>
    </section>
    <section class="hs-general">
      <h3>General</h3>
      <label class="hs-switch"><input type="checkbox" data-set="enabled" ${s.enabled ? 'checked' : ''} /> Gesture recognition
        <small>${store.hasAnyGesture() ? 'Turn off so nothing spawns by accident during a demo' : 'Starts working once a gesture is recorded'}</small></label>
      <label class="hs-switch"><input type="checkbox" data-set="continuous" ${s.continuous ? 'checked' : ''} /> Continuous camera control
        <small>After a zoom or orbit is recognized, the camera keeps following your hands until they rest or drop. Off = one fixed step per gesture.</small></label>
      <label class="hs-slider">Sensitivity <output data-out="threshold">${s.threshold.toFixed(2)}</output>
        <input type="range" data-set="threshold" min="0.15" max="0.7" step="0.01" value="${s.threshold}" />
        <small>Match threshold in palm sizes. Higher = matches more easily, but more false triggers.</small></label>
      <label class="hs-slider">Hold time <output data-out="holdMs">${(s.holdMs / 1000).toFixed(1)} s</output>
        <input type="range" data-set="holdMs" min="200" max="1500" step="100" value="${s.holdMs}" /></label>
      <label class="hs-slider">Pause after a gesture <output data-out="cooldownMs">${(s.cooldownMs / 1000).toFixed(1)} s</output>
        <input type="range" data-set="cooldownMs" min="500" max="3000" step="100" value="${s.cooldownMs}" /></label>
    </section>
    <footer class="hs-foot">
      <button type="button" data-foot="export">Export JSON</button>
      <button type="button" data-foot="import">Import JSON</button>
      <button type="button" data-foot="team" title="Load gestures/default.json from the project">Load team gestures</button>
      <button type="button" data-foot="reset" class="danger">Reset all</button>
    </footer>`;

  const rows = ui.panel.querySelector('#hs-shapes');
  for (const shape of SHAPES) {
    const n = store.poseSamples(shape).length;
    const row = document.createElement('div');
    row.className = 'hs-row';
    row.dataset.shape = shape;
    row.innerHTML = `
      <img alt="" />
      <span class="hs-name">${SHAPE_NAMES[shape]}<small>${n ? `${n} sample${n > 1 ? 's' : ''}` : 'not set'}</small>
        <span class="hs-meter" ${ui.testing && n ? '' : 'hidden'}><i></i><em></em></span></span>
      <span class="hs-actions">
        <button type="button" data-act="record">Record</button>
        <button type="button" data-act="test" ${n ? '' : 'disabled'}>Test</button>
        <button type="button" data-act="delete" ${n ? '' : 'disabled'}>Delete</button>
      </span>`;
    if (icons[shape]) row.querySelector('img').src = icons[shape];
    row.querySelector('[data-act=record]').addEventListener('click', () => startPoseRecording(shape));
    row.querySelector('[data-act=test]').addEventListener('click', () => setTesting(true));
    row.querySelector('[data-act=delete]').addEventListener('click', () => {
      if (confirm(`Delete all ${n} sample(s) for ${SHAPE_NAMES[shape]}?`)) store.deletePoses(shape);
    });
    rows.append(row);
  }

  const motionRows = ui.panel.querySelector('#hs-motions');
  for (const [action, info] of Object.entries(MOTION_INFO)) {
    const m = store.getMotion(action);
    const row = document.createElement('div');
    row.className = 'hs-row hs-motion';
    row.dataset.motion = action;
    row.innerHTML = `
      <span class="hs-motion-icon" aria-hidden="true">${MOTION_ICONS[action]}</span>
      <span class="hs-name">${info.name}<small>${m ? `recorded · ${(m.trim[1] - m.trim[0]).toFixed(1)} s` : 'not set'}</small>
        <span class="hs-meter" ${ui.testing && m ? '' : 'hidden'}><i></i><em></em></span></span>
      <span class="hs-actions">
        <button type="button" data-act="record">Record</button>
        <button type="button" data-act="trim" ${m ? '' : 'disabled'}>Trim</button>
        <button type="button" data-act="test" ${m ? '' : 'disabled'}>Test</button>
        <button type="button" data-act="delete" ${m ? '' : 'disabled'}>Delete</button>
      </span>`;
    const on = (act, fn) => row.querySelector(`[data-act=${act}]`).addEventListener('click', fn);
    on('record', () => startMotionRecording(action));
    on('trim', () => openTrim(action, m.rawFrames, m.trim));
    on('test', () => setTesting(true));
    on('delete', () => {
      if (confirm(`Delete the ${info.name} recording?`)) store.deleteMotion(action);
    });
    motionRows.append(row);
  }

  ui.panel.querySelector('.hs-test-toggle').addEventListener('click', () => setTesting(!ui.testing));

  // General settings: saved on every change
  ui.panel.querySelectorAll('[data-set]').forEach((input) => {
    const key = input.dataset.set;
    const out = ui.panel.querySelector(`[data-out=${key}]`);
    input.addEventListener('input', () => {
      if (input.type === 'checkbox') return store.updateSettings({ [key]: input.checked });
      const value = Number(input.value);
      out.textContent = key === 'threshold' ? value.toFixed(2) : `${(value / 1000).toFixed(1)} s`;
    });
    // sliders save when released, so the panel doesn't re-render mid-drag
    input.addEventListener('change', () => {
      if (input.type !== 'checkbox') store.updateSettings({ [key]: Number(input.value) });
    });
  });

  const foot = (name) => ui.panel.querySelector(`[data-foot=${name}]`);
  foot('export').addEventListener('click', () => store.exportFile());
  foot('import').addEventListener('click', () => pickFile((file) => store.importFile(file)));
  foot('team').addEventListener('click', loadTeamGestures);
  foot('reset').addEventListener('click', () => {
    if (confirm('Delete every recorded gesture and reset the settings?')) store.resetAll();
  });
}

/** Turn Test mode on or off (live bars per shape, ring on the big view, nothing created). */
function setTesting(on) {
  ui.testing = on;
  renderMain();
}

/** Update every shape's bar: full bar = identical, half = exactly at the threshold. */
function showTestResult(u) {
  const threshold = store.settings().threshold;
  const line = ui.panel.querySelector('.hs-test-live');
  if (line) {
    line.textContent = u.hands.length
      ? `${u.hands.length} hand${u.hands.length > 1 ? 's' : ''} · ${u.follow ? 'following' : u.still ? 'still: checking poses' : 'moving: checking motions'} · speed ${u.speed.toFixed(1)} palm/s`
      : 'No hands in view';
  }
  const pose = u.pose;
  for (const row of ui.panel.querySelectorAll('#hs-shapes .hs-row')) {
    const shape = row.dataset.shape;
    const d = pose?.distances[shape] ?? Infinity;
    const meter = row.querySelector('.hs-meter');
    // distance 0 -> 100% bar, distance = threshold -> 50%, twice the threshold -> 0%
    const conf = Number.isFinite(d) ? Math.max(0, Math.min(1, 1 - d / (2 * threshold))) : 0;
    meter.querySelector('i').style.width = `${conf * 100}%`;
    meter.querySelector('em').textContent = !u.hands.length
      ? 'no hands'
      : !u.still
        ? 'moving'
        : Number.isFinite(d)
          ? d.toFixed(2)
          : `needs ${u.hands.length === 1 ? '2 hands' : '1 hand'}`;
    row.classList.toggle('testing', pose?.key === shape);
  }

  // motions: bars from the latest DTW match (only computed while the hands move)
  const motion = u.motion;
  const motionThreshold = threshold * MOTION_SCALE;
  for (const row of ui.panel.querySelectorAll('#hs-motions .hs-row')) {
    const action = row.dataset.motion;
    const d = motion?.distances[action] ?? Infinity;
    const meter = row.querySelector('.hs-meter');
    const conf = Number.isFinite(d) ? Math.max(0, Math.min(1, 1 - d / (2 * motionThreshold))) : 0;
    meter.querySelector('i').style.width = `${conf * 100}%`;
    const dir = action === 'orbit' && motion?.key === 'orbit' ? (motion.dirs.orbit < 0 ? ' ← left' : ' → right') : '';
    meter.querySelector('em').textContent = !u.hands.length
      ? 'no hands'
      : !motion
        ? 'move to test'
        : Number.isFinite(d)
          ? d.toFixed(2) + dir
          : 'no match';
    row.classList.toggle('testing', motion?.key === action);
  }
}

/**
 * The team's tuned gestures, kept in the project as gestures/default.json (exported from
 * this dialog on the demo laptop). A fallback when this browser has none, or to reset to them.
 */
async function loadTeamGestures() {
  let text;
  try {
    const res = await fetch('gestures/default.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    text = await res.text();
  } catch {
    return toast('No team gestures yet. Export JSON and save it as gestures/default.json in the project.');
  }
  if (store.hasAnyGesture() && !confirm('Replace your recorded gestures and settings with the team gestures?')) return;
  try {
    store.importText(text);
    toast('Team gestures loaded');
  } catch (err) {
    toast(`gestures/default.json is not valid: ${err.message}`);
  }
}

/** Open the file chooser and pass the picked file on. */
function pickFile(onFile) {
  const input = /** @type {HTMLInputElement} */ (document.getElementById('gesture-input'));
  input.onchange = () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) onFile(file);
  };
  input.click();
}

// ---------- recording a pose ----------

/** Record screen for a pose: countdown, then hold still for 3 s. */
function startPoseRecording(shape) {
  if (store.poseSamples(shape).length >= store.MAX_SAMPLES) {
    return toast(`Up to ${store.MAX_SAMPLES} samples per shape. Delete them to record again.`);
  }
  ui.view = 'record';
  ui.panel.innerHTML = `
    <section>
      <h3>Record: ${SHAPE_NAMES[shape]}</h3>
      <p class="hs-lead">Make the shape with your hands: <strong>${SHAPE_NAMES[shape]}</strong></p>
      <p class="hs-tip">${POSE_HINTS[shape]}</p>
      <p class="hs-tip">Keep your fingers visible to the camera. Overlapping fingers confuse the tracker.</p>
      <p class="hs-state" role="status">Get ready…</p>
      <div class="hs-buttons"><button type="button" data-act="cancel">Cancel</button></div>
    </section>`;
  const state = ui.panel.querySelector('.hs-state');
  ui.panel.querySelector('[data-act=cancel]').addEventListener('click', () => {
    recorder.cancel();
    renderMain();
  });

  recorder.recordPose({
    onUpdate: (u) => {
      if (u.phase === 'countdown') {
        setStage({ hint: `Make the shape: ${SHAPE_NAMES[shape]}`, count: String(u.secondsLeft) });
        state.textContent = `Starting in ${u.secondsLeft}…`;
      } else {
        setStage({ hint: 'Hold still', ring: u.progress });
        state.textContent = `Recording… ${u.frames} frames`;
      }
    },
    onDone: (result) => showPoseResult(shape, result),
  });
}

/** After recording a pose: show the quality checks and Save / Replace / Redo / Cancel. */
function showPoseResult(shape, result) {
  ui.view = 'result';
  setStage();
  const n = store.poseSamples(shape).length;
  const checks = [
    result.hands ? `${Math.round(result.visible * 100)}% of frames with ${result.hands === 2 ? 'both hands' : 'the hand'} visible` : null,
    result.hands ? `Shape wobble ${result.wobble.toFixed(2)} (limit 0.15), drift ${result.drift.toFixed(2)} (limit 0.35) palm sizes` : null,
  ].filter(Boolean);

  // too close to another shape's recordings? the two would get mixed up
  const conflict = result.ok ? nearestOtherShape(result.sample, store.allPoses(), shape) : null;
  const clash = conflict && conflict.distance < store.settings().threshold ? SHAPE_NAMES[conflict.shape] : null;

  ui.panel.innerHTML = `
    <section>
      <h3>${result.ok ? 'Recorded' : 'Not usable'}: ${SHAPE_NAMES[shape]}</h3>
      ${result.ok ? '' : `<ul class="hs-problems">${result.reasons.map((r) => `<li>${r}</li>`).join('')}</ul>`}
      <ul class="hs-checks">${checks.map((c) => `<li>${c}</li>`).join('')}</ul>
      ${clash ? `<p class="hs-warning">Looks like ${clash} (distance ${conflict.distance.toFixed(2)}). The two could get mixed up. Save anyway, or redo with a more different pose?</p>` : ''}
      <div class="hs-buttons">
        ${result.ok ? `<button type="button" class="primary" data-act="save">${clash ? 'Save anyway' : 'Save'}</button>` : ''}
        ${result.ok && n ? `<button type="button" data-act="replace">Replace the ${n} saved</button>` : ''}
        <button type="button" data-act="redo">Redo</button>
        <button type="button" data-act="cancel">Cancel</button>
      </div>
    </section>`;

  const on = (act, fn) => ui.panel.querySelector(`[data-act=${act}]`)?.addEventListener('click', fn);
  on('save', () => {
    store.addPoseSample(shape, result.sample);
    afterSave(shape);
  });
  on('replace', () => {
    store.replacePoseSamples(shape, result.sample);
    afterSave(shape);
  });
  on('redo', () => startPoseRecording(shape));
  on('cancel', renderMain);
}

// ---------- recording a motion ----------

const MOTION_ICONS = {
  zoomIn: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 12H3m0 0 3-3m-3 3 3 3M15 12h6m0 0-3-3m3 3-3 3"/></svg>',
  zoomOut: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 12h6m0 0-3-3m3 3-3 3M21 12h-6m0 0 3-3m-3 3 3 3"/></svg>',
  orbit: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><ellipse cx="12" cy="12" rx="9" ry="4"/><path d="M18 8.5l2.5-.5-.5 2.5"/></svg>',
};

/** Record screen for a motion: countdown, then up to 5 s, then the trim editor. */
function startMotionRecording(action) {
  const info = MOTION_INFO[action];
  ui.view = 'record-motion';
  ui.panel.innerHTML = `
    <section>
      <h3>Record: ${info.name}</h3>
      <p class="hs-lead">${info.hint}</p>
      <p class="hs-tip">After the countdown, do the motion once. Recording stops after 5 seconds,
        or press <strong>Stop</strong> / <kbd>Space</kbd>. You trim it afterwards.</p>
      <p class="hs-state" role="status">Get ready…</p>
      <div class="hs-buttons">
        <button type="button" class="primary" data-act="stop" disabled>Stop</button>
        <button type="button" data-act="cancel">Cancel</button>
      </div>
    </section>`;
  const state = ui.panel.querySelector('.hs-state');
  const stopBtn = ui.panel.querySelector('[data-act=stop]');
  stopBtn.addEventListener('click', () => recorder.stop());
  ui.panel.querySelector('[data-act=cancel]').addEventListener('click', () => {
    recorder.cancel();
    renderMain();
  });

  recorder.recordMotion({
    onUpdate: (u) => {
      if (u.phase === 'countdown') {
        setStage({ hint: `Get ready: ${info.name}`, count: String(u.secondsLeft) });
        state.textContent = `Starting in ${u.secondsLeft}…`;
      } else {
        stopBtn.disabled = false;
        setStage({ hint: `Go: ${info.hint}`, ring: u.progress });
        state.textContent = `Recording… ${(u.progress * 5).toFixed(1)} s`;
      }
    },
    onDone: ({ rawFrames }) => {
      setStage();
      if (rawFrames.filter((f) => f.hands.length).length < 6) {
        ui.view = 'result';
        ui.panel.innerHTML = `
          <section>
            <h3>Not usable: ${info.name}</h3>
            <ul class="hs-problems"><li>No hands were seen. Keep your hands in the camera view.</li></ul>
            <div class="hs-buttons"><button type="button" data-act="redo">Redo</button><button type="button" data-act="cancel">Cancel</button></div>
          </section>`;
        ui.panel.querySelector('[data-act=redo]').addEventListener('click', () => startMotionRecording(action));
        ui.panel.querySelector('[data-act=cancel]').addEventListener('click', renderMain);
        return;
      }
      openTrim(action, rawFrames, autoTrim(rawFrames, action));
    },
  });
}

/** Trim editor for a recording; the big view loops the selected part. */
function openTrim(action, rawFrames, trim) {
  ui.view = 'trim';
  setStage({ hint: 'Replay of the selected part' });
  openTrimEditor(ui.panel, {
    title: MOTION_INFO[action].name,
    action,
    rawFrames,
    trim,
    onChange: (next) => startReplay(rawFrames, next),
    onAuto: () => autoTrim(rawFrames, action),
    onSave: (next) => {
      const template = buildTemplate(rawFrames, next);
      if (!template) return toast('Not enough frames with hands in the selected part. Widen it or record again.');
      store.setMotion(action, { rawFrames, trim: next, template });
      stopReplay();
      renderMain();
      toast(`${MOTION_INFO[action].name} saved`);
    },
    onRedo: () => {
      stopReplay();
      startMotionRecording(action);
    },
    onCancel: () => {
      stopReplay();
      renderMain();
    },
  });
}

/** Loop the skeleton of frames between trim[0] and trim[1] on the big view. */
function startReplay(rawFrames, trim) {
  stopReplay();
  const part = rawFrames.filter((f) => f.t >= trim[0] && f.t <= trim[1]);
  if (!part.length) return;
  ui.stage.classList.add('replaying');
  const ctx = ui.canvas.getContext('2d');
  const len = Math.max(0.1, part.at(-1).t - part[0].t);
  const t0 = performance.now();
  const frame = () => {
    const t = part[0].t + (((performance.now() - t0) / 1000) % (len + 0.4)); // short pause between loops
    const f = part.findLast((p) => p.t <= t) ?? part[0]; // latest recorded frame at this moment
    drawHands(ctx, ui.canvas.width, ui.canvas.height, f.hands);
    ui.replayId = requestAnimationFrame(frame);
  };
  ui.replayId = requestAnimationFrame(frame);
}

/** Stop the replay loop; the big view goes back to the live camera. */
function stopReplay() {
  cancelAnimationFrame(ui?.replayId);
  if (ui) {
    ui.replayId = 0;
    ui.stage.classList.remove('replaying');
  }
}

/** Back to the main screen with a "saved" message (and a nudge to record 3 samples). */
function afterSave(shape) {
  const n = store.poseSamples(shape).length;
  renderMain();
  toast(
    n < RECOMMENDED
      ? `Sample ${n} of ${RECOMMENDED} saved. Record ${RECOMMENDED - n} more for reliability.`
      : `${SHAPE_NAMES[shape]}: ${n} samples saved`,
  );
}
