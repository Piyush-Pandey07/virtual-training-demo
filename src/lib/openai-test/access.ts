/**
 * Who may use the OpenAI test.
 *
 * Technavious's own administrators and platform staff, and nobody at a customer. It is an
 * internal evaluation of a possible voice provider: a customer's administrator has no use
 * for it, should not find a vendor comparison inside a product they bought, and must not
 * be able to spend Technavious's OpenAI account.
 *
 * Safe to import anywhere. The navigation uses it to decide whether to show the button,
 * and the page and both routes use it to refuse everybody else.
 */

import { HOME_ORG_ID } from '../orgs/types';

export interface OpenAiTestCandidate {
  role: string;
  platform: boolean;
  /** The customer this person belongs to, as opposed to one they are looking inside. */
  homeOrgId?: string;
}

export function mayUseOpenAiTest(person: OpenAiTestCandidate): boolean {
  return person.platform || (person.role === 'admin' && person.homeOrgId === HOME_ORG_ID);
}
