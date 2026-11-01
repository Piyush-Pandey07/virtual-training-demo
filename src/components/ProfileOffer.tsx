'use client';

/**
 * The optional profile form on the session lobby.
 *
 * Asks how much the trainee already knows about this course, and, the first time only,
 * the few details about them that every course can use. Everything about it is
 * optional: it can be skipped, ignored or half filled, and the Start button beside it
 * works the same whatever is done here. A form that stood between somebody and their
 * mandatory training would be the opposite of what it is for.
 *
 * Only rendered when PROFILES_ENABLED is on. The session page decides that on the
 * server and passes no offer at all when it is off, so with the switch off this
 * component is never mounted and never calls the profile route.
 */

import { useId, useState } from 'react';

import { ProfileConsent } from './ProfileConsent';
import { saveProfile } from '@/lib/profiles/client';
import {
  EXPERTISE_LABELS,
  EXPERTISE_LEVELS,
  type ExpertiseLevel,
  type LearnerDetails,
  PERSONAL_FIELDS,
  type ProfileOfferState,
} from '@/lib/profiles/types';
import { TRAINER_NAME } from '@/lib/trainer';

type Status = 'open' | 'saving' | 'saved' | 'skipped';

export function ProfileOffer({
  offer,
  disabled = false,
}: {
  offer: ProfileOfferState;
  disabled?: boolean;
}) {
  const id = useId();
  const [status, setStatus] = useState<Status>('open');
  const [level, setLevel] = useState<ExpertiseLevel | null>(null);
  const [details, setDetails] = useState<LearnerDetails>({});
  const [consented, setConsented] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'skipped') return null;

  if (status === 'saved') {
    return (
      <p className="text-muted mt-8 text-sm" role="status">
        Thank you. {TRAINER_NAME} will use that from the start of this session. You can change or
        delete it at any time from My profile.
      </p>
    );
  }

  const entered =
    level !== null || PERSONAL_FIELDS.some((field) => Boolean(details[field.key]?.trim()));
  const saving = status === 'saving';

  const save = async () => {
    setStatus('saving');
    setError(null);
    const result = await saveProfile(
      {
        details: offer.askPersonal ? details : undefined,
        expertise: level ? { [offer.deckId]: level } : undefined,
      },
      consented,
    );
    if (result.ok) {
      setStatus('saved');
    } else {
      setError(result.error);
      setStatus('open');
    }
  };

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="border-charcoal-line bg-charcoal-soft mt-8 rounded-xl border p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id={`${id}-title`} className="text-sm font-semibold">
          Help {TRAINER_NAME} teach you
          <span className="text-muted ml-2 font-normal">optional</span>
        </h2>
        <button
          type="button"
          onClick={() => setStatus('skipped')}
          className="text-muted hover:text-mist shrink-0 text-sm font-semibold transition-colors"
        >
          Skip
        </button>
      </div>
      <p className="text-muted mt-1 text-sm leading-relaxed">
        A few details let the trainer pitch this course to you. Leave it and the session is just the
        same.
      </p>

      {offer.askExpertise && (
        <fieldset className="mt-4 min-w-0" disabled={disabled || saving}>
          <legend className="text-sm font-semibold">Your experience with this course</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {EXPERTISE_LEVELS.map((option) => {
              const selected = option === level;
              return (
                <label
                  key={option}
                  className={`flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm ring-1 transition-colors ring-inset ${
                    selected ? 'bg-charcoal ring-teal' : 'ring-charcoal-line'
                  }`}
                >
                  <input
                    type="radio"
                    name={`${id}-expertise`}
                    value={option}
                    checked={selected}
                    onChange={() => setLevel(option)}
                    className="accent-teal size-4 shrink-0"
                  />
                  {EXPERTISE_LABELS[option]}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      {offer.askPersonal &&
        PERSONAL_FIELDS.map((field) => (
          <div key={field.key} className="mt-4">
            <label htmlFor={`${id}-${field.key}`} className="block text-sm font-semibold">
              {field.label}
            </label>
            <p className="text-muted mt-0.5 text-xs">{field.hint}</p>
            <input
              id={`${id}-${field.key}`}
              type="text"
              value={details[field.key] ?? ''}
              maxLength={field.max}
              onChange={(event) =>
                setDetails((current) => ({ ...current, [field.key]: event.target.value }))
              }
              placeholder={field.placeholder}
              disabled={disabled || saving}
              className="bg-charcoal text-mist placeholder:text-muted ring-charcoal-line focus:ring-teal mt-2 w-full rounded-md px-3.5 py-2.5 text-sm ring-1 ring-inset"
            />
          </div>
        ))}

      <ProfileConsent
        id={`${id}-consent`}
        checked={consented}
        onChange={setConsented}
        disabled={disabled || saving}
      />

      {error && (
        <p role="alert" className="text-logo-red mt-3 text-sm">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void save()}
        disabled={disabled || saving || !entered || !consented}
        className="ring-charcoal-line text-mist hover:ring-teal mt-4 rounded-md px-4 py-2 text-sm font-semibold ring-1 transition-colors ring-inset disabled:cursor-not-allowed disabled:opacity-60"
      >
        {saving ? 'Saving' : 'Save'}
      </button>
    </section>
  );
}
