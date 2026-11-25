import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertEngine, EngineError } from '../../../src/server/services/engines/engine.js';
import {
  createSampleEngine,
  createSampleEngines,
} from '../../../src/server/services/engines/sample-engine.js';
import { loadAnswerSet } from '../../../src/server/services/engines/sample-answers.js';

const answerSet = loadAnswerSet();
const hero = answerSet.questions[0];

describe('sample engine', () => {
  it('satisfies the engine interface', () => {
    for (const engine of createSampleEngines(answerSet)) assertEngine(engine);
  });

  it('creates ChatGPT and Claude, and nothing else', () => {
    const engines = createSampleEngines(answerSet);
    assert.deepEqual(
      engines.map((e) => [e.id, e.name]),
      [
        ['chatgpt', 'ChatGPT'],
        ['claude', 'Claude'],
      ],
    );
  });

  it('answers the hero question differently for each engine', async () => {
    const chatgpt = await createSampleEngine('chatgpt', answerSet).ask(hero);
    const claude = await createSampleEngine('claude', answerSet).ask(hero);
    assert.match(chatgpt.text, /Rapid Flow and CityPipe/);
    assert.doesNotMatch(chatgpt.text, /Northside/);
    assert.match(claude.text, /Northside Plumbing/);
  });

  it('returns the same answer every time', async () => {
    const engine = createSampleEngine('claude', answerSet);
    assert.deepEqual(await engine.ask(hero), await engine.ask(hero));
  });

  it('returns copies, so callers cannot change the answer set', async () => {
    const engine = createSampleEngine('chatgpt', answerSet);
    const first = await engine.ask(hero);
    first.text = 'changed';
    first.citations[0].url = 'https://changed.example';
    const second = await engine.ask(hero);
    assert.notEqual(second.text, 'changed');
    assert.notEqual(second.citations[0].url, 'https://changed.example');
  });

  it('matches a question the way the answer set does', async () => {
    const engine = createSampleEngine('claude', answerSet);
    const answer = await engine.ask(`  ${hero.toLowerCase().replace('?', ' ?')}`);
    assert.ok(answer.text.length > 0);
  });

  it('raises a no_answer EngineError for an unknown question', async () => {
    const engine = createSampleEngine('claude', answerSet);
    await assert.rejects(engine.ask('Who sells shoes in Leeds?'), (error) => {
      return error instanceof EngineError && error.code === 'no_answer';
    });
  });

  it('refuses an engine id Xaeo does not ask', () => {
    assert.throws(() => createSampleEngine('gemini', answerSet), /Unknown engine id: gemini/);
  });
});
