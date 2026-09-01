import Link from 'next/link';

import { currentPerson } from '@/lib/auth/session';
import { orgStore, orgsConfigured } from '@/lib/orgs/registry';

/**
 * A standing reminder that you are inside somebody else's company.
 *
 * Support tools go wrong not when somebody gets into a customer but when they forget
 * they are in one — reading a roster full of strangers as though it were their own, or
 * publishing a deck into a company that did not ask for it. So this sits above every
 * page, in a colour that does not blend in, until they leave.
 *
 * Renders nothing at all for everybody else, which is almost everybody: a customer's
 * own administrator can never be anywhere but their own organisation.
 */
export async function ActingBanner() {
  const person = await currentPerson().catch(() => null);
  if (!person || !person.platform || person.orgId === person.homeOrgId) return null;

  const organisation = orgsConfigured()
    ? await orgStore()
        .get(person.orgId)
        .catch(() => undefined)
    : undefined;

  return (
    <div
      role="status"
      className="border-teal/50 bg-teal/15 text-mist flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-5 py-2 text-sm sm:px-8"
    >
      <span>
        Looking inside <span className="font-semibold">{organisation?.name ?? person.orgId}</span>.
        Everything on this page is theirs.
      </span>
      <Link href="/platform" className="text-teal font-semibold underline underline-offset-2">
        Customers
      </Link>
    </div>
  );
}
