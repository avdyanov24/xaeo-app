import { transaction } from '../db/database.js';
import * as answers from '../repositories/answer-repository.js';
import * as clients from '../repositories/client-repository.js';
import * as questions from '../repositories/question-repository.js';
import * as scans from '../repositories/scan-repository.js';
import { createSampleEngines } from './engines/sample-engine.js';
import { addSampleFixes } from './fixes/sample-fixes.js';
import { loadAnswerSet } from './engines/sample-answers.js';
import { collectAnswer } from './scans/collect.js';
import { applyEvent, createScan, recordAnswer } from './scans/scan-state.js';

/** The example client's questions, in answer-set order, with what each buyer is trying to do. */
const QUESTION_INTENTS = Object.freeze(['urgent', 'urgent', 'find', 'urgent', 'trust']);

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Adds the Northside Plumbing example client to a workspace, with its five questions and a
 * finished first scan of ten answers read from the sample answer set: the baseline of the story,
 * where the client is named in 2 of 10, and its four fixes. A workspace has one example client;
 * calling this again returns the existing one and writes nothing (apart from the fixes, when an
 * older database has none).
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} workspaceId
 * @param {{ now?: number, answerSet?: ReturnType<typeof loadAnswerSet> }} [options]
 * @returns {Promise<{ id: number, created: boolean }>}
 */
export async function addSampleClient(
  db,
  workspaceId,
  { now = Date.now(), answerSet = loadAnswerSet() } = {},
) {
  const existing = clients.findSampleClient(db, workspaceId);
  if (existing) {
    // A database seeded before fixes existed gets them on the next seed.
    transaction(db, () => addSampleFixes(db, workspaceId, existing.id, { answerSet }));
    return { id: existing.id, created: false };
  }

  // Engines are async, so every answer is collected before the transaction opens.
  const engines = createSampleEngines(answerSet);
  const context = { client: answerSet.client, competitors: answerSet.competitors };
  const collected = [];
  for (const [index, text] of answerSet.questions.entries()) {
    for (const engine of engines) {
      collected.push({
        index,
        question: text,
        ...(await collectAnswer({ engine, question: text, context })),
      });
    }
  }

  return transaction(db, () => {
    // Another request may have added it while the answers were collected.
    const raced = clients.findSampleClient(db, workspaceId);
    if (raced) return { id: raced.id, created: false };

    const { client } = answerSet;
    const clientId = clients.insertClient(db, {
      workspaceId,
      name: client.name,
      domain: client.domain,
      type: 'Plumber',
      city: client.city,
      country: 'GB',
      sample: true,
      nextRunAt: new Date(now + WEEK_MS).toISOString(),
    });
    const questionIds = answerSet.questions.map((text, index) =>
      questions.insertQuestion(db, {
        workspaceId,
        clientId,
        text,
        intent: QUESTION_INTENTS[index] ?? 'find',
      }),
    );

    let scan = applyEvent(createScan({ total: collected.length, now }), 'start', { now });
    const scanId = scans.insertScan(db, { workspaceId, clientId, scan });
    for (const { index, question, ...answer } of collected) {
      answers.insertAnswer(db, {
        workspaceId,
        scanId,
        questionId: questionIds[index],
        questionText: question,
        ...answer,
      });
      scan = recordAnswer(scan);
    }
    scan = applyEvent(scan, 'complete', { now });
    scans.saveScan(db, workspaceId, scanId, scan);
    addSampleFixes(db, workspaceId, clientId, { answerSet });
    return { id: clientId, created: true };
  });
}
