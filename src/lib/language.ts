/**
 * What a session's language means for each part of it.
 *
 * Importable from the browser. The lobby, the session hook, the speech routes and the
 * chat route all have to agree on these, and a value that arrives from the browser is
 * never trusted as given: anything that is not exactly Hindi is English, which is what
 * every session was before there was a choice.
 */

import type { SessionLanguage } from './types';

export function sessionLanguage(raw: unknown): SessionLanguage {
  return raw === 'hi' ? 'hi' : 'en';
}

/**
 * What Deepgram is told to listen for.
 *
 * English is exactly what it always was. Hindi uses Nova-3's code-switching mode rather
 * than its monolingual Hindi, because nobody here talks about a UPS or a chiller in Hindi
 * words. A trainee says "UPS का backup कितना होता है", and the English in that sentence
 * has to come back as English for "next slide", said in the middle of Hindi, to still be
 * recognised as a request to move on.
 */
export function listeningLanguage(language: SessionLanguage): 'en' | 'multi' {
  return language === 'hi' ? 'multi' : 'en';
}
