import { AI_CONFIG } from '../config.js';

// Talks to LM Studio over its OpenAI-compatible API with a plain fetch.
// No server of our own and no API key. The model only ever returns text (JSON);
// it never touches the scene.

/** A failed request, with a message that can be shown to the user as is. */
export class LlmError extends Error {
  constructor(message, kind) {
    super(message);
    this.kind = kind; // 'offline' | 'timeout' | 'cancelled' | 'http'
  }
}

/** Is LM Studio reachable? Also returns the model ids it offers. */
export async function health() {
  try {
    const r = await fetch(`${AI_CONFIG.baseUrl}/models`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return { ok: false, models: [] };
    const data = await r.json();
    return { ok: true, models: (data.data ?? []).map((m) => m.id) };
  } catch {
    return { ok: false, models: [] };
  }
}

/**
 * One chat completion with enforced JSON output. Returns the reply's raw text
 * (the caller parses and validates it). `signal` cancels it (Esc).
 */
export async function chat(messages, schema, signal) {
  let r;
  try {
    r = await fetch(`${AI_CONFIG.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // stop on whichever comes first: user pressed Esc, or the timeout ran out
      signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(AI_CONFIG.timeoutMs)]),
      body: JSON.stringify({
        model: AI_CONFIG.model,
        messages,
        temperature: 0, // same question -> same answer, no creativity needed
        max_tokens: 200,
        // forces the model to answer in our JSON format (REPLY_SCHEMA)
        response_format: { type: 'json_schema', json_schema: { name: 'editor_reply', strict: true, schema } },
      }),
    });
  } catch (err) {
    // fetch itself failed: turn the reason into a clear message
    if (err.name === 'TimeoutError') {
      throw new LlmError(`LM Studio didn't answer within ${AI_CONFIG.timeoutMs / 1000} s.`, 'timeout');
    }
    if (err.name === 'AbortError') throw new LlmError('Cancelled.', 'cancelled');
    throw new LlmError(
      `AI offline: can't reach LM Studio at ${AI_CONFIG.baseUrl}. Is the server running, with CORS enabled?`,
      'offline',
    );
  }
  if (!r.ok) {
    let detail = '';
    try {
      const body = await r.json();
      detail = body.error?.message ?? (typeof body.error === 'string' ? body.error : '');
    } catch {
      // no JSON body
    }
    throw new LlmError(`LM Studio error ${r.status}${detail ? `: ${detail}` : ''}`, 'http');
  }
  const data = await r.json();
  return data.choices?.[0]?.message?.content ?? '';
}
