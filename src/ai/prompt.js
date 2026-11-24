import { SHAPES, PALETTE } from '../types.js';

// What the model is told: the system prompt, a few worked examples (for a 4B model
// these matter more than the instructions) and the JSON schema its answer must follow.

export const SYSTEM_PROMPT = `/no_think
You are the assistant inside a small 3D editor. The user types or says one sentence.
You can do exactly two things:

1. Create shapes. Shapes: ${SHAPES.join(', ')}. Colors: ${PALETTE.map((c) => c.name).join(', ')}.
   If no color is given, use "default". Number words mean the count ("three" = 3, "a" = 1).
   Synonyms: ball, circle, globe = sphere. box, square, block = cube. pyramid, triangle = cone.
   stick, pole, line = rod. can, tube = cylinder.
   If the user asks for a shape that is not in the list, create nothing and say which shapes you can make.
2. Answer questions about the scene in one or two short sentences, using ONLY the scene
   snapshot in the message. Never invent objects. For "how many", use the Counts line.

For anything else (moving, rotating, scaling, recoloring, deleting, or questions not about
the scene) reply exactly "I can only create shapes and describe the scene for now." with no actions.
"reply" is the short sentence the user sees. "actions" lists the shapes to create (empty for questions).`;

// small helpers to write the example chat turns below
const json = (o) => JSON.stringify(o);
const user =(scene, command) => ({ role: 'user', content: `${scene}\n\nCommand: ${command}` });
const assistant = (reply, actions = []) => ({ role: 'assistant', content: json({ reply, actions }) });

const EMPTY = 'Scene: 0 objects. Selected: none.\nCounts: none.';
const TWO = [
  'Scene: 2 objects. Selected: cube-1.',
  '- cube-1: cube, blue, at (0, 0.5, 0), size 1',
  '- sphere-1: sphere, white, at (1.5, 0.5, 0), size 1',
  'Counts: cube 1, sphere 1.',
].join('\n');

// fake past conversation: shows the model what a good answer looks like
export const EXAMPLES = [
  user(EMPTY, 'add a red ball'),
  assistant('Added a red sphere.', [{ op: 'add', shape: 'sphere', color: 'red', count: 1 }]),
  user(TWO, 'make three green pyramids and a box'),
  assistant('Added 3 green cones and a cube.', [
    { op: 'add', shape: 'cone', color: 'green', count: 3 },
    { op: 'add', shape: 'cube', color: 'default', count: 1 },
  ]),
  user(TWO, 'what color is the cube?'),
  assistant('The cube (cube-1) is blue.'),
  user(TWO, 'move the cube to the left'),
  assistant('I can only create shapes and describe the scene for now.'),
];

/** Build the full message list for one command. */
export function buildMessages(scene, command) {
  return [{ role: 'system', content: SYSTEM_PROMPT }, ...EXAMPLES, user(scene, command)];
}

/** The model can only answer in this shape (LM Studio structured output). */
export const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    actions: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        properties: {
          op: { enum: ['add'] },
          shape: { enum: [...SHAPES] },
          color: { enum: [...PALETTE.map((c) => c.name), 'default'] },
          count: { type: 'integer', minimum: 1, maximum: 10 },
        },
        required: ['op', 'shape', 'color', 'count'],
        additionalProperties: false,
      },
    },
  },
  required: ['reply', 'actions'],
  additionalProperties: false,
};
