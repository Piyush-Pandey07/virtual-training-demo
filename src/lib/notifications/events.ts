/**
 * The events that email Technavious's training team (AI-35): "when a session is set up
 * and when a participant's profile is incomplete."
 *
 * A session set up is one email, written when `createSession` saves it, with the deck,
 * the facilitator, the time in India, how many are listed and a link to its record.
 *
 * An incomplete profile has no single moment, so two triggers cover it. A bulk upload
 * that creates or prefills participants with required fields missing sends one digest
 * for the upload, listing them. And the daily run sends one digest per customer listing
 * the participants of sessions in the next seven days whose profiles are still
 * incomplete, which is when an incomplete profile starts to matter: the trainer is about
 * to teach them without knowing them. Somebody added by hand rather than uploaded is
 * caught by the second.
 *
 * Neither email carries what a profile says. Names, addresses and which required fields
 * are missing, nothing more: an inbox is not where profiles are kept, and the training
 * team needs only to know whom to chase.
 *
 * Nothing here may fail the thing that caused it. Setting up a session or uploading
 * participants succeeds whether or not the notification could be written, and a failure
 * to write one is printed for the deployment's logs.
 */

import 'server-only';

import { createHash } from 'node:crypto';

import { appUrl, profilesEnabledInOrg } from '../config';
import { orgsConfigured, orgStore } from '../orgs/registry';
import { HOME_ORG_ID } from '../orgs/types';
import { profileDocuments, PROFILES } from '../profiles/store';
import {
  detailsOf,
  missingRequired,
  PROFILE_FIELDS,
  type LearnerProfileRecord,
  type ProfileField,
} from '../profiles/types';
import type { UploadResult } from '../profiles/upload';
import { rosterStore } from '../roster/registry';
import type { RosterStore } from '../roster/store';
import type { Person, SignedInPerson } from '../roster/types';
import { formatMoment, formatSessionTime, dayInTrainingZone } from '../time';
import { trainingStore } from '../training/store';
import type { TrainingSession } from '../training/types';
import { oneLine, renderHtml, renderText, type EmailContent } from './compose';
import { enqueue, sendSoon, type Enqueued, type OutboxOptions } from './outbox';

/** How far ahead the daily digest looks for sessions. */
export const UPCOMING_DAYS = 7;

/** How a missing field is named in an email: shorter than the form's own labels. */
const FIELD_NAMES: Record<ProfileField, string> = {
  name: 'Name',
  education: 'Education',
  yearsExperience: 'Years of experience',
  department: 'Department',
  proficiency: 'Proficiency',
  city: 'City',
  studiedAt: 'Studied at',
  interests: 'Interests',
  hobbies: 'Hobbies',
  experienceByArea: 'Experience by area',
};

export interface EventOptions extends OutboxOptions {
  /** The customer's roster. For the tests, which build one on the in-memory store. */
  roster?: (orgId: string) => RosterStore;
}

function link(path: string, label: string): EmailContent['link'] | undefined {
  const base = appUrl();
  return base ? { label, url: `${base}${path}` } : undefined;
}

async function customerName(orgId: string): Promise<string> {
  if (!orgsConfigured()) return orgId;
  const organisation = await orgStore()
    .get(orgId)
    .catch(() => undefined);
  return organisation?.name ? oneLine(organisation.name) : orgId;
}

function who(person: { name?: string; email: string }): string {
  const name = oneLine(person.name ?? '');
  const email = oneLine(person.email);
  return name && name !== email ? `${name} <${email}>` : email;
}

async function write(
  content: EmailContent,
  input: { kind: Enqueued['record']['kind']; dedupeKey: string; orgId: string },
  options: OutboxOptions,
): Promise<Enqueued> {
  return enqueue(
    {
      ...input,
      subject: oneLine(content.subject),
      text: renderText(content),
      html: renderHtml(content),
    },
    options,
  );
}

/** Never throws: a notification that cannot be written must not undo its event. */
async function quietly(what: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.error(`[notifications] could not write ${what}: ${(error as Error)?.message ?? error}`);
  }
}

// ---------------------------------------------------------------- session set up

/** The email for a session just set up. Exported for the tests. */
export function sessionSetUpContent(input: {
  customer: string;
  orgId: string;
  deckTitle: string;
  facilitator: string;
  setUpBy: string;
  session: TrainingSession;
}): EmailContent {
  const { session } = input;
  const when = session.scheduledFor ? formatMoment(session.scheduledFor) : 'No time set yet';
  const count = session.participantIds.length;
  const recordLink = link(`/sessions/${session.id}`, 'Open the session record');
  return {
    subject: `Session set up: ${input.deckTitle}, ${session.scheduledFor ? formatSessionTime(session.scheduledFor) : 'no time set'}`,
    intro: `A trainer-led session has been set up on Nova for ${input.customer}.`,
    facts: [
      [
        'Customer',
        input.customer === input.orgId ? input.orgId : `${input.customer} (${input.orgId})`,
      ],
      ['Deck', input.deckTitle],
      ['Facilitator', input.facilitator],
      ['When', when],
      ['Participants', `${count} ${count === 1 ? 'participant' : 'participants'}`],
      ['Set up by', input.setUpBy],
      ...(recordLink ? [] : [['Session record', `/sessions/${session.id}`] as [string, string]]),
    ],
    link: recordLink,
    note: `The record opens for an administrator looking at ${input.customer}. Technavious staff looking at another customer choose ${input.customer} on the Customers page first.`,
  };
}

