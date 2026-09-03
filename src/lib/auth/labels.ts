import type { Role } from '../roster/types';

/**
 * What each kind of person is called, everywhere.
 *
 * The sign-in page asks people to choose between Admin, Company and Employee, so those
 * are the three words the rest of the app has to use. It did not: the same person was
 * "HR" on their profile, "administrator" in the list and "Company" at sign-in, and a
 * button offered to "Make HR" a role nothing else mentioned.
 *
 * The stored role is still `admin` or `trainee` and deliberately stays that way. It is
 * the thing every guard compares against and it appears in existing rows, custom claims
 * and tests; renaming it would be a migration with nothing at the end of it. What a
 * person is *called* is a display concern, and this is the one place that decides it.
 *
 * No imports beyond the role type, so both halves of a page can use it.
 */

export type RoleLabel = 'Admin' | 'Company' | 'Employee';

/**
 * The label for somebody, given their stored role and whether they are our own staff.
 *
 * Platform staff are administrators inside every customer, so role alone cannot tell
 * these apart -- and calling Technavious support "Company" on a customer's own screen
 * would read as though the customer had another administrator they did not know about.
 */
export function roleLabel(role: Role, platform = false): RoleLabel {
  if (platform) return 'Admin';
  return role === 'admin' ? 'Company' : 'Employee';
}

/** What each one may do, in the same words the sign-in page uses. */
export const ROLE_BLURB: Record<RoleLabel, string> = {
  Admin: 'Technavious. Sees every company using this platform.',
  Company: 'Uploads decks, assigns them, and sees who has attended at their company.',
  Employee: 'Attends the training assigned to them.',
};

/** The label for the role somebody would have if their role were switched. */
export function otherRoleLabel(role: Role): RoleLabel {
  return role === 'admin' ? 'Employee' : 'Company';
}
