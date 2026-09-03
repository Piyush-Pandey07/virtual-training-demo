import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { InMemoryDocumentStore } from '../roster/documents';
import { DocumentRosterStore } from '../roster/store-documents';
import { scopedDocuments } from './scope';

/**
 * Ending a customer relationship.
 *
 * `lifecycle.ts` is `server-only` and reaches Firebase and blob storage, so what is
 * exercised here is the part that decides *what* gets deleted rather than the calls
 * that delete it. That is where the mistakes live: a collection left off a list
 * survives the customer it belonged to and sits in storage as data nobody can reach
 * and nobody remembers agreeing to keep.
 */

const SOURCE = readFileSync('src/lib/orgs/lifecycle.ts', 'utf8');

describe('what a purge is told to delete', () => {
  it('names every collection a customer owns', () => {
    // Cross-checked against the stores themselves rather than against a memory of
    // them. If somebody adds a fifth collection under the customer prefix, the store
    // that writes it and this list have to agree, and this is what notices when they
    // stop agreeing.
    const written = new Set<string>();
    for (const [path, pattern] of [
      ['src/lib/roster/store-documents.ts', /^const (?:PEOPLE|ASSIGNMENTS|ATTEMPTS) = '([^']+)'/gm],
      ['src/lib/usage/store.ts', /^const USAGE = '([^']+)'/gm],
    ] as const) {
      const source = readFileSync(path, 'utf8');
      for (const match of source.matchAll(pattern)) written.add(match[1]!);
    }

    assert.ok(written.size >= 4, `only found ${written.size} customer collections`);

    for (const collection of written) {
      assert.match(
        SOURCE,
        new RegExp(`'${collection}'`),
        `purge does not delete the "${collection}" collection, which a customer owns`,
      );
    }
  });

  it('removes the customer record last', () => {
    // Ordered so a failure part-way leaves the customer visible and re-runnable rather
    // than gone with its data still in storage. An operator can see it did not finish.
    const domains = SOURCE.indexOf('releaseDomain');
    const record = SOURCE.indexOf("remove('organisations'");

    assert.ok(domains > 0 && record > 0, 'purge no longer looks the way this expects');
    assert.ok(record > domains, 'the customer record is removed before its contents');
  });

  it('releases the domains before anything else', () => {
    // From that moment nobody new can be placed here by signing in, so the deletion is
    // not racing a new joiner it will not see.
    const domains = SOURCE.indexOf('releaseDomain');
    const decks = SOURCE.indexOf('assets.removeAll');

    assert.ok(domains > 0 && decks > 0);
    assert.ok(domains < decks, 'decks are deleted before the customer stops admitting people');
  });

  it('ends every session it can find', () => {
    // A live cookie carries the organisation as a claim. Without revoking, somebody
    // could keep reading a customer that no longer exists until the cookie expired.
    assert.match(SOURCE, /revokeSessions/);
  });
});

describe('moving somebody between customers', () => {
  it('writes into the destination before removing from the source', () => {
    // A failure between the two leaves somebody in two customers rather than in none.
    // Being in two is visible and fixable; being in none is a person who cannot sign
    // in and whose row nobody can find to repair.
    const write = SOURCE.indexOf('rosterStore(toOrgId).upsertPerson');
    const remove = SOURCE.indexOf('from.removePerson');

    assert.ok(write > 0 && remove > 0, 'movePerson no longer looks the way this expects');
    assert.ok(write < remove, 'somebody is removed from their customer before being added to one');
  });

  it('revokes their session, because the organisation rides in the cookie', () => {
    const move = SOURCE.indexOf('export async function movePerson');
    const purge = SOURCE.indexOf('export async function purge');
    const body = SOURCE.slice(move, purge);

    assert.match(body, /revokeSessions/, 'a moved person keeps their old customer until expiry');
  });

  it('refuses to move anybody who has training records', () => {
    // The check this replaced only looked at the destination, and passed while the
    // source was silently losing the record: removePerson cascades, so a move
    // described as leaving records behind was destroying them. Nothing failed and
    // nothing was reported.
    //
    // So the refusal is checked here, and it is checked as coming *before* anything is
    // written -- a refusal after the destination row exists would leave the person in
    // two customers.
    const move = SOURCE.indexOf('export async function movePerson');
    const purge = SOURCE.indexOf('export async function purge');
    const body = SOURCE.slice(move, purge);

    const check = body.indexOf('listAttemptsForPerson');
    const write = body.indexOf('upsertPerson');

    assert.ok(check > 0, 'movePerson no longer checks for training records');
    assert.ok(write > 0, 'movePerson no longer writes into the destination');
    assert.ok(check < write, 'the record check runs after the person has been written');
    assert.match(body, /throw new OrgStoreError/, 'movePerson does not refuse, it just proceeds');
  });

  it('does not carry records into the destination either', () => {
    // Refusing is one half. The other is that a permitted move -- somebody with no
    // records -- must not invent any in the new customer.
    const move = SOURCE.indexOf('export async function movePerson');
    const purge = SOURCE.indexOf('export async function purge');
    const body = SOURCE.slice(move, purge);

    assert.doesNotMatch(body, /recordCovered|\.assign\(/);
  });
});

describe('suspending a customer', () => {
  it('changes the status and nothing else', () => {
    const start = SOURCE.indexOf('export async function suspend');
    const end = SOURCE.indexOf('export async function movePerson');
    const body = SOURCE.slice(start, end);

    assert.match(body, /setStatus/);
    // Training somebody completed is evidence about a person. A lapsed invoice is not
    // a reason to destroy it, so nothing here may reach a delete.
    assert.doesNotMatch(body, /remove|purge|delete/i);
  });
});

describe('the roster after somebody is removed', () => {
  it('takes their assignments and attempts with them', async () => {
    // What removePerson already promises, checked because purge relies on it and a
    // regression there would leave rows pointing at a person who no longer exists.
    const shared = new InMemoryDocumentStore();
    const roster = new DocumentRosterStore(scopedDocuments(shared, 'acme'));

    const person = await roster.upsertPerson({ email: 'a@acme.com', orgId: 'acme' });
    await roster.assign({ personId: person.id, deckId: 'isms', assignedBy: person.id });
    await roster.recordCovered({
      personId: person.id,
      deckId: 'isms',
      slideId: 1,
      targetSeconds: 60,
      slideCount: 5,
      totalSeconds: 300,
    });

    await roster.removePerson(person.id);

    assert.deepEqual(await roster.listPeople(), []);
    assert.deepEqual(await roster.listAssignmentsForDeck('isms'), []);
    assert.equal(await roster.getAttempt(person.id, 'isms'), undefined);
  });
});
