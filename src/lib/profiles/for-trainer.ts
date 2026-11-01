/**
 * The signed-in person's profile, for the trainer's instruction, or nothing.
 *
 * The chat route waits on this before the trainer says a word, alongside the deck and
 * the rate limit, so it is built never to be the slow or the failing part of that.
 *
 *  - With PROFILES_ENABLED off it answers at once, without touching storage, and the
 *    instruction is then exactly what it was before profiles existed.
 *  - A read that fails, or takes longer than a fraction of a second, gives no profile
 *    rather than an error or a wait. Teaching somebody without their profile is a
 *    slightly less personal session; refusing to teach them, or making them wait, is a
 *    broken one.
 *
 * Only ever for the person the guard signed in. The browser cannot name whose profile
 * the trainer reads, and nothing it sends in a chat request is a profile.
 */

import 'server-only';

import { profilesEnabled } from '../config';
import { getProfile, type ProfileOwner, type ProfileStoreOptions } from './store';
import type { LearnerProfileRecord } from './types';

/** The same allowance the rate limit gets, for the same reason: it is in every turn. */
const BUDGET_MS = 800;

export interface TrainerProfileOptions extends ProfileStoreOptions {
  budgetMs?: number;
}

export async function profileForTrainer(
  person: ProfileOwner,
  options: TrainerProfileOptions = {},
): Promise<LearnerProfileRecord | undefined> {
  if (!profilesEnabled()) return undefined;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const read = getProfile(person, options);
    // Left to finish on its own if the budget runs out first, with nobody to report a
    // failure to, so a late failure is swallowed rather than left unhandled.
    read.catch(() => undefined);
    const timedOut = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), options.budgetMs ?? BUDGET_MS);
    });
    return await Promise.race([read, timedOut]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
