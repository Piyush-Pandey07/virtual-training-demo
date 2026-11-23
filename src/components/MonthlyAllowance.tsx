import type { MonthlyAllowance as Allowance } from '@/lib/usage/limits';
import { allowanceTone } from '@/lib/usage/limit-tone';
import { formatDayLong } from '@/lib/time';

/**
 * A customer's training sessions this month, shown to the customer (UAT, issue 19).
 *
 * The cap is set by Technavious and was only visible on Technavious's own Customers page,
 * so a company learnt it had one when a session was refused. This says how many have been
 * used, how many are left, when the count starts again, and who can raise it.
 */
export function MonthlyAllowance({ allowance }: { allowance: Allowance }) {
  const tone = allowanceTone(allowance);
  const resets = formatDayLong(allowance.resetsAt);
  const used = `${allowance.used} training ${allowance.used === 1 ? 'session' : 'sessions'}`;

  return (
    <section
      aria-labelledby="allowance-heading"
      role={tone === 'reached' ? 'alert' : undefined}
      className={`rounded-md border p-4 text-sm ${
        tone === 'reached'
          ? 'border-logo-red/40 bg-logo-red/10'
          : tone === 'nearly'
            ? 'border-azure/50 bg-azure/10'
            : 'border-charcoal-line bg-charcoal-soft'
      }`}
    >
      <h2 id="allowance-heading" className="font-semibold">
        Training sessions this month
      </h2>
      <p className="text-muted mt-1 leading-relaxed">
        {allowance.limit === null ? (
          <>{used} so far. Your organisation has no monthly limit.</>
        ) : tone === 'reached' ? (
          <>
            All {allowance.limit} used. No new session can start until {resets}. Technavious sets
            this limit, so ask them if you need it raised.
          </>
        ) : (
          <>
            {allowance.used} of {allowance.limit} used, {allowance.limit - allowance.used} left.
            {tone === 'nearly' && ' Nearly all used.'} The count starts again on {resets}.
            Technavious sets this limit, so ask them if you need it raised.
          </>
        )}{' '}
        Each AI-led session counts once when it starts, and each trainer-led session once when the
        facilitator first hands over.
      </p>
    </section>
  );
}
