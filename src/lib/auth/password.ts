/**
 * What counts as an acceptable password.
 *
 * Pure and importable from both sides, so the browser can say what is wrong before
 * anybody submits and the server can refuse the same thing for the same reason. The
 * server's copy is the one that decides: the browser's is a courtesy.
 *
 * The rules are length-first and deliberately not the classic four-character-classes
 * recipe. That recipe reliably produces `Password1!` and reliably annoys people into
 * reusing whatever passed last time, whereas length is what actually costs an
 * attacker anything. This follows the modern guidance: a real minimum length, a
 * check against the obvious choices, and nothing that forbids a passphrase.
 */

/** Long enough to be worth something, short enough that people will comply. */
export const MIN_PASSWORD_LENGTH = 12;

/** Firebase's own ceiling. */
export const MAX_PASSWORD_LENGTH = 4096;

/**
 * Passwords that are common enough to be tried first, whatever else is true of them.
 *
 * Not a serious dictionary — a serious one belongs in a service, not a source file.
 * These are the ones that turn up when somebody is asked to invent a password on the
 * spot for a tool they were told to use, which is exactly the situation here.
 */
const OBVIOUS = [
  'password',
  'passw0rd',
  'welcome',
  'qwerty',
  'letmein',
  'admin',
  'changeme',
  'training',
  'technavious',
  '123456',
  '12345678',
  'iloveyou',
];

export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters. A short phrase you will remember beats a short word you will not.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return 'That is longer than the maximum allowed.';
  }
  if (password.trim().length === 0) {
    return 'That is only spaces.';
  }

  const lowered = password.toLowerCase();

  if (OBVIOUS.some((entry) => lowered.includes(entry))) {
    return 'That contains something guessed early. Pick something less obvious.';
  }

  // A password built from the address it protects is the first thing tried after the
  // obvious list, and it is a mistake people make precisely when told to hurry.
  const local = email?.trim().toLowerCase().split('@')[0];
  if (local && local.length >= 3 && lowered.includes(local)) {
    return 'Do not build it out of your email address.';
  }

  // One repeated character reaches any length requirement without reaching any of
  // the point of one.
  if (new Set(password).size < 5) {
    return 'That repeats too few different characters.';
  }

  return null;
}

/** Rough guidance for the person typing, not a security claim. */
export function passwordStrength(password: string): 'weak' | 'fair' | 'good' {
  if (passwordProblem(password) !== null) return 'weak';
  if (password.length >= 20 || new Set(password).size >= 14) return 'good';
  return 'fair';
}
