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
