/**
 * Cleaning text that is about to be spoken aloud.
 *
 * This lives in its own module, importable from the browser, because it has to
 * run on the client. It used to live in trainer-prompt.ts and be applied only on
 * the server, where it did nothing at all: the route sanitised the reply into a
 * `done` server-sent event, the client never handled `done`, and the text to
 * speech player was fed the raw streamed deltas instead. The safety net was
 * connected to nothing for its entire life, and it was invisible because the
 * function itself was correct and unit tested. Now it is applied at the one point
 * where text becomes audio.
 */

/** Below this, a fragment is too short to be worth its own request. */
export const MIN_CHUNK_CHARS = 60;

/** Above this we cut regardless, so a long clause never stalls playback. */
export const MAX_CHUNK_CHARS = 320;

/**
 * Where to cut streamed text into the next piece worth speaking, or -1 to wait for more.
 *
 * A sentence ending followed by whitespace is the safe place. The danda is how Hindi ends
 * a sentence, and without it Hindi waited for 320 characters before making a sound, then
 * cut wherever that landed.
 *
 * Past the length limit with no sentence ending, a comma will do, and failing that the
 * last space. Never inside a word: in English that splits a word between two requests,
 * and in Devanagari it can separate a consonant from the vowel sign that belongs to it,
 * which the voice then reads as two different sounds.
 */
export function nextSpeechCut(buffer: string): number {
  if (buffer.length < MIN_CHUNK_CHARS) return -1;

  const sentenceEnd = /[.!?।॥](?=\s)/g;
  let match: RegExpExecArray | null;
  while ((match = sentenceEnd.exec(buffer)) !== null) {
    if (match.index + 1 >= MIN_CHUNK_CHARS) return match.index + 1;
  }

  if (buffer.length < MAX_CHUNK_CHARS) return -1;

  const comma = buffer.lastIndexOf(', ', MAX_CHUNK_CHARS);
  if (comma > MIN_CHUNK_CHARS) return comma + 1;

  const space = buffer.lastIndexOf(' ', MAX_CHUNK_CHARS);
  return space > MIN_CHUNK_CHARS ? space : MAX_CHUNK_CHARS;
}

/**
 * Strips anything that would sound wrong when spoken.
 *
 * The prompt asks the model to avoid all of this and mostly it does, but a demo
 * should not depend on that holding every single turn.
 */
export function sanitiseForSpeech(text: string): string {
  return (
    text
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[*_#`>|]/g, '')
      .replace(/^\s*[-•–]\s+/gm, '')
      .replace(/^\s*\d+[.)]\s+/gm, '')
      // A dash with space around it is punctuation, whichever dash it is, and a
      // comma is how it should be read aloud. An en dash with no space around it
      // is a numeric range such as "30-45 days", so it has to survive: the brand
      // guidelines permit it there and nowhere else.
      .replace(/\s+[–—―−]+\s+/g, ', ')
      // An em dash is never a range, so any that are left are punctuation too.
      .replace(/[—―]/g, ', ')
      .replace(/\r/g, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/ ,/g, ',')
      .replace(/,{2,}/g, ',')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}
