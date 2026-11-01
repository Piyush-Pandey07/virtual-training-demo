'use client';

/**
 * Viewing, changing and deleting one's own profile.
 *
 * Saving asks for the consent box every time, as the lobby does, so every stored
 * profile records agreement to the notice that was on screen when it was last changed.
 * Deleting asks once more before it acts, because it cannot be undone.
 */

import { useId, useState } from 'react';

import { ProfileConsent } from '@/components/ProfileConsent';
import { deleteProfile, saveProfile } from '@/lib/profiles/client';
import {
  EXPERTISE_LABELS,
  EXPERTISE_LEVELS,
  type ExpertiseLevel,
  isExpertiseLevel,
  type LearnerDetails,
  PERSONAL_FIELDS,
} from '@/lib/profiles/types';
import { TRAINER_NAME } from '@/lib/trainer';

/** One course the profile holds a level for. A null title is a course they cannot see. */
export interface CourseLevel {
  deckId: string;
  title: string | null;
  level: ExpertiseLevel;
}

type Status = 'idle' | 'saving' | 'confirming' | 'deleting';

export function ProfileEditor({
  initial,
  courses,
  exists,
}: {
  initial: LearnerDetails;
  courses: CourseLevel[];
  exists: boolean;
}) {
  const id = useId();
  const [details, setDetails] = useState<LearnerDetails>(initial);
  const [levels, setLevels] = useState<CourseLevel[]>(courses);
  const [removed, setRemoved] = useState<string[]>([]);
  const [stored, setStored] = useState(exists);
  const [consented, setConsented] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const busy = status === 'saving' || status === 'deleting';

  const save = async () => {
    setStatus('saving');
    setError(null);
    setMessage(null);

    const expertise: Record<string, ExpertiseLevel | null> = {};
    for (const deckId of removed) expertise[deckId] = null;
    for (const course of levels) expertise[course.deckId] = course.level;

    // Every field is sent, an empty one as null, so clearing a box clears it.
    const sent: { [K in keyof LearnerDetails]?: string | null } = {};
    for (const field of PERSONAL_FIELDS) sent[field.key] = details[field.key]?.trim() || null;

    const result = await saveProfile({ details: sent, expertise }, consented);
    setStatus('idle');
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setRemoved([]);
    setConsented(false);
    setStored(result.profile !== null);
    setMessage(
      result.profile
        ? 'Saved. The trainer will use this from your next turn.'
        : 'There was nothing left in your profile, so it has been deleted.',
    );
  };

  const remove = async () => {
    setStatus('deleting');
    setError(null);
    setMessage(null);
    const result = await deleteProfile();
    if (!result.ok) {
      setStatus('confirming');
      setError(result.error);
      return;
    }
    setStatus('idle');
    setDetails({});
    setLevels([]);
    setRemoved([]);
    setConsented(false);
    setStored(false);
    setMessage('Your profile has been deleted. Nothing about you is kept for the trainer now.');
  };

  return (
    <div className="mt-8">
      <section className="border-charcoal-line bg-charcoal-soft rounded-xl border p-5">
        <h2 className="text-lg font-semibold">About you</h2>
        <p className="text-muted mt-1 text-sm">Used in every course. Leave any of them blank.</p>

        {PERSONAL_FIELDS.map((field) => (
          <div key={field.key} className="mt-5">
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
              disabled={busy}
              className="bg-charcoal text-mist placeholder:text-muted ring-charcoal-line focus:ring-teal mt-2 w-full rounded-md px-3.5 py-2.5 text-sm ring-1 ring-inset"
            />
          </div>
        ))}
      </section>

      <section className="border-charcoal-line bg-charcoal-soft mt-6 rounded-xl border p-5">
        <h2 className="text-lg font-semibold">Your experience, course by course</h2>
        {levels.length === 0 ? (
          <p className="text-muted mt-1 text-sm leading-relaxed">
            You have not said how experienced you are in any course yet. {TRAINER_NAME} asks before
            each session, and you can skip it there too.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {levels.map((course) => (
              <li
                key={course.deckId}
                className="flex flex-wrap items-center justify-between gap-3 text-sm"
              >
                <span className="min-w-0 flex-1">
                  {course.title ?? (
                    <span className="text-muted">A course you are no longer assigned</span>
                  )}
                </span>
                <span className="flex items-center gap-3">
                  <label className="sr-only" htmlFor={`${id}-level-${course.deckId}`}>
                    Experience with {course.title ?? 'this course'}
                  </label>
                  <select
                    id={`${id}-level-${course.deckId}`}
                    value={course.level}
                    disabled={busy}
                    onChange={(event) => {
                      const level = event.target.value;
                      if (!isExpertiseLevel(level)) return;
                      setLevels((current) =>
                        current.map((entry) =>
                          entry.deckId === course.deckId ? { ...entry, level } : entry,
                        ),
                      );
                    }}
                    className="bg-charcoal text-mist ring-charcoal-line focus:ring-teal rounded-md px-3 py-2 text-sm ring-1 ring-inset"
                  >
                    {EXPERTISE_LEVELS.map((option) => (
                      <option key={option} value={option}>
                        {EXPERTISE_LABELS[option]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setLevels((current) =>
                        current.filter((entry) => entry.deckId !== course.deckId),
                      );
                      setRemoved((current) => [...current, course.deckId]);
                    }}
                    className="text-muted hover:text-mist text-sm font-semibold transition-colors disabled:opacity-60"
                  >
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ProfileConsent
        id={`${id}-consent`}
        checked={consented}
        onChange={setConsented}
        disabled={busy}
        open
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

      {stored && (
        <section className="border-logo-red/30 mt-12 rounded-xl border p-5">
          <h2 className="text-lg font-semibold">Delete my profile</h2>
          <p className="text-muted mt-1 text-sm leading-relaxed">
            Removes everything on this page at once and completely. Your training records are not
            affected, and you can fill it in again later if you want to.
          </p>
          {status === 'confirming' || status === 'deleting' ? (
            <div role="alertdialog" aria-labelledby={`${id}-confirm`} className="mt-4">
              <p id={`${id}-confirm`} className="text-mist text-sm leading-relaxed">
                <span className="font-semibold">Delete your profile?</span> This cannot be undone.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void remove()}
                  disabled={status === 'deleting'}
                  className="bg-logo-red text-mist hover:bg-logo-red/80 rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-wait disabled:opacity-60"
                >
                  {status === 'deleting' ? 'Deleting' : 'Yes, delete it'}
                </button>
                <button
                  type="button"
                  onClick={() => setStatus('idle')}
                  disabled={status === 'deleting'}
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
              Delete my profile
            </button>
          )}
        </section>
      )}
    </div>
  );
}
