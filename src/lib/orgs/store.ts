import 'server-only';

import type { DocumentStore } from '../roster/documents';
import {
  domainKeyOf,
  isUsableOrgId,
  type DirectoryEntry,
  type DomainClaim,
  type Organisation,
  type OrganisationLimits,
} from './types';

/**
 * Customer companies, and the two lookups that find one.
 *
 * These three collections are the only ones in the deployment that are *not* scoped to
 * an organisation, and they cannot be: they are what answers the question "which
 * organisation is this?". Everything else lives under `orgs/{orgId}/` and is reached
 * through a store that was handed an id when it was built, so a query cannot forget to
 * filter by one.
 *
 * That asymmetry is the whole design. It is why this file is short and why it is the
 * one to read carefully.
 */

const ORGANISATIONS = 'organisations';
const DIRECTORY = 'directory';
const DOMAINS = 'directory-domains';

export class OrgStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrgStoreError';
  }
}

export interface OrganisationInput {
  id: string;
  name: string;
  domains?: string[];
  limits?: Partial<OrganisationLimits>;
}

const NO_LIMITS: OrganisationLimits = { sessionsPerMonth: null };

export class OrgStore {
  constructor(private readonly docs: DocumentStore) {}

  readonly kind = 'documents';

  // ------------------------------------------------------------ organisations

  async list(): Promise<Organisation[]> {
    const rows = await this.docs.all<Organisation>(ORGANISATIONS);
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: string): Promise<Organisation | undefined> {
    return this.docs.get<Organisation>(ORGANISATIONS, id);
  }

  /**
   * Creates a customer, claiming its domains in the same call.
   *
   * Refuses rather than overwrites. Provisioning is a deliberate act performed by a
   * person, and the failure mode of a silent overwrite here is pointing an existing
   * customer's domain at a new empty organisation — which would strand their people
   * outside their own records without deleting anything, so nothing would look wrong.
   */
  async create(input: OrganisationInput, now: string): Promise<Organisation> {
    const id = input.id.trim().toLowerCase();
    if (!isUsableOrgId(id)) {
      throw new OrgStoreError(
        `"${input.id}" cannot be an organisation id. Use lowercase letters, digits and hyphens.`,
      );
    }

    const name = input.name.trim();
    if (!name) throw new OrgStoreError('An organisation needs a name.');

    if (await this.get(id)) {
      throw new OrgStoreError(`There is already an organisation called "${id}".`);
    }

    const domains = normaliseDomains(input.domains ?? []);
    // Checked before anything is written, so a clash leaves nothing half-created.
    for (const domain of domains) {
      const claim = await this.orgIdForDomain(domain);
      if (claim) {
        throw new OrgStoreError(`The domain "${domain}" already belongs to "${claim}".`);
      }
    }

    const organisation: Organisation = {
      id,
      name,
      domains,
      createdAt: now,
      status: 'active',
      limits: { ...NO_LIMITS, ...input.limits },
    };

    await this.docs.set<Organisation>(ORGANISATIONS, id, organisation);
    for (const domain of domains) {
      await this.docs.set<DomainClaim>(DOMAINS, domain, { domain, orgId: id });
    }

    return organisation;
  }

  async setStatus(id: string, status: Organisation['status']): Promise<Organisation> {
    const existing = await this.get(id);
    if (!existing) throw new OrgStoreError(`No organisation called "${id}".`);

    const updated: Organisation = { ...existing, status };
    await this.docs.set<Organisation>(ORGANISATIONS, id, updated);
    return updated;
  }

  async setLimits(id: string, limits: Partial<OrganisationLimits>): Promise<Organisation> {
    const existing = await this.get(id);
    if (!existing) throw new OrgStoreError(`No organisation called "${id}".`);

    const updated: Organisation = { ...existing, limits: { ...existing.limits, ...limits } };
    await this.docs.set<Organisation>(ORGANISATIONS, id, updated);
    return updated;
  }

