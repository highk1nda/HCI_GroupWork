// Status text (hints, mode, later "Heard: ..."), zoom readout and toasts.

let statusEl;
let zoomEl;
let toastEl;
let baseText = '';
let flashTimer = 0; // non-zero while a flash message is showing
let toastTimer = 0;

/** Find the status, zoom and toast elements on the page. */
export function initStatusBar() {
  statusEl = document.getElementById('status-text');
  zoomEl = document.getElementById('zoom-value');
  toastEl = document.getElementById('toast');
}

/** The resting status text, shown whenever no flash message is up. */
export function setBaseStatus(text) {
  baseText = text;
  if (!flashTimer) statusEl.textContent = text;
}

/** A short-lived status message that falls back to the resting text. */
export function flashStatus(text, ms = 2500) {
  statusEl.textContent = text;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    flashTimer = 0;
    statusEl.textContent = baseText;
  }, ms);
}

/** Show the zoom % in the bottom bar. */
export function setZoom(percent) {
  zoomEl.textContent = `${percent}%`;
}

/**
 * Pop up a short message near the top for about 2 seconds.
 * With an action ({ label, onClick }) it gets a button and stays a bit longer.
 */
export function toast(message, action) {
  if (!toastEl) return;
  toastEl.replaceChildren(message);
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      toastEl.classList.remove('show');
      action.onClick();
    });
    toastEl.append(btn);
  }
  toastEl.classList.toggle('has-action', !!action);
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), action ? 5000 : 2200);
}
