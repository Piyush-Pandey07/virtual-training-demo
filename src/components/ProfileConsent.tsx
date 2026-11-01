'use client';

/**
 * The privacy notice and the consent box, beside every form that saves a profile.
 *
 * One component for both places a profile can be saved, the session lobby and the
 * profile page, so a person is shown the same words and asked the same question
 * wherever they are. The text itself lives in src/lib/profiles/notice.ts, where it is
 * marked as a draft until Technavious approves it.
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
  /** Open on the profile page, where reading it is the point; folded in the lobby. */
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
    <div className="mt-5">
      <details open={open} className="group">
        <summary className="text-teal hover:text-mist cursor-pointer text-sm font-semibold transition-colors">
          {PROFILE_NOTICE_TITLE}
        </summary>
        <div className="border-charcoal-line mt-2 space-y-2 rounded-md border p-3">
          {/* Visible as well as in the code, so nobody testing a deployment with the
              switch on can mistake the draft for the approved notice. */}
          {PROFILE_NOTICE_IS_DRAFT && (
            <p className="text-logo-red text-xs font-semibold tracking-wide uppercase">
              Draft notice, awaiting approval
            </p>
          )}
          {PROFILE_NOTICE.map((paragraph) => (
            <p key={paragraph} className="text-muted text-xs leading-relaxed">
              {paragraph}
            </p>
          ))}
        </div>
      </details>

      <label htmlFor={id} className="mt-3 flex cursor-pointer items-start gap-2.5 text-sm">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          disabled={disabled}
          className="accent-teal mt-0.5 size-4 shrink-0"
        />
        <span>
          I have read how my profile is used and agree to it being kept and used that way.
        </span>
      </label>
    </div>
  );
}