/**
 * Writes the email for a session just set up, and sends it after the response.
 *
 * Keyed on the session's id, so however often this runs for one session it emails once.
 */
export async function notifySessionSetUp(
  person: SignedInPerson,
  session: TrainingSession,
  deckTitle: string,
  options: EventOptions = {},
): Promise<void> {
  await quietly('the session notification', async () => {
    const roster = (options.roster ?? rosterStore)(person.orgId);
    const facilitator = await roster.getPerson(session.facilitatorId).catch(() => undefined);
    const customer = await customerName(person.orgId);
    const content = sessionSetUpContent({
      customer,
      orgId: person.orgId,
      deckTitle: oneLine(deckTitle),
      facilitator: facilitator ? who(facilitator) : session.facilitatorId,
      setUpBy: who(person),
      session,
    });
    const { record, created } = await write(
      content,
      {
        kind: 'session-set-up',
        dedupeKey: `session-set-up:${person.orgId}:${session.id}`,
        orgId: person.orgId,
      },
      options,
    );
    if (created) sendSoon(record, options);
  });
}

// ------------------------------------------------------------ incomplete profiles

/** One participant in a digest: who, and which required fields they have still to give. */
export interface IncompleteParticipant {
  name: string;
  email: string;
  missing: string[];
  /** For the daily digest, the first upcoming session they are listed in. */
  session?: string;
}

function itemFor(participant: IncompleteParticipant): string {
  const missing = `missing ${participant.missing.join(', ')}`;
  const session = participant.session ? ` (session ${participant.session})` : '';
  return `${who(participant)}: ${missing}${session}`;
}

