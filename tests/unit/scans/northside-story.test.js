import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENGINE_IDS } from '../../../src/server/services/engines/engine.js';
import { loadAnswerSet } from '../../../src/server/services/engines/sample-answers.js';
import { createSampleEngine } from '../../../src/server/services/engines/sample-engine.js';
import { extractAnswer } from '../../../src/server/services/scans/extractor.js';

const answerSet = loadAnswerSet();
const context = { client: answerSet.client, competitors: answerSet.competitors };

/** Runs one question through one sample engine and the extractor, like a scan will. */
async function read(questionIndex, engineId) {
  const question = answerSet.questions[questionIndex];
  const answer = await createSampleEngine(engineId, answerSet).ask(question);
  return extractAnswer(answer, context);
}

// [question index, engine] -> what the extractor must find. Rows follow answerSet.questions.
const EXPECTED = [
  [0, 'chatgpt', 'Not mentioned', null, ['Rapid Flow', 'CityPipe']],
  [0, 'claude', 'Mentioned', 2, ['Rapid Flow', 'CityPipe']],
  [1, 'chatgpt', 'Not mentioned', null, ['CityPipe']],
  [1, 'claude', 'Not mentioned', null, ['Rapid Flow', 'CityPipe']],
  [2, 'chatgpt', 'Not mentioned', null, ['Rapid Flow']],
  [2, 'claude', 'Not mentioned', null, ['CityPipe']],
  [3, 'chatgpt', 'Cited', 3, ['Rapid Flow', 'CityPipe']],
  [3, 'claude', 'Not mentioned', null, ['Rapid Flow', 'CityPipe']],
  [4, 'chatgpt', 'Not mentioned', null, []],
  [4, 'claude', 'Not mentioned', null, []],
];

describe('Northside Plumbing sample story', () => {
  for (const [q, engine, label, position, competitors] of EXPECTED) {
    it(`question ${q + 1} on ${engine}: ${label}${position ? ` at #${position}` : ''}`, async () => {
      const result = await read(q, engine);
      assert.equal(result.label, label);
      assert.equal(result.position, position);
      assert.deepEqual(result.competitors, competitors);
    });
  }

  it('covers each of the 10 answers exactly once', () => {
    const covered = new Set(EXPECTED.map(([q, engine]) => `${q}:${engine}`));
    assert.equal(covered.size, answerSet.questions.length * ENGINE_IDS.length);
    assert.equal(covered.size, 10);
  });

  it('names Northside in 2 of the 10 answers, the baseline', async () => {
    const results = [];
    for (let q = 0; q < answerSet.questions.length; q++)
      for (const engine of ENGINE_IDS) results.push(await read(q, engine));
    assert.equal(results.length, 10);
    assert.equal(results.filter((r) => r.mentioned).length, 2);
  });

  it('has Claude name Northside second and ChatGPT recommend Rapid Flow and CityPipe on the hero question', async () => {
    const chatgpt = await read(0, 'chatgpt');
    const claude = await read(0, 'claude');
    assert.equal(claude.position, 2);
    assert.equal(chatgpt.mentioned, false);
    assert.deepEqual(chatgpt.competitors, ['Rapid Flow', 'CityPipe']);
  });

  it('cites the client site only where it is also named', async () => {
    const cited = [];
    for (let q = 0; q < answerSet.questions.length; q++)
      for (const engine of ENGINE_IDS) {
        const result = await read(q, engine);
        if (result.cited) cited.push([q, engine, result.mentioned]);
      }
    assert.deepEqual(cited, [[3, 'chatgpt', true]]);
  });
});