  // ------------------------------------------------------------------ domains

  /** Adds a domain to an organisation, refusing one another customer already holds. */
  async claimDomain(orgId: string, domain: string): Promise<Organisation> {
    const organisation = await this.get(orgId);
    if (!organisation) throw new OrgStoreError(`No organisation called "${orgId}".`);

    const key = domainKeyOf(domain);
    if (!key.includes('.')) throw new OrgStoreError(`"${domain}" is not a domain.`);

    const held = await this.orgIdForDomain(key);
    if (held && held !== orgId) {
      throw new OrgStoreError(`The domain "${key}" already belongs to "${held}".`);
    }

    await this.docs.set<DomainClaim>(DOMAINS, key, { domain: key, orgId });

    if (organisation.domains.includes(key)) return organisation;
    const updated: Organisation = {
      ...organisation,
      domains: [...organisation.domains, key].sort(),
    };
    await this.docs.set<Organisation>(ORGANISATIONS, orgId, updated);
    return updated;
  }

  async releaseDomain(orgId: string, domain: string): Promise<void> {
    const key = domainKeyOf(domain);
    const held = await this.orgIdForDomain(key);
    // Releasing somebody else's domain would hand their people to whoever asked next.
    if (held && held !== orgId) {
      throw new OrgStoreError(`The domain "${key}" belongs to "${held}", not to "${orgId}".`);
    }

    await this.docs.remove(DOMAINS, key);

    const organisation = await this.get(orgId);
    if (!organisation) return;
    await this.docs.set<Organisation>(ORGANISATIONS, orgId, {
      ...organisation,
      domains: organisation.domains.filter((entry) => entry !== key),
    });
  }

  /** Which customer an address's domain belongs to, or undefined for none. */
  async orgIdForDomain(domain: string): Promise<string | undefined> {
    const claim = await this.docs.get<DomainClaim>(DOMAINS, domainKeyOf(domain));
    return claim?.orgId;
  }

  /** Which customer an email address belongs to, by its domain. */
  async orgIdForEmail(email: string): Promise<string | undefined> {
    const domain = email.trim().toLowerCase().split('@')[1];
    return domain ? this.orgIdForDomain(domain) : undefined;
  }

  // ---------------------------------------------------------------- directory

  /**
   * Which organisation a uid belongs to.
   *
   * Read at sign-in, to mint the claim that carries the answer for the rest of the
   * session. Not read per request: that would put an unscoped lookup on the hot path
   * of every page, which is both slow and exactly the kind of call this design is
   * trying to make rare enough to audit.
   */
  async orgIdForUid(uid: string): Promise<string | undefined> {
    const entry = await this.docs.get<DirectoryEntry>(DIRECTORY, uid);
    return entry?.orgId;
  }

  /**
   * Which customer already holds an address, anywhere in the deployment.
   *
   * The only question in the app that legitimately spans customers, and it exists to
   * enforce that somebody belongs to exactly one. A scoped roster cannot answer it --
   * it would look in one customer and report "not found" for a person sitting in
   * another, which is how the same human ends up in two companies with two sets of
   * training records and no way to tell.
   */
  async orgIdHolding(emailKey: string): Promise<string | undefined> {
    const rows = await this.docs.where<DirectoryEntry>(
      DIRECTORY,
      'emailKey',
      emailKey.trim().toLowerCase(),
    );
    return rows[0]?.orgId;
  }

  async remember(entry: DirectoryEntry): Promise<void> {
    await this.docs.set<DirectoryEntry>(DIRECTORY, entry.uid, entry);
  }

  async forget(uid: string): Promise<void> {
    await this.docs.remove(DIRECTORY, uid);
  }
}

function normaliseDomains(domains: string[]): string[] {
  const keys = domains.map(domainKeyOf).filter((entry) => entry.includes('.'));
  return [...new Set(keys)].sort();
}
