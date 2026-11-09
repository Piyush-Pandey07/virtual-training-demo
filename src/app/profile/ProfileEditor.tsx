'use client';

/**
 * Viewing and changing one's own profile, or withdrawing consent.
 *
 * Saving asks for the consent box every time, so every stored profile records agreement
 * to the notice that was on screen when it was last changed. Withdrawing asks once more
 * before it acts, because the profile it deletes cannot be brought back.
 */

import { useId, useState } from 'react';

import { ProfileConsent } from '@/components/ProfileConsent';
import { ProfileFields } from '@/components/ProfileFields';
import { saveProfile, withdrawConsent, type ProfileFormValues } from '@/lib/profiles/client';
import { describeMissing, readDetails } from '@/lib/profiles/validate';

type Status = 'idle' | 'saving' | 'confirming' | 'withdrawing';

export function ProfileEditor({
  initial,
  exists,
  withdrawn,
}: {
  initial: ProfileFormValues;
  exists: boolean;
  withdrawn: boolean;
}) {
  const id = useId();
  const [values, setValues] = useState<ProfileFormValues>(initial);
  const [stored, setStored] = useState(exists);
  const [hasWithdrawn, setHasWithdrawn] = useState(withdrawn);
  const [consented, setConsented] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const busy = status === 'saving' || status === 'withdrawing';

  const save = async () => {
    setError(null);
    setMessage(null);
    const read = readDetails(values);
    if (!read.ok) return setError(read.error);
    const missing = describeMissing(read.details);
    if (missing) return setError(missing);

    setStatus('saving');
    const result = await saveProfile(values, consented);
    setStatus('idle');
    if (!result.ok) return setError(result.error);
    setConsented(false);
    setStored(true);
    setHasWithdrawn(false);
    setMessage('Saved. The trainer will use this from your next turn.');
  };

  const withdraw = async () => {
    setStatus('withdrawing');
    setError(null);
    setMessage(null);
    const result = await withdrawConsent();
    if (!result.ok) {
      setStatus('confirming');
      setError(result.error);
      return;
    }
    setStatus('idle');
    setValues({});
    setConsented(false);
    setStored(false);
    setHasWithdrawn(true);
    setMessage(
      'Your consent is withdrawn and your profile is deleted. Your training carries on without it.',
    );
  };

  return (
    <div className="mt-6">
      <ProfileFields idPrefix={id} values={values} onChange={setValues} disabled={busy} />

      <ProfileConsent
        id={`${id}-consent`}
        checked={consented}
        onChange={setConsented}
        disabled={busy}
      />

      {error && (
        <p role="alert" className="text-logo-red mt-4 text-sm">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-teal mt-4 text-sm">
          {message}
        </p>
      )}

      <button
        type="button"
        onClick={() => void save()}
        disabled={busy || !consented}
        className="bg-azure text-mist hover:bg-teal hover:text-charcoal mt-6 rounded-md px-6 py-3 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === 'saving' ? 'Saving' : 'Save my profile'}
      </button>

      {(stored || !hasWithdrawn) && (
        <section className="border-logo-red/30 mt-12 rounded-xl border p-5">
          <h2 className="text-lg font-semibold">Withdraw consent and delete my profile</h2>
          <p className="text-muted mt-1 text-sm leading-relaxed">
            Deletes your profile at once and completely, including anything your organisation
            uploaded, and records that you withdrew. You keep access to your training, which carries
            on without the personalisation. You can fill in a profile again later.
          </p>
          {status === 'confirming' || status === 'withdrawing' ? (
            <div role="alertdialog" aria-labelledby={`${id}-confirm`} className="mt-4">
              <p id={`${id}-confirm`} className="text-mist text-sm leading-relaxed">
                <span className="font-semibold">Withdraw and delete your profile?</span> The profile
                cannot be brought back.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void withdraw()}
                  disabled={status === 'withdrawing'}
                  className="bg-logo-red text-mist hover:bg-logo-red/80 rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-wait disabled:opacity-60"
                >
                  {status === 'withdrawing' ? 'Withdrawing' : 'Yes, withdraw'}
                </button>
                <button
                  type="button"
                  onClick={() => setStatus('idle')}
                  disabled={status === 'withdrawing'}
                  className="text-muted hover:text-mist ring-charcoal-line rounded-md px-4 py-2 text-sm font-semibold ring-1 transition-colors ring-inset disabled:opacity-60"
                >
                  Keep it
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setStatus('confirming')}
              disabled={busy}
              className="text-logo-red ring-logo-red/40 hover:bg-logo-red/10 mt-4 rounded-md px-4 py-2 text-sm font-semibold ring-1 transition-colors ring-inset"
            >
              Withdraw consent and delete my profile
            </button>
          )}
        </section>
      )}
    </div>
  );
}
