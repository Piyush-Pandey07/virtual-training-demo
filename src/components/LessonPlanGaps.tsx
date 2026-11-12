/**
 * Where a deck differs from its lesson plan, said plainly (AI-43).
 *
 * The same notice on the deck's page for the administrator, on the session's page before
 * it runs, and on the facilitator's screen while it does, so whoever is in front of the
 * group knows in advance what Nova will do where the two disagree. Nothing at all when
 * there are no gaps: a plan that matches the deck needs no notice.
 *
 * Presentational only, with the wording worked out on the server, so it can sit in a
 * server page and in the facilitator's client screen alike.
 */

interface Props {
  gaps: readonly string[];
  /** Who is reading, which decides the closing sentence. */
  audience: 'administrator' | 'facilitator';
  /** Smaller, for the facilitator's screen, where the slide needs the room. */
  compact?: boolean;
}

export function LessonPlanGaps({ gaps, audience, compact = false }: Props) {
  if (gaps.length === 0) return null;
  return (
    <section
      aria-labelledby="lesson-plan-gaps-heading"
      className={`border-logo-red/40 bg-logo-red/10 rounded-xl border ${compact ? 'p-4' : 'p-5'}`}
    >
      <h2
        id="lesson-plan-gaps-heading"
        className={compact ? 'text-sm font-semibold' : 'text-lg font-semibold'}
      >
        {gaps.length === 1
          ? 'This deck differs from its lesson plan in one place'
          : `This deck differs from its lesson plan in ${gaps.length} places`}
      </h2>
      <ul className={`mt-2 list-inside list-disc space-y-1 ${compact ? 'text-xs' : 'text-sm'}`}>
        {gaps.map((gap) => (
          <li key={gap}>{gap}</li>
        ))}
      </ul>
      <p className={`text-muted mt-2 leading-relaxed ${compact ? 'text-xs' : 'text-sm'}`}>
        {audience === 'facilitator'
          ? 'Where they differ, the deck is followed. Cover anything the plan expects and the deck lacks yourself, or tell the group it is not part of today.'
          : 'Where they differ, Nova follows the deck, and facilitators are shown this before and during their sessions. Change the deck or the plan to close a gap.'}
      </p>
    </section>
  );
}
