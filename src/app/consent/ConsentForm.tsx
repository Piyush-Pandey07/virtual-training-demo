'use client';

/**
 * Agreeing to the notice, and for a participant confirming their profile with it.
 *
 * The required fields are checked here before sending, with the same rule the server
 * applies, so somebody sees what is missing at once; the server checks again, because
 * this is the browser.
 */

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import { ProfileConsent } from '@/components/ProfileConsent';
import { ProfileFields } from '@/components/ProfileFields';
import { giveConsent, type ProfileFormValues } from '@/lib/profiles/client';
import { describeMissing, readDetails } from '@/lib/profiles/validate';

export function ConsentForm({
  participant,
  initial,
  uploaded,
  destination,
}: {
  participant: boolean;
  initial: ProfileFormValues;
  /** Their organisation filled it in and they have not confirmed it yet. */
  uploaded: boolean;
  destination: string;
}) {
  const id = useId();
  const router = useRouter();
  const [values, setValues] = useState<ProfileFormValues>(initial);
  const [consented, setConsented] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (participant) {
      const read = readDetails(values);
      if (!read.ok) {
        setError(read.error);
        return;
      }
      const missing = describeMissing(read.details);
      if (missing) {
        setError(missing);
        return;
      }
    }
    setSaving(true);
    const result = await giveConsent(participant ? values : null);
    if (!result.ok) {
      setSaving(false);
      setError(result.error);
      return;
    }
    // Replaced rather than pushed, so Back does not return to a page that would only
    // send them on again, and refreshed so the guard reads the new agreement.
    router.replace(destination);
    router.refresh();
  };

  return (
    <div className="mt-8">
      {participant && uploaded && (
        <p
          role="status"
          className="border-teal/40 bg-teal/10 rounded-md border p-4 text-sm leading-relaxed"
        >
          Your organisation has filled in some of this for you. Check it, correct anything that is
          wrong and complete what is missing. Nothing in it is used until you confirm it.
        </p>
      )}

      {participant && (
        <ProfileFields idPrefix={id} values={values} onChange={setValues} disabled={saving} />
      )}

      <ProfileConsent
        id={`${id}-consent`}
        checked={consented}
        onChange={setConsented}
        disabled={saving}
        open
      />

      {error && (
        <p role="alert" className="text-logo-red mt-4 text-sm">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={saving || !consented}
        className="bg-azure text-mist hover:bg-teal hover:text-charcoal mt-6 rounded-md px-6 py-3 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
      >
        {saving ? 'Saving' : participant ? 'Confirm and continue' : 'Agree and continue'}
      </button>
    </div>
  );
}
