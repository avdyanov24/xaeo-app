import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { openDatabase } from '../../src/server/db/database.js';
import * as answers from '../../src/server/repositories/answer-repository.js';
import * as clients from '../../src/server/repositories/client-repository.js';
import * as questions from '../../src/server/repositories/question-repository.js';
import * as scans from '../../src/server/repositories/scan-repository.js';
import * as workspaces from '../../src/server/repositories/workspace-repository.js';
import {
  applyEvent,
  createScan,
  recordAnswer,
} from '../../src/server/services/scans/scan-state.js';

let db;
let ws;
let other;
let clientId;
let questionId;

beforeEach(() => {
  db = openDatabase(':memory:');
  ws = workspaces.insertWorkspace(db, 'Mine');
  other = workspaces.insertWorkspace(db, 'Theirs');
  clientId = clients.insertClient(db, { workspaceId: ws, name: 'Acme', domain: 'acme.test' });
  questionId = questions.insertQuestion(db, { workspaceId: ws, clientId, text: 'Who is best?' });
});

const NOW = Date.parse('2026-11-26T10:00:00Z');
const newScan = (total = 2) =>
  scans.insertScan(db, { workspaceId: ws, clientId, scan: createScan({ total, now: NOW }) });

describe('scan repository', () => {
  it('numbers scans per client and reads them back newest first', () => {
    const first = newScan();
    const second = newScan();
    assert.deepEqual(
      scans.listScans(db, ws, clientId).map((s) => [s.id, s.number]),
      [
        [second, 2],
        [first, 1],
      ],
    );
    const otherClient = clients.insertClient(db, { workspaceId: ws, name: 'B', domain: 'b.test' });
    const id = scans.insertScan(db, {
      workspaceId: ws,
      clientId: otherClient,
      scan: createScan({ total: 1, now: NOW }),
    });
    assert.equal(scans.findScan(db, ws, id).number, 1);
  });

  it('stores each transition of the scan lifecycle', () => {
    const id = newScan();
    let scan = applyEvent(createScan({ total: 2, now: NOW }), 'start', { now: NOW + 1000 });
    scan = recordAnswer(scan);
    scans.saveScan(db, ws, id, scan);
    assert.deepEqual(scans.findScan(db, ws, id), {
      id,
      clientId,
      number: 1,
      state: 'running',
      total: 2,
      completed: 1,
      error: null,
      createdAt: '2026-11-26T10:00:00.000Z',
      startedAt: '2026-11-26T10:00:01.000Z',
      finishedAt: null,
    });
    scan = applyEvent(scan, 'fail', { now: NOW + 2000, error: 'engine down' });
    scans.saveScan(db, ws, id, scan);
    const saved = scans.findScan(db, ws, id);
    assert.equal(saved.state, 'failed');
    assert.equal(saved.error, 'engine down');
    assert.equal(saved.finishedAt, '2026-11-26T10:00:02.000Z');
  });

  it('finds the queued or running scan and ignores finished ones', () => {
    const id = newScan();
    assert.equal(scans.findActiveScan(db, ws, clientId).id, id);
    const done = applyEvent(applyEvent(createScan({ total: 1, now: NOW }), 'start'), 'complete');
    scans.saveScan(db, ws, id, done);
    assert.equal(scans.findActiveScan(db, ws, clientId), undefined);
  });

  it('lists unfinished scans across workspaces for start-up recovery', () => {
    const id = newScan();
    assert.deepEqual(scans.listUnfinishedScans(db), [{ id, workspaceId: ws }]);
  });

  it('never reads or writes a scan from another workspace', () => {
    const id = newScan();
    assert.equal(scans.findScan(db, other, id), undefined);
    assert.deepEqual(scans.listScans(db, other, clientId), []);
    assert.equal(scans.findActiveScan(db, other, clientId), undefined);
    const cancelled = applyEvent(createScan({ total: 2, now: NOW }), 'cancel');
    assert.equal(scans.saveScan(db, other, id, cancelled), false);
    assert.equal(scans.findScan(db, ws, id).state, 'queued');
  });
});

describe('answer repository', () => {
  const base = () => ({
    workspaceId: ws,
    questionId,
    questionText: 'Who is best?',
  });

  it('round-trips an answer with its citations and competitors', () => {
    const scanId = newScan();
    const id = answers.insertAnswer(db, {
      ...base(),
      scanId,
      engine: 'claude',
      status: 'ok',
      text: 'Acme is second.',
      mentioned: true,
      position: 2,
      label: 'Mentioned',
      citations: [{ url: 'https://a.test/x', title: 'X', domain: 'a.test' }],
      citedUrls: [],
      competitors: ['Rapid Flow'],
    });
    const stored = answers.findAnswer(db, ws, id);
    assert.match(stored.createdAt, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    assert.deepEqual(stored, {
      id,
      createdAt: stored.createdAt,
      scanId,
      questionId,
      questionText: 'Who is best?',
      engine: 'claude',
      status: 'ok',
      text: 'Acme is second.',
      error: null,
      mentioned: true,
      position: 2,
      label: 'Mentioned',
      citations: [{ url: 'https://a.test/x', title: 'X', domain: 'a.test' }],
      citedUrls: [],
      competitors: ['Rapid Flow'],
    });
  });

  it('totals the answers that came back, the ones that name the client and the failures', () => {
    const scanId = newScan();
    const add = (engine, fields) =>
      answers.insertAnswer(db, { ...base(), scanId, engine, ...fields });
    add('chatgpt', { status: 'ok', mentioned: true });
    add('claude', { status: 'failed', error: 'no_answer' });
    assert.deepEqual(answers.scanTotals(db, ws, scanId), { ok: 1, mentioned: 1, failed: 1 });
    assert.deepEqual(answers.scanTotals(db, ws, 9999), { ok: 0, mentioned: 0, failed: 0 });
  });

  it('allows one answer per question and engine in a scan until the scan is cleared', () => {
    const scanId = newScan();
    const add = () =>
      answers.insertAnswer(db, { ...base(), scanId, engine: 'chatgpt', status: 'ok' });
    add();
    assert.throws(add);
    answers.deleteAnswers(db, ws, scanId);
    assert.doesNotThrow(add);
  });

  it('never reads or clears answers from another workspace', () => {
    const scanId = newScan();
    const id = answers.insertAnswer(db, { ...base(), scanId, engine: 'chatgpt', status: 'ok' });
    assert.equal(answers.findAnswer(db, other, id), undefined);
    assert.deepEqual(answers.listAnswers(db, other, scanId), []);
    answers.deleteAnswers(db, other, scanId);
    assert.equal(answers.listAnswers(db, ws, scanId).length, 1);
  });
});
