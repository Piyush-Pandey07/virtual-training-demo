# /gstack-review — wire-the-screens-together

Run 3 September 2026 against `origin/main` (merge-base `76a7427`), 4 commits, 29 files,
1,470 changed lines. Review stopped early at the user's request (usage limit), so the
findings below are complete for the passes that ran and the remaining passes are listed
at the bottom.

**Resolved 3 September 2026.** Findings 1 to 6 are fixed, verified by planting each
regression and watching the new test fail. Findings 7 to 9 are deliberately left open,
with reasons under each. Test count 692 to 704.

The record below is kept as written, with a RESOLVED note on each item, because what the
review found is more useful than a list of what is left.

---

## P1 — fix before landing

### 1. Deleting a deck still orphans assignments when the listing fails

`src/lib/decks/removal.ts:39`

```ts
const assignments = await roster.listAssignmentsForDeck(deckId).catch(() => []);
```

The `.catch(() => [])` turns a Firestore failure into an empty list. The loop then
unassigns nobody, `assets.removeAll` and `decks.remove` run anyway, and the caller is
told `unassigned: 0`. That is exactly the bug this module was written to prevent: the
deck is gone, the assignments survive, and the trainee is stranded on a row that can
never complete.

The comment directly above it claims the opposite:

```ts
// Assignments first, because this is the half that is visible to somebody. If the
// deck record survives a failure here the deck is merely still there, which is the
// state the administrator started in and can retry from.
```

The stated design is right. The code does not implement it.

**Fix:** drop the `.catch`. Let a listing failure throw before anything is deleted.
The route already maps `DeckStoreError` to a 400 and anything else to a 500, so the
administrator gets a failure and can retry, with the deck intact.

**RESOLVED.** The `.catch` is gone and the DELETE route now maps a `RosterStoreError`
or `DeckStoreError` to a 503 saying the deck has not been removed, rather than letting it
surface as a bare 500 that reads like a half-finished deletion. `removal.test.ts` has the
failing-store case; restoring the `.catch` fails it.

---

### 2. A person who has finished everything can show 94% complete

`src/lib/roster/stats.ts:92-97`

```ts
percent:
  secondsAssigned > 0
    ? Math.min(100, Math.round((secondsSpent / secondsAssigned) * 100))
    : rows.length > 0 && completed === rows.length
      ? 100
      : 0,
```

The all-complete guard only fires when `secondsAssigned === 0`. It never consults
`completedAt` on the normal path.

Completion does not require full coverage:

- `src/lib/roster/completion.ts:52` — `export const COMPLETION_THRESHOLD = 90;`
- `src/lib/roster/store-documents.ts:306` —
  `if (!next.completedAt && isComplete(coverageOf(toAttempt(next)))) next.completedAt = now;`

So an attempt is marked complete at 90% coverage. With `secondsAssigned > 0` the first
branch runs and the profile shows 90-99% beside "1 of 1 complete". The two figures
disagree on the same screen, which is the thing the commit message claims cannot happen.

Verified empirically by the Testing specialist: constructing a completed row with
`totalSeconds: 900, coveredSeconds: 500` returns `percent = 56`.

**Fix (needs a decision, see Open questions):** check completion before seconds.

```ts
percent:
  rows.length > 0 && completed === rows.length
    ? 100
    : secondsAssigned > 0
      ? Math.min(100, Math.round((secondsSpent / secondsAssigned) * 100))
      : 0,
```

**RESOLVED**, taking the recommended answer to Q1: all-complete reads 100%. Three tests
now cover it, including the one that was missing (completed with a real budget) and one
that proves the guard does not swallow the ordinary half-finished case.

---

### 3. The stats test passes with the logic inverted

`src/lib/roster/stats.test.ts:54-55` against `src/lib/roster/stats.ts:75-76`

```ts
if (row.startedAt === null) notStarted += 1;
else inProgress += 1;
```

