'use client';

/**
 * The privacy notice and the consent box, on the consent page and beside the profile
 * form on My profile.
 *
 * One component for both, so a person is shown the same words and asked the same
 * question wherever they are. The text itself lives in src/lib/profiles/notice.ts, where
 * it is marked as a draft until Technavious approves it.
 */

import {
  PROFILE_NOTICE,
  PROFILE_NOTICE_IS_DRAFT,
  PROFILE_NOTICE_TITLE,
} from '@/lib/profiles/notice';

interface ProfileConsentProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Open on the consent page, where reading it is the point; folded on My profile. */
  open?: boolean;
}

export function ProfileConsent({
  id,
  checked,
  onChange,
  disabled = false,
  open = false,
}: ProfileConsentProps) {
  return (
    <div className="mt-6">
      <details open={open} className="group">
        <summary className="text-teal hover:text-mist cursor-pointer text-sm font-semibold transition-colors">
          {PROFILE_NOTICE_TITLE}
        </summary>
        <div className="border-charcoal-line mt-2 space-y-3 rounded-md border p-4">
          {/* Visible as well as in the code, so nobody testing a deployment with the
              switch on can mistake the draft for the approved notice. */}
          {PROFILE_NOTICE_IS_DRAFT && (
            <p className="text-logo-red text-xs font-semibold tracking-wide uppercase">
              Draft notice, awaiting approval
            </p>
          )}
          {PROFILE_NOTICE.map((section) => (
            <div key={section.heading}>
              <p className="text-mist text-sm font-semibold">{section.heading}</p>
              <p className="text-muted mt-0.5 text-sm leading-relaxed">{section.text}</p>
            </div>
          ))}
        </div>
      </details>

      <label htmlFor={id} className="mt-4 flex cursor-pointer items-start gap-2.5 text-sm">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          disabled={disabled}
          className="accent-teal mt-0.5 size-4 shrink-0"
        />
        <span>
          I have read the privacy notice and agree to my data being kept and used as it says.
        </span>
      </label>
    </div>
  );
}
