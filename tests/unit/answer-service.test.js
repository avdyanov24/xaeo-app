import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { openDatabase } from '../../src/server/db/database.js';
import * as answers from '../../src/server/repositories/answer-repository.js';
import * as clients from '../../src/server/repositories/client-repository.js';
import * as questions from '../../src/server/repositories/question-repository.js';
import * as scans from '../../src/server/repositories/scan-repository.js';
import * as workspaces from '../../src/server/repositories/workspace-repository.js';
import { createAnswerService } from '../../src/server/services/answer-service.js';
import { applyEvent, createScan } from '../../src/server/services/scans/scan-state.js';

const NOW = Date.parse('2026-11-28T10:00:00Z');

let db;
let ws;
let service;
let clientId;
let questionId;

beforeEach(() => {
  db = openDatabase(':memory:');
  ws = workspaces.insertWorkspace(db, 'Brightline Digital');
  service = createAnswerService({ db });
  clientId = clients.insertClient(db, { workspaceId: ws, name: 'Acme', domain: 'acme.test' });
  questionId = questions.insertQuestion(db, {
    workspaceId: ws,
    clientId,
    text: 'Who is the best plumber in Leeds?',
  });
});

/** Stores a scan that went through the given events, with one answer per engine when it finished. */
function addScan(
  events,
  { workspaceId = ws, forClient = clientId, forQuestion = questionId } = {},
) {
  let scan = createScan({ total: 2, now: NOW });
  for (const event of events) scan = applyEvent(scan, event, { now: NOW + 1000 });
  const scanId = scans.insertScan(db, { workspaceId, clientId: forClient, scan });
  scans.saveScan(db, workspaceId, scanId, scan);
  return { scanId, forQuestion };
}

const addAnswer = ({ scanId, forQuestion }, engine, fields = {}) =>
  answers.insertAnswer(db, {
    workspaceId: ws,
    scanId,
    questionId: forQuestion,
    questionText: 'Who is the best plumber in Leeds?',
    engine,
    status: 'ok',
    ...fields,
  });

describe('answer service: grid', () => {
  it('throws 404 for a client that is not in the workspace', () => {
    assert.throws(() => service.grid(ws, 9999), { status: 404 });
    const other = workspaces.insertWorkspace(db, 'Other Agency');
    assert.throws(() => service.grid(other, clientId), { status: 404 });
  });

  it('returns an empty grid with the engines when nothing has finished', () => {
    const grid = service.grid(ws, clientId);
    assert.equal(grid.scan, null);
    assert.deepEqual(grid.scans, []);
    assert.deepEqual(grid.cells, {});
    assert.deepEqual(
      grid.engines.map((engine) => engine.id),
      ['chatgpt', 'claude'],
    );
  });

  it('uses the newest finished scan and sends ids as strings', () => {
    const older = addScan(['start', 'complete']);
    addAnswer(older, 'chatgpt');
    const newer = addScan(['start', 'complete']);
    const chatgpt = addAnswer(newer, 'chatgpt', { label: 'Not named', position: null });
    const claude = addAnswer(newer, 'claude', { label: 'Named second', position: 2 });

    const grid = service.grid(ws, clientId);
    assert.equal(grid.scan.id, newer.scanId);
    assert.equal(grid.scan.status, 'done');
    assert.deepEqual(grid.questions, [
      { id: String(questionId), text: 'Who is the best plumber in Leeds?' },
    ]);
    const cell = grid.cells[String(questionId)];
    assert.equal(cell.chatgpt.id, String(chatgpt));
    assert.equal(cell.claude.id, String(claude));
    assert.equal(cell.claude.label, 'Named second');
    assert.equal(cell.claude.position, 2);
  });

  it('compares the scan with the one before it when the questions are the same', () => {
    const first = addScan(['start', 'complete']);
    addAnswer(first, 'chatgpt');
    const second = addScan(['start', 'complete']);
    addAnswer(second, 'chatgpt');

    assert.equal(service.grid(ws, clientId).scan.comparisonToPrevious.comparable, true);
    assert.equal(
      service.grid(ws, clientId, first.scanId).scan.comparisonToPrevious.comparable,
      false,
    );
  });

  it('hides scans that are still running or have no answers, and refuses them by id', () => {
    const running = addScan(['start']);
    addAnswer(running, 'chatgpt');
    const empty = addScan(['start', 'complete']);

    const grid = service.grid(ws, clientId);
    assert.equal(grid.scan, null);
    assert.throws(() => service.grid(ws, clientId, running.scanId), { status: 404 });
    assert.throws(() => service.grid(ws, clientId, empty.scanId), { status: 404 });
  });

  it('does not read a scan that belongs to another client', () => {
    const otherClient = clients.insertClient(db, {
      workspaceId: ws,
      name: 'Beta',
      domain: 'beta.test',
    });
    const otherQuestion = questions.insertQuestion(db, {
      workspaceId: ws,
      clientId: otherClient,
      text: 'Who is cheapest?',
    });
    const theirs = addScan(['start', 'complete'], {
      forClient: otherClient,
      forQuestion: otherQuestion,
    });
    addAnswer(theirs, 'claude');
    assert.throws(() => service.grid(ws, clientId, theirs.scanId), { status: 404 });
  });
});

describe('answer service: detail', () => {
  it('returns the answer in full with the engine name and the client it belongs to', () => {
    const scan = addScan(['start', 'complete']);
    const id = addAnswer(scan, 'claude', {
      text: 'Acme is a good choice.',
      mentioned: true,
      position: 1,
      label: 'Named first',
      competitors: ['Rapid Flow'],
      citations: [{ url: 'https://acme.test/', title: 'Acme', domain: 'acme.test' }],
    });

    const detail = service.detail(ws, id);
    assert.equal(detail.id, String(id));
    assert.equal(detail.engine, 'Claude');
    assert.equal(detail.clientName, 'Acme');
    assert.equal(detail.question, 'Who is the best plumber in Leeds?');
    assert.deepEqual(detail.competitors, ['Rapid Flow']);
    assert.equal(detail.citations[0].domain, 'acme.test');
    assert.equal(detail.mode, 'sample');
    assert.match(detail.method, /No engine was asked/);
  });

  it('throws 404 for an answer in another workspace or one that does not exist', () => {
    const id = addAnswer(addScan(['start', 'complete']), 'chatgpt');
    const other = workspaces.insertWorkspace(db, 'Other Agency');
    assert.throws(() => service.detail(other, id), { status: 404 });
    assert.throws(() => service.detail(ws, 9999), { status: 404 });
  });
});
