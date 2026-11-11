import Link from 'next/link';

import { SignOutButton } from './SignOutButton';
import { roleLabel } from '@/lib/auth/labels';
import { profilesEnabledFor, profilesEnabledInOrg } from '@/lib/config';
import { isAdministrator, mayRunSessions } from '@/lib/auth/permissions';
import { mayUseOpenAiTest } from '@/lib/openai-test/access';
import { mayUploadParticipants } from '@/lib/profiles/access';
import type { Role } from '@/lib/roster/types';

/**
 * The links in the header, the same on every page.
 *
 * Each page used to hand-roll its own. The result was a set of screens that could be
 * reached only from certain other screens: `/people` linked home and nowhere else,
 * `/decks` linked home and the upload page, and `/platform` was reachable from exactly
 * one place -- the banner that appears while you are already inside a customer. A
 * platform administrator who was not acting elsewhere had no link to it at all and had
 * to know the URL.
 *
 * What somebody sees is what they may open. An employee has no roster and no deck
 * library, so offering them is offering a page that will refuse them.
 */

export interface NavPerson {
  role: Role;
  /** Technavious staff, who additionally get the customer list. */
  platform: boolean;
  /** Their own customer. Technavious's own administrators also get the OpenAI test. */
  homeOrgId?: string;
  /** The customer they are looking at, which decides whether uploads are on there. */
  orgId?: string;
}

interface MainNavProps {
  person: NavPerson;
  /** The page the viewer is on, so it is not offered as somewhere to go. */
  current?:
    | '/'
    | '/decks'
    | '/people'
    | '/sessions'
    | '/platform'
    | '/audit'
    | '/openai-test'
    | '/profile'
    | '/profiles/upload'
    | '/glossary'
    | '/white-papers';
}

export function MainNav({ person, current }: MainNavProps) {
  const admin = person.role === 'admin';

  const links: { href: string; label: string }[] = [{ href: '/', label: 'Home' }];
  if (admin) {
    links.push({ href: '/people', label: 'People' });
    links.push({ href: '/decks', label: 'Deck library' });
  }
  // Trainer-led sessions and batches: facilitators run their own, administrators all.
  if (mayRunSessions(person)) links.push({ href: '/sessions', label: 'Sessions' });
  if (person.platform) links.push({ href: '/platform', label: 'Customers' });
  // Every Technavious administrator: what went wrong behind the standard messages (AI-11).
  if (isAdministrator(person)) links.push({ href: '/platform/errors', label: 'Developer log' });
  // The administrator's alone (AI-40): who viewed or changed the customer's data, and what
  // every administrator did.
  if (isAdministrator(person)) links.push({ href: '/audit', label: 'Audit history' });
  // The data centre glossary is Technavious's to manage, never a customer's (AI-21).
  if (isAdministrator(person)) links.push({ href: '/glossary', label: 'Glossary' });
  // So are the approved white papers the trainer may draw on (AI-46).
  if (isAdministrator(person)) links.push({ href: '/white-papers', label: 'White papers' });
  // Technavious staff only, never a customer's administrator: see mayUseOpenAiTest.
  if (mayUseOpenAiTest(person)) links.push({ href: '/openai-test', label: 'OpenAI test' });
  // Everybody's own, so offered to everybody, but only where learner profiles are
  // switched on for them. Off, the page is a 404 and the link would be an invitation to one.
  if (profilesEnabledFor(person)) {
    links.push({ href: '/profile', label: 'My profile' });
    if (person.orgId && profilesEnabledInOrg(person.orgId) && mayUploadParticipants(person)) {
      links.push({ href: '/profiles/upload', label: 'Upload participants' });
    }
  }

  return (
    <nav className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {links
        .filter((link) => link.href !== current)
        .map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="text-muted hover:text-teal text-sm whitespace-nowrap transition-colors"
          >
            {link.label}
          </Link>
        ))}

      {/* Which of the three they signed in as. Cheap to show and it settles the
          question the sign-in page just asked them, rather than leaving them to infer
          it from which links appeared. */}
      <span className="text-charcoal-line hidden text-xs sm:inline" aria-hidden="true">
        |
      </span>
      <span className="text-muted text-xs whitespace-nowrap">
        {roleLabel(person.role, person.platform)}
      </span>

      <SignOutButton />
    </nav>
  );
}
