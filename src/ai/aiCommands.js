import * as objects from '../scene/objects.js';
import * as selection from '../scene/selection.js';
import { dispatch } from '../intents/dispatcher.js';
import { chat } from './llmClient.js';
import { describeScene } from './sceneContext.js';
import { buildMessages, REPLY_SCHEMA } from './prompt.js';
import { parseReply, validateActions } from './validate.js';

// One sentence in, one reply out. The AI only READS the scene (objects.all(),
// selection.get()) and changes it only through dispatch(intent, 'ai'), like every
// other input, so undo, Past actions and autosave work unchanged.

/**
 * Typing and the mic both end up here.
 * @returns {Promise<{ reply: string, actions: { shape, color, colorName, count }[] }>}
 */
export async function runAI(text, signal) {
  // 1. scene -> text, 2. ask the model, 3. read its JSON, 4. keep only safe actions
  const scene = describeScene(objects.all(), selection.get());
  const raw = await chat(buildMessages(scene, text), REPLY_SCHEMA, signal);
  const answer = parseReply(raw);
  const { actions, capped } = validateActions(answer.actions);

  // 5. "3 red cubes" = 3 separate add intents (3 undo steps)
  for (const a of actions) {
    for (let i = 0; i < a.count; i++) dispatch({ type: 'add', shape: a.shape, color: a.color }, 'ai');
  }

  // pick the text the user sees, based on what was really created
  const created = actions.reduce((n, a) => n + a.count, 0);
  let reply = answer.reply;
  if (!created && answer.actions.length) reply = "I couldn't create that. I can make cubes, spheres, cones, cylinders, rods and hearts.";
  if (!reply) reply = created ? `Added ${created} object${created > 1 ? 's' : ''}.` : "Sorry, I didn't get that.";
  // the model's own sentence may promise more than was made: say what really happened
  if (capped) reply = `Added ${created} object${created > 1 ? 's' : ''} (at most 10 per request).`;
  return { reply, actions };
}
