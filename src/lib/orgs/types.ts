/**
 * Customer companies, and the two lookups that find one.
 *
 * The app was built for a single company and sold to one; it is now a product, and
 * every person, deck, assignment and attempt belongs to a customer. This is the type
 * that makes that sayable — until it exists, the isolation cannot be expressed at all,
 * let alone enforced.
 *
 * Types only, and free of imports, so both the server and the browser can hold them.
 */

/** A customer company. */
export interface Organisation {
  /** Slug, and the storage prefix everything of theirs lives under: `orgs/{id}/...`. */
  id: string;
  /**
   * As they spell it.
   *
   * Shown to their own administrators so somebody looking at a roster can tell whose
   * it is. Not branding: this stays a Technavious product, and their name appearing is
   * an operational safeguard rather than a white label.
   */
  name: string;
  /**
   * Email domains whose people belong here, lowercased and without the `@`.
   *
   * A domain belongs to exactly one organisation. That is held by `DomainClaim` being
   * keyed on the domain rather than by a check here, so two customers cannot both
   * claim `acme.com` even if two people provision at the same moment.
   */
  domains: string[];
  /** ISO 8601. */
  createdAt: string;
  /**
   * Suspended refuses sign-in and leaves everything else alone.
   *
   * A customer who stops paying should lose access without losing their records: the
   * training somebody completed is evidence about a person, and deleting it because an
   * invoice lapsed is the wrong default. Deleting is a separate, deliberate act.
   */
  status: 'active' | 'suspended';
  limits: OrganisationLimits;
}

export interface OrganisationLimits {
  /**
   * Sessions a month before new ones are refused. Null is uncapped.
   *
   * Checked when a session starts rather than after the fact, because the bill for a
   * runaway customer arrives a month after the runaway.
   */
  sessionsPerMonth: number | null;
}

/**
 * Which organisation a signed-in person belongs to.
 *
 * The one lookup that cannot itself be scoped by organisation, because it is what
 * answers that question. Read at sign-in only: from there the answer rides in the
 * session cookie as a claim, so no request pays for it twice.
 */
export interface DirectoryEntry {
  /** The auth provider's uid. Also this document's id. */
  uid: string;
  orgId: string;
  emailKey: string;
}

/**
 * Which organisation an email domain belongs to.
 *
 * Keyed on the domain, so the "one domain, one customer" rule is structural. This is
 * what lets a new employee at a known customer sign themselves in and land in the
 * right company, and what refuses an address belonging to no customer at all.
 */
export interface DomainClaim {
  /** Lowercased, no `@`. Also this document's id. */
  domain: string;
  orgId: string;
}

/** The organisation the deployment's own people belong to. */
export const HOME_ORG_ID = 'technavious';

/**
 * Whether a string is usable as an organisation id.
 *
 * It becomes a storage prefix, so the characters that would change what a path means
 * are the ones to refuse: a slash invents a nesting level, a dot can climb out of one,
 * and leading or trailing whitespace produces two organisations that look identical in
 * a console and are not.
 */
export function isUsableOrgId(id: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(id);
}

/** Lowercases and strips a leading `@`, so `@Acme.COM` and `acme.com` are one domain. */
export function domainKeyOf(domain: string): string {
  return domain.trim().toLowerCase().replace(/^@/, '');
}
