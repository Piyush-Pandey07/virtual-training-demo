/**
 * A participant's steps for each trainer-led session they are listed for (AI-26).
 *
 * The session itself runs on the facilitator's screen; everything else happens on the
 * participant's own device, in this order: the pre-session assessment, the session, the
 * post-session assessment, then feedback. Each step opens only once the one before it
 * is done, and a step a deck does not need (no question bank) is skipped rather than
 * shown as owed. Consent and the profile come before all of it, at sign-in.
 */

import 'server-only';

import {
  attendedSession,
  feedbackDone,
  hasQuestions,
  postAssessmentDone,
  preAssessmentClosed,
  preAssessmentDone,
} from '../assessments/service';
import { assessmentHref, feedbackHref } from '../assessments/paths';
import { assessmentStore } from '../assessments/store';
import { listDecks } from '../decks/registry';
import { formatSessionTime } from '../time';
import type { SignedInPerson } from '../roster/types';
import { sessionsListing } from './access';
import type { TrainingSession } from './types';
import { joinedLate } from './words';

export type StepState = 'done' | 'open' | 'locked' | 'not needed' | 'missed';

export interface JourneyStep {
  label: string;
  state: StepState;
  /** Where to do it, only while it is open. */
  href?: string;
  /** A short line under the label: when it opens, or what happened. */
  note?: string;
}

export interface SessionJourney {
  sessionId: string;
  deckId: string;
  deckTitle: string;
  when: string | null;
  /**
   * Cancelled before it started. Shown, rather than hidden, so a participant who was told
   * about it is not left wondering where it went; it has no steps.
   */
  cancelled: boolean;
  /** Marked present after the session opened. */
  joinedLate: boolean;
  steps: JourneyStep[];
}

/** In India time, said so: this is formatted on the server, which runs on UTC. */
function formatWhen(iso: string | null): string | null {
  return iso ? formatSessionTime(iso) : null;
}

/** The steps for one session, in order, each open only after the one before. */
export async function journeyFor(
  person: SignedInPerson,
  session: TrainingSession,
  deckTitle: string,
): Promise<SessionJourney> {
  const base = {
    sessionId: session.id,
    deckId: session.deckId,
    deckTitle,
    when: formatWhen(session.scheduledFor),
    cancelled: session.status === 'cancelled',
    joinedLate: joinedLate(session, person.id),
  };
  // Nothing to do for a session that will not happen. A pre-session result already
  // given stands: it is kept once per deck, and counts for the next session of it.
  if (session.status === 'cancelled') return { ...base, steps: [] };

  const org = person.orgId;
  const banks = assessmentStore(org);
  const [storedPre, storedPost, preDone, postDone, gaveFeedback] = await Promise.all([
    banks.getBank(session.deckId, 'pre'),
    banks.getBank(session.deckId, 'post'),
    preAssessmentDone(org, person.id, session.deckId),
    postAssessmentDone(org, person.id, session.deckId),
    feedbackDone(org, person.id, session.deckId, session.id),
  ]);
  // A bank with no questions is no bank, as the assessment service treats it.
  const preBank = hasQuestions(storedPre) ? storedPre : undefined;
  const postBank = hasQuestions(storedPost) ? storedPost : undefined;

  const absent = session.attendance[person.id] === 'absent';
  const late = base.joinedLate;
  const started = session.status !== 'scheduled';
  const steps: JourneyStep[] = [];

  // 1. Before the session.
  // Open until the facilitator marks them, even once the session has started, so
  // somebody arriving late does it on their own device before joining. Once they are
  // marked it has closed for them (see preAssessmentClosed), and missing it holds
  // nothing after it back.
  const preClosed = preAssessmentClosed(session, person.id);
  const preReady = !preBank || preDone || preClosed;
  steps.push(
    !preBank
      ? { label: 'Pre-session assessment', state: 'not needed' }
      : preDone
        ? { label: 'Pre-session assessment', state: 'done' }
        : preClosed
          ? {
              label: 'Pre-session assessment',
              state: 'missed',
              note: absent
                ? 'Closed when you were marked absent.'
                : 'Closed when you were marked present.',
            }
          : {
              label: 'Pre-session assessment',
              state: 'open',
              href: assessmentHref('pre', session.deckId, session.id),
              note: started
                ? 'The session has started. Do this now, before you join.'
                : 'Do this before the session starts.',
            },
  );

  // 2. The session, in the room.
  // Done for this participant once the facilitator has marked them present in it, even
  // while it is still under way: there is nothing more for them to do to attend it, and
  // "To do" beside it sent people marked present looking for something (UAT issue 14).
  // Missed once marked absent. Still to do while it is under way and they are not marked,
  // since joining it is exactly what they should be doing.
  // As the assessments decide it (attendedSession): marked present, in a session that
  // started. This also opens steps 3 and 4.
  const attended = attendedSession(session, person.id);
  const lateNote = late ? ' You joined late.' : '';
  steps.push({
    label: 'The session',
    state: absent
      ? 'missed'
      : attended || session.status === 'closed'
        ? 'done'
        : started
          ? 'open'
          : 'locked',
    note: absent
      ? 'You were marked absent.'
      : session.status === 'closed'
        ? `Finished.${lateNote}`
        : attended
          ? `You are marked present. Under way, on the facilitator's screen.${lateNote}`
          : started
            ? "Under way, on the facilitator's screen. Join it in the room, and your facilitator will mark you present."
            : `In the room${formatWhen(session.scheduledFor) ? `, ${formatWhen(session.scheduledFor)}` : ''}.`,
  });

  // 3 and 4. After it, only for somebody who was there.
  const postReady = !postBank || postDone;
  steps.push(
    !postBank
      ? { label: 'Post-session assessment', state: 'not needed' }
      : postDone
        ? { label: 'Post-session assessment', state: 'done' }
        : attended && preReady
          ? {
              label: 'Post-session assessment',
              state: 'open',
              href: assessmentHref('post', session.deckId, session.id),
            }
          : {
              label: 'Post-session assessment',
              state: 'locked',
              note: absent
                ? 'Not open to you: you were marked absent.'
                : !started
                  ? 'Opens after the session.'
                  : !preReady
                    ? 'Opens after the pre-session assessment.'
                    : 'Opens once the facilitator marks you present.',
            },
  );
  steps.push(
    gaveFeedback
      ? { label: 'Feedback', state: 'done' }
      : attended && preReady && postReady
        ? { label: 'Feedback', state: 'open', href: feedbackHref(session.deckId, session.id) }
        : {
            label: 'Feedback',
            state: 'locked',
            note: absent
              ? 'Not open to you: you were marked absent.'
              : postBank
                ? 'Opens after the post-session assessment.'
                : 'Opens after the session.',
          },
  );

  return { ...base, steps };
}

/** Every trainer-led session this person is listed for, newest first. */
export async function journeysFor(person: SignedInPerson): Promise<SessionJourney[]> {
  const [sessions, decks] = await Promise.all([sessionsListing(person), listDecks(person.orgId)]);
  const titled = sessions
    .map((session) => ({ session, deck: decks.find((deck) => deck.id === session.deckId) }))
    .filter((entry) => entry.deck)
    .sort((a, b) =>
      (b.session.scheduledFor ?? b.session.createdAt).localeCompare(
        a.session.scheduledFor ?? a.session.createdAt,
      ),
    );
  return Promise.all(titled.map(({ session, deck }) => journeyFor(person, session, deck!.title)));
}