The fixture has exactly one not-started deck and exactly one part-way deck, so both
assertions hold if the two branches are swapped. The Testing specialist swapped them
locally and all 9 tests still passed.

**Fix:** make the counts differ, for example two untouched and one begun.

**RESOLVED.** Two untouched and one begun. Swapping the counters now fails the test.

---

### 4. `customerOverview` has no executable test at all

`src/lib/platform/overview.test.ts:18`

```ts
const SOURCE = readFileSync('src/lib/platform/overview.ts', 'utf8');
```

Every assertion in the file reads source text. `customerOverview()` is never called, so
the ten-minute cutoff, the open-session sort, the completed/unfinished counts and the
orphaned-attempt guard have zero behavioural coverage.

The source-scan tests are still worth keeping (they pin the isolation and the
no-transcripts rule, and I verified both bite). They are just not a substitute.

**RESOLVED**, though not the way this suggested. `customerOverview` reaches for its own
stores, so the counting is now split out as a pure `summariseCustomer(people, decks, now)`
and `customerOverview` is the thin I/O wrapper above it. Seven behavioural tests cover the
cutoff, the sort, the counts and the orphaned-attempt guard. `now` is a parameter, because
a ten-minute window tested against the real clock passes until it is run at the wrong
moment. The source scans stay.

---

## P2 — worth fixing

### 5. The widened scoping guard still misses six org-scoped functions

`src/lib/orgs/scoping.test.ts:30`

The guard was widened this branch from 3 functions to 9, after a planted violation
(`peopleOverview('technavious')`) compiled and passed all 692 tests. The Security
specialist found the list is still short. These all take `orgId` as their first
argument and reach org-scoped data through a helper, so a hardcoded organisation in any
of them would pass undetected:

| Function | Location |
| --- | --- |
| `loadStoredDeck` | `src/lib/decks/registry.ts:160` |
| `defaultDeck` | `src/lib/decks/registry.ts:175` |
| `mayStartSession` | `src/lib/usage/limits.ts:28` |
| `record` | `src/lib/usage/store.ts:44` |
| `recordQuietly` | `src/lib/usage/store.ts:70` |
| `usageHistory` | `src/lib/usage/store.ts:81` |

**Fix:** add all six to `STORES`. Then re-verify the guard still passes on the real code,
and plant a violation in one of them to confirm it bites.

**RESOLVED**, including the stronger version. The list gained the six above plus
`loadDeck`, `slideImageParts`, the three `analyse*` passes and the three lifecycle
operations, and a new test derives the same set by shape and fails when the two disagree.
Functions that take an organisation first without reading anything (`orgPrefix`,
`emptyUsage`, the cache-eviction pair) are listed separately with a reason each, so a new
function of either shape has to be classified rather than forgotten.

That new test found a third instance of this file's own documented trap: a lone backslash-b inside
a template literal is the backspace character, not a word boundary, so the staleness
check matched nothing and reported all 23 guarded names as missing. Fixed by building
the pattern with string concatenation instead.

Writing this note up hit the same trap a fourth time: the heredoc that wrote this file
turned the escape into a real backspace byte, which is why this sentence spells it out
in words.

---

### 6. Two sort comparators never return 0

`src/lib/platform/overview.ts:100` and the `happeningNow` sort in `src/app/platform/page.tsx`

```ts
open.sort((a, b) => (a.lastSeenAt > b.lastSeenAt ? -1 : 1));
```

For equal timestamps this returns `1` for both `compare(a,b)` and `compare(b,a)`, which
is an inconsistent comparator. Ties order unpredictably.

**Fix:** `b.lastSeenAt.localeCompare(a.lastSeenAt)`.

**RESOLVED** in both places.

The admins sort on `overview.ts:112` is correct and needs no change.

---

## P3 — informational

### 7. `ROLE_BLURB` is dead — STILL OPEN

`src/lib/auth/labels.ts:34`. Exported, never imported anywhere. Added speculatively.
Either wire it into the sign-in or profile screen, or delete it.

