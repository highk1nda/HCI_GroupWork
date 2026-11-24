import { motionSeries } from '../input/gestures/motionMatcher.js';

// Trim editor: a graph of the recording over time (hand speed + distance between hands
// or palm position) with draggable Start / End handles. The parent shows the selected
// part as a looping skeleton replay. Only the part between the handles becomes the gesture.

const MIN_LEN = 0.3;
const MAX_LEN = 3;

/**
 * @param {HTMLElement} panel  where to render
 * @param {{ title: string, rawFrames: any[], action: string, trim: [number, number],
 *           onChange: (trim: [number, number]) => void, onSave: (trim) => void,
 *           onRedo: () => void, onCancel: () => void }} opts
 */
export function openTrimEditor(panel, opts) {
  const { rawFrames, action } = opts;
  const series = motionSeries(rawFrames, action);
  const t0 = series.t[0] ?? 0;
  const t1 = series.t.at(-1) ?? 1;
  let trim = [...opts.trim];

  panel.innerHTML = `
    <section class="trim">
      <h3>Trim: ${opts.title}</h3>
      <p class="hs-tip">Drag <strong>Start</strong> and <strong>End</strong> so only the gesture itself is inside.
        The big view replays just that part.</p>
      <canvas class="trim-graph" height="300"></canvas>
      <p class="trim-legend"><span class="sw speed"></span>hand speed <span class="sw aux"></span>${series.auxLabel}</p>
      <p class="trim-times" role="status"></p>
      <p class="hs-warning" hidden></p>
      <div class="hs-buttons">
        <button type="button" class="primary" data-act="save">Save</button>
        <button type="button" data-act="auto">Auto-trim</button>
        <button type="button" data-act="redo">Record again</button>
        <button type="button" data-act="cancel">Cancel</button>
      </div>
    </section>`;

  const canvas = /** @type {HTMLCanvasElement} */ (panel.querySelector('.trim-graph'));
  const ctx = canvas.getContext('2d');
  const times = panel.querySelector('.trim-times');
  const warn = panel.querySelector('.hs-warning');
  const PAD = 14;

  // time (s) <-> x pixel on the graph, with a small padding on both sides
  const xOf = (t) => PAD + ((t - t0) / (t1 - t0 || 1)) * (canvas.width - 2 * PAD);
  const tOf = (x) => t0 + ((x - PAD) / (canvas.width - 2 * PAD)) * (t1 - t0);

  /** Draw curves, the shaded selection and the two handles. */
  const draw = () => {
    canvas.width = Math.max(300, canvas.clientWidth * 2);
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f7f6f2';
    ctx.fillRect(0, 0, w, h);

    // selected part
    ctx.fillStyle = 'rgba(30, 111, 224, 0.12)';
    ctx.fillRect(xOf(trim[0]), 0, xOf(trim[1]) - xOf(trim[0]), h);

    // one line, stretched to fill the graph's height; gaps (null = no hands) break the line
    const curve = (values, color) => {
      const real = values.filter((v) => v != null);
      if (!real.length) return;
      const lo = Math.min(...real);
      const hi = Math.max(...real);
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      let pen = false;
      values.forEach((v, i) => {
        if (v == null) return (pen = false);
        const y = h - PAD - ((v - lo) / (hi - lo || 1)) * (h - 2 * PAD);
        pen ? ctx.lineTo(xOf(series.t[i]), y) : ctx.moveTo(xOf(series.t[i]), y);
        pen = true;
      });
      ctx.stroke();
    };
    curve(series.aux, '#43a047');
    curve(series.speed, '#1e6fe0');

    // handles
    for (const [i, label] of [[0, 'Start'], [1, 'End']]) {
      const x = xOf(trim[i]);
      ctx.fillStyle = '#1d1d1b';
      ctx.fillRect(x - 2, 0, 4, h);
      ctx.fillRect(x - 12, h / 2 - 22, 24, 44);
      ctx.fillStyle = '#fff';
      ctx.fillRect(x - 4, h / 2 - 12, 2, 24);
      ctx.fillRect(x + 2, h / 2 - 12, 2, 24);
      ctx.fillStyle = '#1d1d1b';
      ctx.font = '22px system-ui, sans-serif';
      ctx.textAlign = i ? 'right' : 'left';
      ctx.fillText(label, x + (i ? -18 : 18), 26);
    }

    const len = trim[1] - trim[0];
    times.textContent = `Start ${trim[0].toFixed(2)} s · End ${trim[1].toFixed(2)} s · Length ${len.toFixed(2)} s`;
    warn.hidden = len >= MIN_LEN && len <= MAX_LEN;
    warn.textContent =
      len < MIN_LEN ? 'Very short (under 0.3 s): is the whole gesture inside?' : 'Long (over 3 s): trim the pauses before and after.';
  };

  // new Start/End: redraw and let the parent restart the replay
  const setTrim = (next) => {
    trim = next;
    draw();
    opts.onChange(trim);
  };

  // drag the nearest handle
  let dragging = -1;
  const toCanvasX = (e) => ((e.clientX - canvas.getBoundingClientRect().left) / canvas.clientWidth) * canvas.width;
  canvas.addEventListener('pointerdown', (e) => {
    const x = toCanvasX(e);
    dragging = Math.abs(x - xOf(trim[0])) <= Math.abs(x - xOf(trim[1])) ? 0 : 1;
    canvas.setPointerCapture(e.pointerId);
    move(e);
  });
  const move = (e) => {
    if (dragging < 0) return;
    const t = Math.min(t1, Math.max(t0, tOf(toCanvasX(e))));
    const next = [...trim];
    // Start can't pass End (and the other way round): keep at least 0.05 s between them
    next[dragging] = dragging === 0 ? Math.min(t, trim[1] - 0.05) : Math.max(t, trim[0] + 0.05);
    setTrim(next);
  };
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', () => (dragging = -1));
  canvas.addEventListener('pointercancel', () => (dragging = -1));

  const on = (act, fn) => panel.querySelector(`[data-act=${act}]`).addEventListener('click', fn);
  on('save', () => opts.onSave(trim));
  on('auto', () => opts.onAuto && setTrim(opts.onAuto()));
  on('redo', opts.onRedo);
  on('cancel', opts.onCancel);

  draw();
  opts.onChange(trim);
}
