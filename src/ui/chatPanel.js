import { FEATURES, AI_CONFIG } from '../config.js';
import { runAI } from '../ai/aiCommands.js';
import { health } from '../ai/llmClient.js';
import * as voice from '../input/voice.js';
import { PALETTE } from '../types.js';

// AI assistant chat panel, docked right-middle of the workspace. Typing and the mic
// both call send() -> runAI(text). Messages live only in memory (last 30).

const MAX_MESSAGES = 30;
const OPEN_KEY = 'demo3d.chatOpen';
const CHIPS = ['add a red cube', 'add a ball', "what's in the scene?"];
const COLOR_HEX = Object.fromEntries(PALETTE.map((c) => [c.name, c.hex]));

const MIC_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const SEND_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12l16-8-6 16-2-7-8-1z"/></svg>';

let el = null; // DOM elements
let messages = []; // { role: 'user' | 'ai' | 'system', text, spoken?, actions?, pending? }
let request = null; // AbortController of the running request
let status = 'checking'; // 'online' | 'offline' | 'thinking' | 'checking'
let statusNote = '';
let spacePushToTalk = false; // Mic mode on: hold Space to talk
let micBlocked = false;

/** Build the panel (only when FEATURES.ai is on). */
export function initChatPanel() {
  if (!FEATURES.ai) return;
  const workspace = document.getElementById('workspace');
  workspace.insertAdjacentHTML(
    'beforeend',
    `<section class="card chat" id="chat-panel" aria-label="AI assistant">
       <header class="chat-head">
         <button type="button" class="chat-dot" aria-label="AI status"></button>
         <h2>AI assistant</h2>
         <button type="button" class="chat-collapse" title="Collapse" aria-label="Collapse the AI assistant">–</button>
       </header>
       <ol class="chat-log"></ol>
       <form class="chat-input" autocomplete="off">
         <input type="text" placeholder="Ask or command… e.g. add a red cube" aria-label="Message to the AI assistant" />
         <button type="button" class="chat-mic" title="Hold to talk" aria-label="Hold to talk">${MIC_ICON}</button>
         <button type="submit" class="chat-send" title="Send (Enter)" aria-label="Send">${SEND_ICON}</button>
       </form>
     </section>
     <button type="button" class="chat-tab" id="chat-tab" title="AI assistant" hidden>AI</button>`,
  );
  const panel = document.getElementById('chat-panel');
  el = {
    workspace,
    panel,
    tab: document.getElementById('chat-tab'),
    dot: panel.querySelector('.chat-dot'),
    log: panel.querySelector('.chat-log'),
    form: panel.querySelector('.chat-input'),
    input: panel.querySelector('.chat-input input'),
    mic: panel.querySelector('.chat-mic'),
    send: panel.querySelector('.chat-send'),
  };

  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    send(el.input.value);
  });
  el.panel.querySelector('.chat-collapse').addEventListener('click', () => setOpen(false));
  el.tab.addEventListener('click', () => {
    setOpen(true);
    el.input.focus();
  });
  el.dot.addEventListener('click', () => checkHealth(true));
  el.input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && request) {
      e.preventDefault();
      request.abort();
    }
  });
  initMic();
  initKeys();

  let open = true;
  try {
    open = localStorage.getItem(OPEN_KEY) !== 'closed';
  } catch {
    // storage blocked: start open
  }
  setOpen(open, false);
  render();
  checkHealth(false);
}

/** Show the panel (Mic mode, the AI tab, the / key). */
export function openChat() {
  if (el) setOpen(true);
}

/** Mic mode turns this on: hold Space (outside text fields) to talk. */
export function setSpacePushToTalk(on) {
  spacePushToTalk = on && !!el && FEATURES.voice && voice.isSupported();
}

/** Show or hide the panel (and the small "AI" tab), and remember it for next time. */
function setOpen(open, remember = true) {
  el.panel.hidden = !open;
  el.tab.hidden = open;
  el.workspace.classList.toggle('chat-open', open);
  if (remember) {
    try {
      localStorage.setItem(OPEN_KEY, open ? 'open' : 'closed');
    } catch {
      // not remembered, that's fine
    }
    if (open) checkHealth(false);
  }
}

// ---------- status dot ----------

/** Color of the status dot + its hover text. */
function setStatus(next, note = statusNote) {
  status = next;
  statusNote = note;
  el.dot.dataset.status = next;
  const label = { online: 'LM Studio reachable', offline: 'AI offline', thinking: 'Thinking…', checking: 'Checking LM Studio…' }[next];
  el.dot.title = `${label} · model ${AI_CONFIG.model}${note ? `\n${note}` : ''}\nClick to check again.`;
}

/** Ask LM Studio for its models: green if reachable, grey if not. */
async function checkHealth(announce) {
  if (request) return;
  setStatus('checking');
  const { ok, models } = await health();
  if (request) return;
  if (!ok) {
    setStatus('offline', `Start the LM Studio server at ${AI_CONFIG.baseUrl} with CORS enabled.`);
    if (announce || !messages.length) system(`AI offline: LM Studio isn't reachable at ${AI_CONFIG.baseUrl}. Mouse, keyboard and gestures still work.`);
    return;
  }
  const known = models.includes(AI_CONFIG.model);
  setStatus('online', known ? '' : `Model "${AI_CONFIG.model}" is not in LM Studio's list: ${models.join(', ') || 'none'}.`);
  if (!known) system(`LM Studio is running, but model "${AI_CONFIG.model}" isn't in its list (${models.join(', ') || 'none'}). Set AI_CONFIG.model in src/config.js.`);
  else if (announce) system(`LM Studio reachable · ${AI_CONFIG.model}`);
}

