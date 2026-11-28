// App settings in one place: which features are switched on, and where the AI server is.
// One feature flag per input mode, so unfinished voice/camera code never breaks the editor.
// While a flag is false, its button stays a dummy that shows a coming-soon toast.
export const FEATURES = {
  voice: true, // mic push-to-talk in the AI chat + the top Mic mode
  camera: true, // Cam mode: camera preview + hand skeleton
  gestures: true, // Hand settings: record poses / motions and recognize them
  vdoNinja: true, // Accept VDO.Ninja view links as camera sources // VDO.Ninja as a video source in the camera picker
  ai: true, // AI assistant chat panel (LM Studio)
};

// LM Studio's OpenAI-compatible server. `model` must be the exact id from
// http://localhost:1234/v1/models (open it in the browser and copy the "id").
export const AI_CONFIG = {
  baseUrl: 'http://localhost:1234/v1',
  model: 'qwen3-4b',
  timeoutMs: 15000,
};
