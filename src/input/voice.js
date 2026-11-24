// Push-to-talk speech -> text with the Web Speech API (Chrome sends the audio to
// Google, so it needs internet). The text goes to the same runAI() as typing; this
// module only turns speech into words. Chrome asks for the microphone on first use.

let rec = null;

/** Does this browser have speech recognition? (Not Firefox.) */
export function isSupported() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export const isListening = () => rec !== null; // is the mic on right now?

/**
 * Start listening (button / Space held down).
 * onText(text) while speaking (live, interim words); onDone(finalText, error) once it
 * stops; error is a Web Speech code such as 'not-allowed', 'no-speech', 'network'.
 */
export function startListening({ onText, onDone }) {
  if (rec) return;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  rec = new Recognition();
  rec.lang = 'en-US';
  rec.interimResults = true;
  rec.continuous = true; // keep listening through short pauses while the button is held
  let finalText = '';
  let interim = '';
  let error = null;

  // finished phrases are added to finalText; the phrase still being spoken is "interim"
  rec.onresult = (e) => {
    interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    onText?.((finalText + interim).trim());
  };
  rec.onerror = (e) => {
    error = e.error;
  };
  rec.onend = () => {
    rec = null;
    // released before the last words were final: use what was heard so far
    onDone?.(error ? '' : (finalText || interim).trim(), error);
  };

  try {
    rec.start();
  } catch {
    rec = null;
    onDone?.('', 'start-failed');
  }
}

/** Button / Space released: stop and deliver the final text. */
export function stopListening() {
  rec?.stop();
}
