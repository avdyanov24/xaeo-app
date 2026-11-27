import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { openDatabase } from '../../src/server/db/database.js';
import * as answers from '../../src/server/repositories/answer-repository.js';
import * as fixes from '../../src/server/repositories/fix-repository.js';
import * as scans from '../../src/server/repositories/scan-repository.js';
import * as workspaces from '../../src/server/repositories/workspace-repository.js';
import { createFixService } from '../../src/server/services/fixes/fix-service.js';
import { addSampleClient } from '../../src/server/services/sample-client.js';
import {
  applyEvent,
  createScan,
  recordAnswer,
} from '../../src/server/services/scans/scan-state.js';

const T0 = Date.parse('2026-11-27T09:00:00Z');

let db;
let ws;
let clientId;
let service;
let clock;
let baseline;

const FIX = {
  title: 'Publish an emergency page',
  type: 'page',
  impact: 'High',
  evidence: 'Medium',
  url: 'https://northsideplumbing.co.uk/emergency-plumber-leeds',
  engines: ['chatgpt'],
  why: 'Why',
  code: '# Outline',
  lang: 'markdown',
  verify: 'Check it',
};

beforeEach(async () => {
  db = openDatabase(':memory:');
  ws = workspaces.insertWorkspace(db, 'Mine');
  ({ id: clientId } = await addSampleClient(db, ws, { now: T0 }));
  baseline = scans.listScans(db, ws, clientId)[0];
  clock = T0 + 60_000;
  service = createFixService({ db, now: () => clock });
});

const answerFor = (engine, question) =>
  answers
    .listAnswers(db, ws, baseline.id)
    .find((a) => a.engine === engine && a.questionText.includes(question));

const addFix = (fields = {}) =>
  fixes.insertFix(db, { workspaceId: ws, clientId, ...FIX, ...fields });

/** A second finished scan in which the client is named by ChatGPT on the emergency question. */
function rescan(finishedAt) {
  const scan = applyEvent(createScan({ total: 1, now: finishedAt }), 'start', { now: finishedAt });
  const id = scans.insertScan(db, { workspaceId: ws, clientId, scan });
  const old = answerFor('chatgpt', 'emergency plumber');
  answers.insertAnswer(db, {
    workspaceId: ws,
    scanId: id,
    questionId: old.questionId,
    questionText: old.questionText,
    engine: 'chatgpt',
    status: 'ok',
    mentioned: true,
    position: 1,
    label: 'Mentioned',
  });
  scans.saveScan(db, ws, id, applyEvent(recordAnswer(scan), 'complete', { now: finishedAt }));
}

describe('fix service', () => {
  it('lists fixes with string ids, engine names, evidence labels and an estimate', () => {
    const evidence = answerFor('chatgpt', 'emergency plumber');
    addFix({ answerIds: [evidence.id] });
    const { fixes: list, estimate, allDone, definitions } = service.list(ws, clientId);
    assert.equal(list.length, 1);
    const [fix] = list;
    assert.equal(fix.id, '1');
    assert.deepEqual(fix.engines, ['ChatGPT']);
    assert.equal(fix.status, 'todo');
    assert.equal(fix.canVerify, false);
    assert.deepEqual(fix.evidenceAnswers, [
      {
        id: String(evidence.id),
        engine: 'ChatGPT',
        question: evidence.questionText,
        label: 'Not mentioned',
        position: null,
      },
    ]);
    assert.deepEqual(estimate, { current: 2, total: 10, projected: 3 });
    assert.equal(allDone, false);
    assert.ok(definitions.impact.High && definitions.evidence.Weak);
  });

  it('marks a fix done with the time, keeps the estimate, and reopens it', () => {
    const id = addFix();
    const done = service.setStatus(ws, id, 'done');
    assert.equal(done.fixes[0].status, 'done');
    assert.equal(done.fixes[0].doneAt, new Date(clock).toISOString());
    assert.equal(done.fixes[0].postDoneScan, false);
    // Done but not yet measured by a scan: still counted as a linked answer.
    assert.equal(done.estimate.projected, 3);
    assert.equal(done.allDone, true);

    clock += 5_000;
    const again = service.setStatus(ws, id, 'done');
    assert.equal(again.fixes[0].doneAt, done.fixes[0].doneAt, 'repeating changes nothing');

    const reopened = service.setStatus(ws, id, 'todo');
    assert.equal(reopened.fixes[0].status, 'todo');
    assert.equal(reopened.fixes[0].doneAt, null);
    assert.equal(reopened.allDone, false);
  });

  it('leaves a fix that was set aside out of the estimate', () => {
    const id = addFix();
    const aside = service.setStatus(ws, id, 'wont');
    assert.equal(aside.fixes[0].status, 'wont');
    assert.equal(aside.estimate.projected, 2);
    assert.equal(aside.allDone, false);
  });

  it('shows how the linked answers read after a scan that finished once the fix was done', () => {
    const evidence = answerFor('chatgpt', 'emergency plumber');
    const id = addFix({ answerIds: [evidence.id] });
    service.setStatus(ws, id, 'done');
    rescan(clock + 60_000);
    const [fix] = service.list(ws, clientId).fixes;
    assert.equal(fix.postDoneScan, true);
    assert.equal(fix.latestReturned, 1);
    assert.equal(fix.nowMentioned, 1);
    assert.equal(fix.latestAnswers[0].label, 'Mentioned');
    // The scan already counts what the fix won, so nothing is left to estimate.
    assert.deepEqual(service.list(ws, clientId).estimate, { current: 1, total: 1, projected: 1 });
  });

  it('does not treat a scan that finished before the fix was done as a measurement', () => {
    const evidence = answerFor('chatgpt', 'emergency plumber');
    const id = addFix({ answerIds: [evidence.id] });
    rescan(clock - 30_000);
    service.setStatus(ws, id, 'done');
    assert.equal(service.list(ws, clientId).fixes[0].postDoneScan, false);
  });

  it('has no estimate before the first finished scan', () => {
    const other = workspaces.insertWorkspace(db, 'Other');
    const empty = db
      .prepare("INSERT INTO clients (workspace_id, name, domain) VALUES (?, 'New', 'new.test')")
      .run(other).lastInsertRowid;
    assert.deepEqual(service.list(other, Number(empty)), {
      fixes: [],
      estimate: null,
      allDone: false,
      definitions: service.list(ws, clientId).definitions,
    });
  });

  it('answers 404 for a fix or client in another workspace', () => {
    const id = addFix();
    const other = workspaces.insertWorkspace(db, 'Other');
    assert.throws(() => service.list(other, clientId), { status: 404 });
    assert.throws(() => service.setStatus(other, id, 'done'), { status: 404 });
    assert.throws(() => service.verify(other, id), { status: 404 });
    assert.equal(fixes.findFix(db, ws, id).status, 'todo');
  });

  it('refuses to compare website observations because none are saved', () => {
    const id = addFix();
    assert.throws(() => service.verify(ws, id), { status: 409 });
  });
});