### 8. `unassign` runs serially — RESOLVED, the acceptance was wrong

`src/lib/decks/removal.ts:42-44`. One awaited round trip per person. A deck assigned to
500 people is 500 sequential Firestore deletes. The codebase uses `Promise.all` for
equivalent fan-out. Correctness is fine either way, and partial failure converges on
retry.

**RESOLVED.** The Performance pass showed the acceptance above missed the clock. The
DELETE route runs with `maxDuration = 30`, and a mandatory deck is assigned to everybody,
so at fifty to a hundred milliseconds per round trip a few hundred people exhausts the
budget. "Partial failure converges on retry" only holds for a failure that throws. A
timeout does not: the function is killed mid-loop, leaving some people unassigned and some
not, the deck still present, and no code path reached to report it.

Now cleared in bounded batches of 25. Bounded rather than a plain `Promise.all` because a
deck given to a thousand people would otherwise open a thousand connections at once, which
trades a slow delete for a thundering herd. A test asserts peak concurrency is above one
and no higher than 25, and both wrong shapes fail it.

### 9. Unbounded concurrency reading attempts — STILL OPEN, now measured

`src/lib/platform/overview.ts:57`. `Promise.all` over every deck, run once per customer
on the platform page. Fine at hand-provisioned scale, which the doc comment says, but
there is no ceiling.

**Measured by the Performance pass.** One `/platform` load costs `1 + C x (3 + D)` round
trips: the organisation list, then per customer the usage record, the roster, the deck
list, and one attempts query per deck. Twenty customers with thirty decks each is about
660, fired as nested `Promise.all`s from one serverless invocation. Nothing bounds either
dimension: no pagination on the organisation list, the roster or the deck list, and no cap
on decks per customer.

The multiplication is by decks rather than customers, so a few customers with large
libraries reach that well before customer count does. The comment on `page.tsx` said "a
handful of reads per customer", which was wrong; it now states the real cost.

**Left open on purpose.** The fix is a rollup counter written as assignments and attempts
are recorded, making the per-customer cost O(1) reads. That is a second source of truth
maintained on every write, and a wrong counter is worse than a slow page, so it wants
building deliberately rather than as a review follow-up.

---

## Open questions for tomorrow

**Q1 — what should 100% mean on a profile?** Finding 2 has two defensible answers.
Either "everything assigned is complete" reads 100% (matches the app's own 90% definition
of done, and makes the summary agree with the rows), or the summary keeps showing real
weighted coverage and completion is communicated only by "N of N complete". The first
is recommended: two figures disagreeing on one screen is worse than either number alone.

**Q2 — do the source-scan tests stay?** `overview.test.ts` and `navigation.test.ts` are
both source-scanning. They caught real regressions when planted against, so the
recommendation is keep them and add behavioural tests alongside, not replace.

---

## Passes that did not run

Stopped at the usage limit. Still outstanding from the `/gstack-review` workflow:

- Maintainability specialist
- Performance specialist
- Simplification specialist (advisory: unrequested structure)
- Design specialist (partly covered by hand earlier: the mobile header overlap was found
  and fixed, and the platform dashboard was checked at 1150px and 375px)
- Step 5.7 adversarial pass (Claude subagent + Codex cross-check)
- Step 5.6 documentation staleness check
- Fix-First application (Steps 5a-5d). Nothing was auto-fixed.

To resume: `/gstack-review` on this branch again, or work this file top to bottom.

---

## Scope check

**Intent** (from commit messages, no `TODOS.md` in repo): fix the deck-delete cascade,
wire every screen's navigation together with consistent role naming, add the
cross-customer platform dashboard, and widen the isolation guard.

**Delivered:** all four, plus per-employee training stats which no commit message
promised as a separate goal (it arrived inside the wiring commit).

**Verdict: CLEAN.** No out-of-scope files. The employee-stats work is adjacent to the
role-vocabulary change it shipped with rather than drift.
