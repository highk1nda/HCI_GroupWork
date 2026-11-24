import { SHAPES, PALETTE } from '../types.js';

// Never trust the model's answer blindly: parse it carefully, then keep only actions
// the editor can actually do. Pure functions, unit-tested without LM Studio.

export const MAX_PER_REQUEST = 10; // new objects per sentence
const COLOR_BY_NAME = Object.fromEntries(PALETTE.map((c) => [c.name, c.hex]));

/** The answer couldn't be read as our JSON. */
export class UnreadableReply extends Error {
  constructor() {
    super('AI gave an unreadable answer, try again.');
  }
}

/**
 * Raw model text -> { reply, actions }. Tolerates a leftover <think> block or text
 * around the JSON; anything else throws UnreadableReply.
 */
export function parseReply(text) {
  const cleaned = String(text ?? '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim();
  let data;
  try {
    data = JSON.parse(cleaned);
  } catch {
    // not pure JSON: try just the part from the first { to the last }
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    try {
      data = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      throw new UnreadableReply();
    }
  }
  if (!data || typeof data !== 'object') throw new UnreadableReply();
  return {
    reply: typeof data.reply === 'string' ? data.reply.trim() : '',
    actions: Array.isArray(data.actions) ? data.actions : [],
  };
}

/**
 * Keep only valid "add" actions: known shape, count clamped to 1-10, at most 10 objects in total.
 * color: palette hex, or undefined = the current default color.
 * @returns {{ actions: { shape: string, color: string | undefined, colorName: string, count: number }[], dropped: number, capped: boolean }}
 */
export function validateActions(raw) {
  const actions = [];
  let total = 0;
  let dropped = 0;
  let capped = false;
  for (const a of raw ?? []) {
    if (!a || a.op !== 'add' || !SHAPES.includes(a.shape)) {
      dropped++;
      continue;
    }
    if (total >= MAX_PER_REQUEST) {
      capped = true;
      break;
    }
    const asked = Math.max(1, Math.trunc(Number(a.count)) || 1); // missing or weird count -> 1
    const count = Math.min(asked, 10, MAX_PER_REQUEST - total); // never more than what's left of the 10
    if (count < asked) capped = true;
    const color = COLOR_BY_NAME[a.color]; // 'default' or anything unknown -> undefined
    actions.push({ shape: a.shape, color, colorName: color ? a.color : 'default', count });
    total += count;
  }
  return { actions, dropped, capped };
}
