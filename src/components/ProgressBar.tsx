/**
 * How far through something somebody is.
 *
 * Presentational and server-safe. The number is always computed server-side by
 * `percentComplete`, because the weighting it needs — each slide's spoken budget —
 * is deliberately not sent to the browser.
 */
export function ProgressBar({
  percent,
  complete = false,
  label,
}: {
  percent: number;
  complete?: boolean;
  label?: string;
}) {
  const width = Math.min(Math.max(percent, 0), 100);

  return (
    <div className="w-full">
      <div
        role="progressbar"
        aria-valuenow={width}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'Progress'}
        className="bg-charcoal-line h-2 w-full overflow-hidden rounded-full"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${
            complete ? 'bg-teal' : 'bg-azure-bright'
          }`}
          // A hairline for anything above zero, so "started" and "not started" are
          // distinguishable at a glance rather than both reading as an empty bar.
          style={{ width: width === 0 ? '0' : `max(${width}%, 3px)` }}
        />
      </div>
    </div>
  );
}
