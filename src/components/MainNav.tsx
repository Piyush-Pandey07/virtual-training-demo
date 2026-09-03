import Link from 'next/link';

import { SignOutButton } from './SignOutButton';
import { roleLabel } from '@/lib/auth/labels';
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
}

interface MainNavProps {
  person: NavPerson;
  /** The page the viewer is on, so it is not offered as somewhere to go. */
  current?: '/' | '/decks' | '/people' | '/platform';
}

export function MainNav({ person, current }: MainNavProps) {
  const admin = person.role === 'admin';

  const links: { href: string; label: string }[] = [{ href: '/', label: 'Home' }];
  if (admin) {
    links.push({ href: '/people', label: 'People' });
    links.push({ href: '/decks', label: 'Deck library' });
  }
  if (person.platform) links.push({ href: '/platform', label: 'Customers' });

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