/** A short hash of who is missing what, so the same list on the same day is one event. */
function fingerprint(participants: readonly IncompleteParticipant[]): string {
  const canonical = participants
    .map((entry) => `${entry.email.toLowerCase()}=${[...entry.missing].sort().join('|')}`)
    .sort()
    .join(';');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

/** The email for an upload that left participants incomplete. Exported for the tests. */
export function uploadDigestContent(input: {
  customer: string;
  uploader: string;
  at: string;
  participants: IncompleteParticipant[];
}): EmailContent {
  const count = input.participants.length;
  return {
    subject: `Incomplete profiles: ${count} ${count === 1 ? 'participant' : 'participants'} uploaded for ${input.customer}`,
    intro: `${input.uploader} uploaded participants for ${input.customer} at ${formatMoment(input.at)}, and ${count === 1 ? 'one profile is' : `${count} profiles are`} missing required fields.`,
    list: { heading: 'Missing required fields:', items: input.participants.map(itemFor) },
    link: link('/people', 'Open the people list'),
    note: 'Each participant is asked for what is missing when they next sign in. The profiles themselves are not included in this email.',
  };
}

/** Labels, as the upload reports them, back to the names an email uses. */
function namesForLabels(labels: readonly string[]): string[] {
  return labels.map((label) => {
    const field = PROFILE_FIELDS.find((entry) => entry.label === label);
    return field ? FIELD_NAMES[field.key] : label;
  });
}

/**
 * One digest for an upload that created or prefilled participants with required fields
 * missing. Nothing when every profile it wrote is complete.
 *
 * Keyed on the customer, the day and who is missing what, so uploading the same file
 * twice in a day is one email, and a different file is another.
 */
export async function notifyIncompleteUpload(
  uploader: SignedInPerson,
  results: readonly UploadResult[],
  options: EventOptions = {},
): Promise<void> {
  const incomplete = results.filter(
    (result) =>
      (result.status === 'created' || result.status === 'updated') &&
      (result.missing?.length ?? 0) > 0,
  );
  if (incomplete.length === 0) return;

  await quietly('the upload digest', async () => {
    const people = await (options.roster ?? rosterStore)(uploader.orgId)
      .listPeople()
      .catch((): Person[] => []);
    const names = new Map(people.map((person) => [person.emailKey, person.name]));
    const participants = incomplete.map((result) => ({
      name: names.get(result.email.trim().toLowerCase()) ?? '',
      email: result.email,
      missing: namesForLabels(result.missing ?? []),
    }));

    const at = new Date((options.now ?? Date.now)()).toISOString();
    const content = uploadDigestContent({
      customer: await customerName(uploader.orgId),
      uploader: who(uploader),
      at,
      participants,
    });
    const { record, created } = await write(
      content,
      {
        kind: 'profiles-incomplete',
        dedupeKey: `profiles-incomplete:upload:${uploader.orgId}:${dayInTrainingZone(at)}:${fingerprint(participants)}`,
        orgId: uploader.orgId,
      },
      options,
    );
    if (created) sendSoon(record, options);
  });
}

/** The daily digest's email. Exported for the tests. */
export function upcomingDigestContent(input: {
  customer: string;
  participants: IncompleteParticipant[];
}): EmailContent {
  const count = input.participants.length;
  return {
    subject: `Incomplete profiles: ${count} ${count === 1 ? 'participant' : 'participants'} in upcoming sessions for ${input.customer}`,
    intro: `${count === 1 ? 'One participant' : `${count} participants`} listed in ${input.customer}'s sessions over the next ${UPCOMING_DAYS} days ${count === 1 ? 'has' : 'have'} not completed the required fields of their profile, so the trainer will not know them.`,
    list: { heading: 'Missing required fields:', items: input.participants.map(itemFor) },
    link: link('/sessions', 'Open the sessions board'),
    note: 'Each is asked for what is missing when they next sign in. The profiles themselves are not included in this email.',
  };
}

/** Who in one customer's upcoming sessions has an incomplete profile, soonest first. */
export async function incompleteInUpcomingSessions(
  orgId: string,
  options: EventOptions & { now?: () => number } = {},
): Promise<IncompleteParticipant[]> {
  const now = (options.now ?? Date.now)();
  const until = now + UPCOMING_DAYS * 86_400_000;
  const sessions = (await trainingStore(orgId, options.store).listSessions())
    .filter((session) => session.status === 'scheduled' && session.scheduledFor)
    .filter((session) => {
      const at = Date.parse(session.scheduledFor!);
      return at >= now && at <= until;
    })
    .sort((a, b) => a.scheduledFor!.localeCompare(b.scheduledFor!));
  if (sessions.length === 0) return [];

  // The first session each participant is listed in, which the sort makes the soonest.
  const firstSession = new Map<string, string>();
  for (const session of sessions) {
    for (const id of session.participantIds) {
      if (!firstSession.has(id)) firstSession.set(id, session.scheduledFor!);
    }
  }

  const [people, profiles] = await Promise.all([
    (options.roster ?? rosterStore)(orgId).listPeople(),
    profileDocuments({ orgId }, { store: options.store }).all<LearnerProfileRecord>(PROFILES),
  ]);
  const byPerson = new Map(profiles.map((profile) => [profile.personId, profile]));
  const byEmail = new Map(
    profiles.filter((profile) => profile.emailKey).map((profile) => [profile.emailKey!, profile]),
  );

  const found: IncompleteParticipant[] = [];
  for (const [id, at] of firstSession) {
    const person = people.find((entry) => entry.id === id);
    // Somebody removed since, or not a participant: not the training team's to chase.
    if (!person || person.role !== 'trainee') continue;
    const profile = byPerson.get(person.id) ?? byEmail.get(person.emailKey);
    const missing = missingRequired(profile ? detailsOf(profile) : null);
    if (missing.length === 0) continue;
    found.push({
      name: person.name,
      email: person.email,
      missing: missing.map((field) => FIELD_NAMES[field.key]),
      session: formatSessionTime(at),
    });
  }
  return found;
}

/** Every customer, and Technavious's own whether or not it was provisioned as one. */
async function customers(): Promise<string[]> {
  const listed = orgsConfigured() ? (await orgStore().list()).map((org) => org.id) : [];
  return [...new Set([...listed, HOME_ORG_ID])].sort();
}

/**
 * The daily digests: one per customer with participants in the next week's sessions
 * whose profiles are incomplete, at most once a day each. Customers whose profiles are
 * switched off by PROFILES_ENABLED are skipped, since nobody there has been asked.
 *
 * Returns how many digests were written. They are sent by the run that called this.
 */
export async function writeUpcomingDigests(
  options: EventOptions & { orgIds?: string[] } = {},
): Promise<number> {
  const now = (options.now ?? Date.now)();
  const day = dayInTrainingZone(new Date(now).toISOString());
  let written = 0;
  for (const orgId of options.orgIds ?? (await customers())) {
    if (!profilesEnabledInOrg(orgId)) continue;
    await quietly(`the daily digest for ${orgId}`, async () => {
      const participants = await incompleteInUpcomingSessions(orgId, options);
      if (participants.length === 0) return;
      const content = upcomingDigestContent({
        customer: await customerName(orgId),
        participants,
      });
      const { created } = await write(
        content,
        {
          kind: 'profiles-incomplete',
          dedupeKey: `profiles-incomplete:daily:${orgId}:${day}`,
          orgId,
        },
        options,
      );
      if (created) written += 1;
    });
  }
  return written;
}
