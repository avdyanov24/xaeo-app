import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { openDatabase } from '../../../src/server/db/database.js';
import * as answers from '../../../src/server/repositories/answer-repository.js';
import * as clients from '../../../src/server/repositories/client-repository.js';
import * as questions from '../../../src/server/repositories/question-repository.js';
import * as scans from '../../../src/server/repositories/scan-repository.js';
import * as workspaces from '../../../src/server/repositories/workspace-repository.js';
import { createSampleEngines } from '../../../src/server/services/engines/sample-engine.js';
import { loadAnswerSet } from '../../../src/server/services/engines/sample-answers.js';
import { addSampleClient } from '../../../src/server/services/sample-client.js';
import { createScanRunner } from '../../../src/server/services/scans/scan-runner.js';

const answerSet = loadAnswerSet();
const noWait = async () => {};

let db;
let ws;
let clientId;
let log;

/** The Northside client already has a finished baseline scan; most tests start a second one. */
beforeEach(async () => {
  db = openDatabase(':memory:');
  ws = workspaces.insertWorkspace(db, 'Brightline Digital');
  clientId = (await addSampleClient(db, ws)).id;
  log = [];
});

const runner = (overrides = {}) =>
  createScanRunner({
    db,
    engines: createSampleEngines(answerSet),
    competitors: answerSet.competitors,
    logger: { error: (message, fields) => log.push([message, fields]) },
    sleep: noWait,
    ...overrides,
  });

