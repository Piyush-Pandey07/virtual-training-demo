# /gstack-review — wire-the-screens-together

Run 3 September 2026 against `origin/main` (merge-base `76a7427`), 4 commits, 29 files,
1,470 changed lines. Review stopped early at the user's request (usage limit), so the
findings below are complete for the passes that ran and the remaining passes are listed
at the bottom.

Nothing has been fixed. Every item below is still open.

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

**Test to add:** a roster whose `listAssignmentsForDeck` rejects, asserting the deck
still exists afterwards. `removal.test.ts` currently has no case for it.

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

**Fix:** add a behavioural test using `InMemoryDocumentStore` + `scopedDocuments`, the
way `removal.test.ts` already does, and call `customerOverview` directly.

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

Worth considering a stronger version: derive the list by grepping for exported functions
whose first parameter is `orgId: string`, so it cannot drift again. That is what let it
drift twice.

---

### 6. Two sort comparators never return 0

`src/lib/platform/overview.ts:100` and the `happeningNow` sort in `src/app/platform/page.tsx`

```ts
open.sort((a, b) => (a.lastSeenAt > b.lastSeenAt ? -1 : 1));
```

For equal timestamps this returns `1` for both `compare(a,b)` and `compare(b,a)`, which
is an inconsistent comparator. Ties order unpredictably.

**Fix:** `b.lastSeenAt.localeCompare(a.lastSeenAt)`.

The admins sort on `overview.ts:112` is correct and needs no change.

---

## P3 — informational

### 7. `ROLE_BLURB` is dead

`src/lib/auth/labels.ts:34`. Exported, never imported anywhere. Added speculatively.
Either wire it into the sign-in or profile screen, or delete it.

### 8. `unassign` runs serially

`src/lib/decks/removal.ts:42-44`. One awaited round trip per person. A deck assigned to
500 people is 500 sequential Firestore deletes. The codebase uses `Promise.all` for
equivalent fan-out. Correctness is fine either way, and partial failure converges on
retry.

### 9. Unbounded concurrency reading attempts

`src/lib/platform/overview.ts:57`. `Promise.all` over every deck, run once per customer
on the platform page. Fine at hand-provisioned scale, which the doc comment says, but
there is no ceiling.

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
