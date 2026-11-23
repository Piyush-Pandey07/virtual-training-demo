/**
 * How a customer's monthly allowance reads: no cap, plenty left, getting close, or used up.
 *
 * Kept apart from `limits.ts`, which reads the database and is server-only, so the screen
 * and the tests can use it without either.
 */
export type AllowanceTone = 'unlimited' | 'fine' | 'nearly' | 'reached';

export function allowanceTone(allowance: { used: number; limit: number | null }): AllowanceTone {
  if (allowance.limit === null) return 'unlimited';
  if (allowance.used >= allowance.limit) return 'reached';
  // Within a fifth of the cap, or two sessions, whichever is more, is worth a warning.
  const margin = Math.max(2, Math.ceil(allowance.limit * 0.2));
  return allowance.limit - allowance.used <= margin ? 'nearly' : 'fine';
}
