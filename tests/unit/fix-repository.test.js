import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { openDatabase } from '../../src/server/db/database.js';
import * as answers from '../../src/server/repositories/answer-repository.js';
import * as clients from '../../src/server/repositories/client-repository.js';
import * as fixes from '../../src/server/repositories/fix-repository.js';
import * as questions from '../../src/server/repositories/question-repository.js';
import * as scans from '../../src/server/repositories/scan-repository.js';
import * as workspaces from '../../src/server/repositories/workspace-repository.js';
import { createScan } from '../../src/server/services/scans/scan-state.js';

let db;
let ws;
let other;
let clientId;
let answerId;

const FIX = {
  title: 'Add structured data',
  type: 'jsonld',
  impact: 'High',
  evidence: 'Strong',
  url: 'https://acme.test/',
  engines: ['chatgpt', 'claude'],
  why: 'Why it matters',
  code: '{}',
  lang: 'jsonld',
  verify: 'Check the page source',
};

beforeEach(() => {
  db = openDatabase(':memory:');
  ws = workspaces.insertWorkspace(db, 'Mine');
  other = workspaces.insertWorkspace(db, 'Theirs');
  clientId = clients.insertClient(db, { workspaceId: ws, name: 'Acme', domain: 'acme.test' });
  const questionId = questions.insertQuestion(db, {
    workspaceId: ws,
    clientId,
    text: 'Who is best?',
  });
  const scanId = scans.insertScan(db, {
    workspaceId: ws,
    clientId,
    scan: createScan({ total: 1, now: 0 }),
  });
  answerId = answers.insertAnswer(db, {
    workspaceId: ws,
    scanId,
    questionId,
    questionText: 'Who is best?',
    engine: 'chatgpt',
    status: 'ok',
  });
});

const add = (fields = {}) => fixes.insertFix(db, { workspaceId: ws, clientId, ...FIX, ...fields });

describe('fix repository', () => {
  it('ranks fixes in the order they were added and reads engines back as an array', () => {
    const first = add({ title: 'First' });
    const second = add({ title: 'Second' });
    const list = fixes.listFixes(db, ws, clientId);
    assert.deepEqual(
      list.map((fix) => [fix.id, fix.position, fix.title]),
      [
        [first, 1, 'First'],
        [second, 2, 'Second'],
      ],
    );
    assert.deepEqual(list[0].engines, ['chatgpt', 'claude']);
    assert.equal(list[0].status, 'todo');
    assert.equal(list[0].doneAt, null);
  });

  it('never finds, lists or changes a fix from another workspace', () => {
    const id = add();
    assert.equal(fixes.findFix(db, other, id), undefined);
    assert.deepEqual(fixes.listFixes(db, other, clientId), []);
    assert.equal(fixes.setStatus(db, other, id, { status: 'done', doneAt: 'x' }), false);
    assert.equal(fixes.findFix(db, ws, id).status, 'todo');
  });

  it('stores and clears the time a fix was marked done', () => {
    const id = add();
    assert.equal(
      fixes.setStatus(db, ws, id, { status: 'done', doneAt: '2026-11-27T10:00:00.000Z' }),
      true,
    );
    assert.deepEqual(
      [fixes.findFix(db, ws, id).status, fixes.findFix(db, ws, id).doneAt],
      ['done', '2026-11-27T10:00:00.000Z'],
    );
    fixes.setStatus(db, ws, id, { status: 'todo', doneAt: null });
    assert.equal(fixes.findFix(db, ws, id).doneAt, null);
  });

  it('links the answers that justify a fix, for every fix at once', () => {
    const withEvidence = add({ answerIds: [answerId] });
    const without = add();
    const evidence = fixes.listEvidence(db, ws, clientId);
    assert.deepEqual(evidence.get(withEvidence), [answerId]);
    assert.equal(evidence.has(without), false);
    assert.equal(fixes.listEvidence(db, other, clientId).size, 0);
  });

  it('counts fixes by status', () => {
    add();
    add({ status: 'done', doneAt: '2026-11-27T10:00:00.000Z' });
    add({ status: 'wont' });
    assert.deepEqual(fixes.countFixes(db, ws, clientId), { todo: 1, done: 1, wont: 1, total: 3 });
    assert.deepEqual(fixes.countFixes(db, other, clientId), {
      todo: 0,
      done: 0,
      wont: 0,
      total: 0,
    });
  });

  it('summarizes handoffs per fix with the newest content hash', () => {
    const a = add();
    const b = add();
    fixes.insertHandoffs(db, ws, {
      channel: 'csv',
      entries: [
        { fixId: a, contentHash: 'one' },
        { fixId: b, contentHash: 'one' },
      ],
    });
    fixes.insertHandoffs(db, ws, { channel: 'csv', entries: [{ fixId: a, contentHash: 'two' }] });
    const summary = fixes.summarizeHandoffs(db, ws, clientId, 'csv');
    assert.equal(summary.get(a).count, 2);
    assert.equal(summary.get(a).contentHash, 'two');
    assert.equal(summary.get(b).count, 1);
    assert.equal(fixes.summarizeHandoffs(db, other, clientId, 'csv').size, 0);
  });
});
