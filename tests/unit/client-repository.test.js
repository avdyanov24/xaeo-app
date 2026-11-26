import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { openDatabase } from '../../src/server/db/database.js';
import * as clients from '../../src/server/repositories/client-repository.js';
import * as questions from '../../src/server/repositories/question-repository.js';
import * as workspaces from '../../src/server/repositories/workspace-repository.js';

let db;
let mine;
let theirs;

beforeEach(() => {
  db = openDatabase(':memory:');
  mine = workspaces.insertWorkspace(db, 'Mine');
  theirs = workspaces.insertWorkspace(db, 'Theirs');
});

const addClient = (workspaceId, name = 'Acme Plumbing') =>
  clients.insertClient(db, { workspaceId, name, domain: 'acme.test', city: 'Leeds' });

describe('client repository', () => {
  it('stores a client and reads it back with defaults', () => {
    const id = addClient(mine);
    assert.deepEqual(clients.findClient(db, mine, id), {
      id,
      workspaceId: mine,
      name: 'Acme Plumbing',
      domain: 'acme.test',
      type: '',
      city: 'Leeds',
      country: 'GB',
      sample: false,
      archivedAt: null,
      nextRunAt: null,
      createdAt: clients.findClient(db, mine, id).createdAt,
    });
  });

  it('never returns or changes a client from another workspace', () => {
    const id = addClient(theirs);
    assert.equal(clients.findClient(db, mine, id), undefined);
    assert.deepEqual(clients.listClients(db, mine), []);
    assert.equal(clients.updateClient(db, mine, id, { name: 'Hijacked' }), false);
    assert.equal(clients.setArchivedAt(db, mine, id, '2026-11-26T10:00:00.000Z'), false);
    assert.equal(clients.findClient(db, theirs, id).name, 'Acme Plumbing');
    assert.equal(clients.findClient(db, theirs, id).archivedAt, null);
  });

  it('lists active and archived clients separately, newest first', () => {
    const first = addClient(mine, 'First');
    const second = addClient(mine, 'Second');
    const third = addClient(mine, 'Third');
    clients.setArchivedAt(db, mine, first, '2026-11-26T10:00:00.000Z');
    assert.deepEqual(
      clients.listClients(db, mine).map((c) => c.id),
      [third, second],
    );
    assert.deepEqual(
      clients.listClients(db, mine, { archived: true }).map((c) => c.id),
      [first],
    );
    assert.equal(clients.countArchivedClients(db, mine), 1);
    clients.setArchivedAt(db, mine, first, null);
    assert.equal(clients.countArchivedClients(db, mine), 0);
  });

  it('updates only the fields it is given and ignores unknown ones', () => {
    const id = addClient(mine);
    assert.equal(clients.updateClient(db, mine, id, { city: 'York', workspaceId: theirs }), true);
    const row = clients.findClient(db, mine, id);
    assert.equal(row.city, 'York');
    assert.equal(row.name, 'Acme Plumbing');
    assert.equal(row.workspaceId, mine);
  });
});

describe('question repository', () => {
  it('appends questions in order and lists them for one client', () => {
    const a = addClient(mine);
    const b = addClient(mine, 'Other');
    const q1 = questions.insertQuestion(db, { workspaceId: mine, clientId: a, text: 'First?' });
    const q2 = questions.insertQuestion(db, {
      workspaceId: mine,
      clientId: a,
      text: 'Second?',
      intent: 'urgent',
    });
    questions.insertQuestion(db, { workspaceId: mine, clientId: b, text: 'Elsewhere?' });
    const list = questions.listQuestions(db, mine, a);
    assert.deepEqual(
      list.map((q) => [q.id, q.text, q.intent, q.active, q.position]),
      [
        [q1, 'First?', 'find', true, 1],
        [q2, 'Second?', 'urgent', true, 2],
      ],
    );
  });

  it('edits a question and pauses it without deleting', () => {
    const client = addClient(mine);
    const id = questions.insertQuestion(db, { workspaceId: mine, clientId: client, text: 'Old?' });
    assert.equal(questions.updateQuestion(db, mine, id, { text: 'New?', active: false }), true);
    assert.deepEqual(
      (({ text, active }) => ({ text, active }))(questions.findQuestion(db, mine, id)),
      { text: 'New?', active: false },
    );
  });

  it('keeps a deleted question readable for old answers but hides it from lists', () => {
    const client = addClient(mine);
    const id = questions.insertQuestion(db, { workspaceId: mine, clientId: client, text: 'Gone?' });
    assert.equal(questions.deleteQuestion(db, mine, id), true);
    assert.equal(questions.deleteQuestion(db, mine, id), false);
    assert.equal(questions.findQuestion(db, mine, id), undefined);
    assert.deepEqual(questions.listQuestions(db, mine, client), []);
    assert.equal(questions.questionTexts(db, mine, client).get(id), 'Gone?');
  });

  it('never reaches a question from another workspace', () => {
    const client = addClient(theirs);
    const id = questions.insertQuestion(db, {
      workspaceId: theirs,
      clientId: client,
      text: 'Hers?',
    });
    assert.equal(questions.findQuestion(db, mine, id), undefined);
    assert.equal(questions.updateQuestion(db, mine, id, { text: 'Mine now?' }), false);
    assert.equal(questions.deleteQuestion(db, mine, id), false);
    assert.equal(questions.findQuestion(db, theirs, id).text, 'Hers?');
    assert.equal(questions.questionTexts(db, mine, client).size, 0);
  });
});
