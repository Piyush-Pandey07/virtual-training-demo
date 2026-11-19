/**
 * What the upload page says happened to each participant, and to the file as a whole.
 *
 * Words only, with no imports beyond the result types, so the page and the tests read
 * the same sentences.
 *
 * The case these exist for is a file uploaded a second time. Somebody already here has
 * one of two things done to their profile, and the uploader has to be able to tell which
 * without knowing how it is stored. If they have confirmed their own profile it is left
 * exactly as it is, and the row says so in those words. If nobody has confirmed one yet,
 * what is stored is only the organisation's own earlier upload, and the newer file
 * replaces it. The row used to read "Updated. Profile prefilled." for the second and
 * "Updated." before "left as it is" for the first, which between them read as though a
 * second upload overwrote whatever a participant had entered. It never did.
 */

import type { UploadResult, UploadSummary } from './upload';

/** What an imported row says in the Details column. */
export function describeImported(
  result: Pick<UploadResult, 'status' | 'profile' | 'missing'>,
): string {
  const here = result.status === 'updated';
  const who = here ? 'Already here.' : 'Created.';
  if (result.profile === 'kept') {
    return `${who} They have confirmed their own profile, so it was left exactly as it is.`;
  }
  const asked =
    result.missing && result.missing.length > 0
      ? `They will be asked for: ${result.missing.join(', ').toLowerCase()}.`
      : null;
  if (here) {
    return (
      `${who} They have not confirmed a profile yet, so it was prefilled from this file. ` +
      (asked ?? 'They will confirm it when they next sign in.')
    );
  }
  return `${who} Profile prefilled. ${asked ?? 'They will confirm it on their first visit.'}`;
}

/** The line above the tables: how the whole file went. */
export function describeUpload(
  results: readonly Pick<UploadResult, 'status' | 'profile'>[],
  summary: UploadSummary,
): string {
  const imported = summary.created + summary.updated;
  const kept = results.filter((result) => result.profile === 'kept').length;
  return (
    `${imported} imported (${summary.created} new, ${summary.updated} already here), ` +
    `${summary.duplicates} ${summary.duplicates === 1 ? 'duplicate' : 'duplicates'}, ` +
    `${summary.rejected} failed.` +
    (summary.incomplete > 0
      ? ` ${summary.incomplete} will be asked to complete required fields on their first visit.`
      : '') +
    (kept > 0
      ? ` ${kept} already here ${kept === 1 ? 'has' : 'have'} confirmed their own ` +
        `${kept === 1 ? 'profile, which was left as it is.' : 'profiles, which were left as they are.'}`
      : '')
  );
}