// ---------- sending ----------

/** One sentence (typed or spoken) -> runAI -> reply bubble. */
async function send(text, { spoken = false } = {}) {
  text = text.trim();
  if (!text || request) return;
  el.input.value = '';
  push({ role: 'user', text, spoken });
  const pending = push({ role: 'ai', text: '', pending: true }); // "..." bubble, filled in when the answer comes
  request = new AbortController();
  setBusy(true);
  try {
    const { reply, actions } = await runAI(text, request.signal);
    Object.assign(pending, { text: reply, actions, pending: false });
    setStatus('online', '');
  } catch (err) {
    Object.assign(pending, { role: 'system', text: err.message, pending: false });
    setStatus(err.kind === 'offline' ? 'offline' : 'online');
  } finally {
    request = null;
    setBusy(false);
    render();
  }
}

/** Lock the input while waiting for the AI. */
function setBusy(busy) {
  el.input.disabled = busy;
  el.send.disabled = busy;
  el.mic.disabled = busy || micBlocked;
  if (busy) setStatus('thinking');
  else el.input.focus();
}

/** Add a message (only the last 30 are kept) and redraw. */
function push(msg) {
  messages.push(msg);
  messages = messages.slice(-MAX_MESSAGES);
  render();
  return msg;
}

/** A grey info message from the app itself (not the AI). */
function system(text) {
  push({ role: 'system', text });
}

// ---------- rendering ----------

/** Redraw the whole message list (with example chips if nothing was said yet). */
function render() {
  el.log.replaceChildren();
  if (!messages.some((m) => m.role !== 'system')) {
    const li = document.createElement('li');
    li.className = 'chat-empty';
    li.innerHTML = '<p>Try one of these, or type your own:</p>';
    for (const chip of CHIPS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chat-chip';
      b.textContent = chip;
      b.addEventListener('click', () => send(chip));
      li.append(b);
    }
    el.log.append(li);
  }
  for (const m of messages) {
    const li = document.createElement('li');
    li.className = `msg ${m.role}`;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (m.pending) {
      bubble.innerHTML = '<span class="dots" aria-label="Thinking"><i></i><i></i><i></i></span>';
    } else {
      if (m.spoken) bubble.insertAdjacentHTML('afterbegin', `<span class="spoken" title="Spoken">${MIC_ICON}</span>`);
      bubble.append(m.text);
    }
    li.append(bubble);
    for (const a of m.actions ?? []) {
      const line = document.createElement('div');
      line.className = 'action-line';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = a.color ?? 'transparent';
      if (!a.color) dot.classList.add('default');
      line.append(dot, `Add ${a.shape}${a.count > 1 ? ` ×${a.count}` : ''}`);
      li.append(line);
    }
    el.log.append(li);
  }
  el.log.scrollTop = el.log.scrollHeight;
}

// ---------- mic (push-to-talk) ----------

/** Mic button: hold to talk, release to send. */
function initMic() {
  if (!FEATURES.voice || !voice.isSupported()) {
    el.mic.hidden = true; // unsupported browser (e.g. Firefox): typing only
    return;
  }
  el.mic.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.mic.setPointerCapture(e.pointerId);
    startMic();
  });
  el.mic.addEventListener('pointerup', stopMic);
  el.mic.addEventListener('pointercancel', stopMic);
}

/** Start listening; when done, send the words to the AI or explain what went wrong. */
function startMic() {
  if (voice.isListening() || request || micBlocked) return;
  setOpen(true);
  el.mic.classList.add('listening');
  el.input.value = '';
  el.input.placeholder = 'Listening… release to send';
  voice.startListening({
    onText: (text) => (el.input.value = text),
    onDone: (text, error) => {
      el.mic.classList.remove('listening');
      el.input.placeholder = 'Ask or command… e.g. add a red cube';
      if (error === 'not-allowed' || error === 'service-not-allowed') {
        micBlocked = true;
        el.mic.disabled = true;
        el.mic.title = 'Microphone blocked';
        return system('Microphone blocked, allow it in the address bar. Typing still works.');
      }
      if (error === 'network') return system('Speech recognition needs an internet connection.');
      if (error && error !== 'no-speech' && error !== 'aborted') return system(`Speech recognition stopped (${error}).`);
      if (text) send(text, { spoken: true });
      else system("Didn't catch that. Hold the mic button while you speak.");
    },
  });
}

/** Stop listening (the result arrives in onDone above). */
function stopMic() {
  if (voice.isListening()) voice.stopListening();
}

// ---------- keys: / focuses, Space = push-to-talk in Mic mode ----------

const typing = (t) => t instanceof HTMLElement && (t.isContentEditable || t.matches('input, textarea, select'));
const dialogOpen = () => !!document.querySelector('dialog[open]');

/** Global keys for the chat: / to type, Esc to cancel, Space to talk (Mic mode). */
function initKeys() {
  window.addEventListener('keydown', (e) => {
    if (typing(e.target) || dialogOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '/') {
      e.preventDefault();
      setOpen(true);
      el.input.focus();
    } else if (e.key === 'Escape' && request) {
      request.abort();
    } else if (e.code === 'Space' && spacePushToTalk) {
      e.preventDefault();
      if (!e.repeat) startMic();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && spacePushToTalk && voice.isListening()) {
      e.preventDefault();
      stopMic();
    }
  });
}
