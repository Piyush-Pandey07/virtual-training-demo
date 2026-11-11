'use client';

/**
 * The profile's fields, as inputs, for the consent page and My profile.
 *
 * Walks `PROFILE_FIELDS`, so both forms ask for the same things with the same limits and
 * the same required marks as the server checks. Required fields come first and say so;
 * the optional ones say they can be skipped.
 */

import type { ProfileFormValues } from '@/lib/profiles/client';
import {
  MAX_YEARS_EXPERIENCE,
  PROFICIENCY_LABELS,
  PROFICIENCY_LEVELS,
  PROFILE_FIELDS,
  type ProfileFieldSpec,
} from '@/lib/profiles/types';

const INPUT =
  'bg-charcoal text-mist placeholder:text-muted ring-charcoal-line focus:ring-teal mt-2 w-full rounded-md px-3.5 py-2.5 text-sm ring-1 ring-inset';

interface ProfileFieldsProps {
  idPrefix: string;
  values: ProfileFormValues;
  onChange: (values: ProfileFormValues) => void;
  disabled?: boolean;
}

export function ProfileFields({
  idPrefix,
  values,
  onChange,
  disabled = false,
}: ProfileFieldsProps) {
  const set = (field: ProfileFieldSpec, value: string) =>
    onChange({ ...values, [field.key]: value });

  const section = (required: boolean) => (
    <section className="border-charcoal-line bg-charcoal-soft mt-6 rounded-xl border p-5">
      <h2 className="text-lg font-semibold">{required ? 'About you' : 'If you would like to'}</h2>
      <p className="text-muted mt-1 text-sm">
        {required ? 'All of these are required.' : 'Optional. Leave any of them blank.'}
      </p>

      {PROFILE_FIELDS.filter((field) => field.required === required).map((field) => {
        const id = `${idPrefix}-${field.key}`;
        const value = values[field.key] ?? '';
        return (
          <div key={field.key} className="mt-5">
            <label htmlFor={id} className="block text-sm font-semibold">
              {field.label}
              {field.required && (
                <span className="text-muted ml-2 font-normal" aria-hidden="true">
                  required
                </span>
              )}
            </label>
            <p className="text-muted mt-0.5 text-xs">{field.hint}</p>
            {field.kind === 'proficiency' ? (
              <select
                id={id}
                value={value}
                required
                disabled={disabled}
                onChange={(event) => set(field, event.target.value)}
                className={INPUT}
              >
                <option value="">Choose one</option>
                {PROFICIENCY_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {PROFICIENCY_LABELS[level]}
                  </option>
                ))}
              </select>
            ) : field.kind === 'years' ? (
              <input
                id={id}
                type="number"
                inputMode="decimal"
                min={0}
                max={MAX_YEARS_EXPERIENCE}
                step={0.5}
                value={value}
                required={field.required}
                placeholder={field.placeholder}
                disabled={disabled}
                onChange={(event) => set(field, event.target.value)}
                className={INPUT}
              />
            ) : (
              <input
                id={id}
                type="text"
                value={value}
                maxLength={field.max}
                required={field.required}
                placeholder={field.placeholder}
                disabled={disabled}
                onChange={(event) => set(field, event.target.value)}
                className={INPUT}
              />
            )}
          </div>
        );
      })}
    </section>
  );

  return (
    <>
      {section(true)}
      {section(false)}
    </>
  );
}
