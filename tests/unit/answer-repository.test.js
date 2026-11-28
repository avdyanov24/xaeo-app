import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { openDatabase } from '../../src/server/db/database.js';
import * as answers from '../../src/server/repositories/answer-repository.js';
import * as clients from '../../src/server/repositories/client-repository.js';
import * as questions from '../../src/server/repositories/question-repository.js';
import * as scans from '../../src/server/repositories/scan-repository.js';
import * as workspaces from '../../src/server/repositories/workspace-repository.js';
import { applyEvent, createScan } from '../../src/server/services/scans/scan-state.js';

let db;
let ws;
let other;

beforeEach(() => {
  db = openDatabase(':memory:');
  ws = workspaces.insertWorkspace(db, 'Mine');
  other = workspaces.insertWorkspace(db, 'Theirs');
});

const NOW = Date.parse('2026-11-28T10:00:00Z');

/** A client with one question and one finished scan, so there are answers to total. */
function clientWithScan(workspaceId, fields = {}) {
  const clientId = clients.insertClient(db, {
    workspaceId,
    name: 'Acme',
    domain: 'acme.test',
    ...fields,
  });
  const questionId = questions.insertQuestion(db, { workspaceId, clientId, text: 'Who is best?' });
  const scan = applyEvent(applyEvent(createScan({ total: 2, now: NOW }), 'start'), 'complete', {
    now: NOW + 1000,
  });
  const scanId = scans.insertScan(db, { workspaceId, clientId, scan });
  scans.saveScan(db, workspaceId, scanId, scan);
  return { clientId, questionId, scanId };
}

const add = (workspaceId, { questionId, scanId }, engine, fields = {}) =>
  answers.insertAnswer(db, {
    workspaceId,
    scanId,
    questionId,
    questionText: 'Who is best?',
    engine,
    status: 'ok',
    ...fields,
  });

describe('answer repository: reading answers by id', () => {
  it('returns the requested answers in id order and skips ids it cannot find', () => {
    const scan = clientWithScan(ws);
    const first = add(ws, scan, 'chatgpt');
    const second = add(ws, scan, 'claude');
    assert.deepEqual(
      answers.listAnswersByIds(db, ws, [second, 9999, first]).map((row) => row.id),
      [first, second],
    );
  });

  it('returns nothing for an empty list without running a query', () => {
    assert.deepEqual(answers.listAnswersByIds(db, ws, []), []);
  });

  it('does not return an answer that belongs to another workspace', () => {
    const scan = clientWithScan(ws);
    const id = add(ws, scan, 'chatgpt');
    assert.deepEqual(answers.listAnswersByIds(db, other, [id]), []);
  });
});

describe('answer repository: agency-wide engine totals', () => {
  it('totals ok, mentioned and cited answers per scan and engine', () => {
    const scan = clientWithScan(ws);
    add(ws, scan, 'chatgpt', { mentioned: true, label: 'Cited' });
    add(ws, scan, 'claude', { mentioned: false, label: 'Not mentioned' });
    const [row] = answers.listEngineTotals(db, ws).filter((r) => r.engine === 'chatgpt');
    assert.deepEqual(row, {
      scanId: scan.scanId,
      clientId: scan.clientId,
      number: 1,
      finishedAt: '2026-11-28T10:00:01.000Z',
      engine: 'chatgpt',
      ok: 1,
      mentioned: 1,
      cited: 1,
    });
  });

  it('counts a failed answer in neither ok nor mentioned', () => {
    const scan = clientWithScan(ws);
    add(ws, scan, 'claude', { status: 'failed', mentioned: true, label: 'Cited' });
    assert.deepEqual(
      answers.listEngineTotals(db, ws).map(({ engine, ok, mentioned, cited }) => ({
        engine,
        ok,
        mentioned,
        cited,
      })),
      [{ engine: 'claude', ok: 0, mentioned: 0, cited: 0 }],
    );
  });

  it('leaves out archived clients, the sample client and scans that are not done', () => {
    const archived = clientWithScan(ws);
    add(ws, archived, 'chatgpt');
    clients.setArchivedAt(db, ws, archived.clientId, '2026-11-28T09:00:00.000Z');
    const sample = clientWithScan(ws, { name: 'Example', domain: 'example.test', sample: true });
    add(ws, sample, 'chatgpt');
    const running = clientWithScan(ws, { name: 'Busy', domain: 'busy.test' });
    scans.saveScan(db, ws, running.scanId, applyEvent(createScan({ total: 2, now: NOW }), 'start'));
    add(ws, running, 'chatgpt');
    assert.deepEqual(answers.listEngineTotals(db, ws), []);
  });

  it('never includes another workspace and orders rows by client, scan number and engine', () => {
    const first = clientWithScan(ws);
    add(ws, first, 'claude');
    add(ws, first, 'chatgpt');
    add(other, clientWithScan(other), 'chatgpt');
    assert.deepEqual(
      answers.listEngineTotals(db, ws).map((row) => [row.clientId, row.number, row.engine]),
      [
        [first.clientId, 1, 'chatgpt'],
        [first.clientId, 1, 'claude'],
      ],
    );
  });
});