describe('scan runner', () => {
  it('queues a scan, then collects all ten answers and finishes it', async () => {
    const scanRunner = runner();
    const queued = scanRunner.startScan(ws, clientId);
    assert.equal(queued.state, 'queued');
    assert.equal(queued.number, 2);
    assert.equal(queued.total, 10);

    await scanRunner.idle();
    const done = scans.findScan(db, ws, queued.id);
    assert.equal(done.state, 'done');
    assert.equal(done.completed, 10);
    assert.ok(done.startedAt && done.finishedAt);
    assert.deepEqual(answers.scanTotals(db, ws, queued.id), { ok: 10, mentioned: 2, failed: 0 });
  });

  it('stores answers one at a time so progress can be polled', async () => {
    const seen = [];
    const run = {};
    const scanRunner = runner({
      sleep: async () => {
        if (run.id) seen.push(scans.findScan(db, ws, run.id).completed);
      },
    });
    run.id = scanRunner.startScan(ws, clientId).id;
    await scanRunner.idle();
    assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('refuses a second scan while one is in progress', async () => {
    const scanRunner = runner();
    scanRunner.startScan(ws, clientId);
    assert.throws(() => scanRunner.startScan(ws, clientId), { status: 409 });
    await scanRunner.idle();
    assert.doesNotThrow(() => scanRunner.startScan(ws, clientId));
    await scanRunner.idle();
  });

  it('refuses an archived client, a client with no active question and an unknown client', () => {
    const scanRunner = runner();
    assert.throws(() => scanRunner.startScan(ws, 9999), { status: 404 });

    for (const question of questions.listQuestions(db, ws, clientId))
      questions.updateQuestion(db, ws, question.id, { active: false });
    assert.throws(() => scanRunner.startScan(ws, clientId), { status: 400 });

    clients.setArchivedAt(db, ws, clientId, '2026-11-26T10:00:00.000Z');
    assert.throws(() => scanRunner.startScan(ws, clientId), { status: 409 });
  });

  it("never starts a scan for another workspace's client", () => {
    const other = workspaces.insertWorkspace(db, 'Other Agency');
    assert.throws(() => runner().startScan(other, clientId), { status: 404 });
  });

  it('scans only the questions that are switched on', async () => {
    const [first] = questions.listQuestions(db, ws, clientId);
    questions.updateQuestion(db, ws, first.id, { active: false });
    const scanRunner = runner();
    const { id, total } = scanRunner.startScan(ws, clientId);
    assert.equal(total, 8);
    await scanRunner.idle();
    assert.equal(answers.listAnswers(db, ws, id).length, 8);
  });

  it('keeps the answers collected so far when a scan is cancelled, and stops asking', async () => {
    const run = {};
    let step = 0;
    run.runner = runner({
      sleep: async () => {
        if (++step === 4) run.runner.cancelScan(ws, run.id);
      },
    });
    run.id = run.runner.startScan(ws, clientId).id;
    await run.runner.idle();
    const scan = scans.findScan(db, ws, run.id);
    assert.equal(scan.state, 'cancelled');
    assert.equal(scan.completed, 3);
    assert.equal(answers.listAnswers(db, ws, run.id).length, 3);
  });

  it('drops an answer that was still being collected when the scan was cancelled', async () => {
    const run = {};
    const [chatgpt, claude] = createSampleEngines(answerSet);
    const cancelsWhileAsked = {
      ...chatgpt,
      ask: async (question) => {
        run.runner.cancelScan(ws, run.id);
        return chatgpt.ask(question);
      },
    };
    run.runner = runner({ engines: [cancelsWhileAsked, claude] });
    run.id = run.runner.startScan(ws, clientId).id;
    await run.runner.idle();
    assert.equal(scans.findScan(db, ws, run.id).state, 'cancelled');
    assert.equal(answers.listAnswers(db, ws, run.id).length, 0);
  });

  it('retries a cancelled scan from the first answer without duplicating answers', async () => {
    const run = {};
    let step = 0;
    run.runner = runner({
      sleep: async () => {
        // Cancel and retry while the first loop is still alive: it must stop at its next check, and
        // the retry must wait for it, so no answer is stored twice.
        if (++step === 3) {
          run.runner.cancelScan(ws, run.id);
          run.retried = run.runner.retryScan(ws, run.id);
        }
      },
    });
    run.id = run.runner.startScan(ws, clientId).id;
    await run.runner.idle();
    assert.equal(run.retried.state, 'queued');
    assert.equal(run.retried.completed, 0);
    assert.equal(scans.findScan(db, ws, run.id).state, 'done');
    assert.equal(answers.listAnswers(db, ws, run.id).length, 10);
  });
  it('answers 409 when cancelling or retrying a scan that is done', () => {
    const [baseline] = scans.listScans(db, ws, clientId);
    assert.equal(baseline.state, 'done');
    assert.throws(() => runner().cancelScan(ws, baseline.id), { status: 409 });
    assert.throws(() => runner().retryScan(ws, baseline.id), { status: 409 });
    assert.throws(() => runner().cancelScan(ws, 9999), { status: 404 });
  });

  it('records a question the engine has no answer for as a failed answer and still finishes', async () => {
    questions.insertQuestion(db, { workspaceId: ws, clientId, text: 'Who sells garden gnomes?' });
    const scanRunner = runner();
    const { id } = scanRunner.startScan(ws, clientId);
    await scanRunner.idle();
    assert.equal(scans.findScan(db, ws, id).state, 'done');
    assert.deepEqual(answers.scanTotals(db, ws, id), { ok: 10, mentioned: 2, failed: 2 });
    const failed = answers.listAnswers(db, ws, id).filter((a) => a.status === 'failed');
    assert.ok(failed.every((a) => a.label === 'Failed' && a.text === null));
  });

  it('fails the scan with a plain message and logs the cause when an engine breaks', async () => {
    const broken = {
      id: 'chatgpt',
      ask: async () => {
        throw new TypeError('socket closed');
      },
    };
    const scanRunner = runner({ engines: [broken] });
    const { id } = scanRunner.startScan(ws, clientId);
    await scanRunner.idle();
    const scan = scans.findScan(db, ws, id);
    assert.equal(scan.state, 'failed');
    assert.equal(scan.error, 'The scan stopped because of an internal error.');
    assert.deepEqual(log, [['scan failed', { scanId: id, error: 'socket closed' }]]);
  });

  it('fails scans left over from a stopped process and lets them be retried', async () => {
    const stuck = scans.insertScan(db, {
      workspaceId: ws,
      clientId,
      scan: { state: 'queued', total: 10, completed: 0, createdAt: '2026-11-26T09:00:00.000Z' },
    });
    const scanRunner = runner();
    assert.equal(scanRunner.recover(), 1);
    const failed = scans.findScan(db, ws, stuck);
    assert.equal(failed.state, 'failed');
    assert.match(failed.error, /restarted/);
    assert.equal(scanRunner.recover(), 0);

    scanRunner.retryScan(ws, stuck);
    await scanRunner.idle();
    assert.equal(scans.findScan(db, ws, stuck).state, 'done');
  });
});
