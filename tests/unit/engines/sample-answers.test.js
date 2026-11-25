import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  loadAnswerSet,
  questionKey,
  validateAnswerSet,
} from '../../../src/server/services/engines/sample-answers.js';

const valid = () => ({
  client: { name: 'Northside Plumbing', domain: 'northsideplumbing.co.uk' },
  competitors: ['Rapid Flow'],
  questions: ['Q1?'],
  answers: {
    'Q1?': {
      chatgpt: { text: 'a', citations: [] },
      claude: { text: 'b', citations: [{ url: 'https://example.com/x' }] },
    },
  },
});

describe('sample answer set', () => {
  it('loads the Northside story: 5 questions, 2 engines, 10 answers', () => {
    const set = loadAnswerSet();
    assert.equal(set.client.name, 'Northside Plumbing');
    assert.equal(set.client.domain, 'northsideplumbing.co.uk');
    assert.equal(set.questions.length, 5);
    const answers = set.questions.flatMap((q) => Object.values(set.answersFor(q)));
    assert.equal(answers.length, 10);
  });

  it('names only the engines and companies in the story', () => {
    const set = loadAnswerSet();
    const text = JSON.stringify(set.questions.map((q) => set.answersFor(q)));
    assert.doesNotMatch(text, /gemini|perplexity|overview/i);
    assert.deepEqual(set.competitors, ['Rapid Flow', 'CityPipe']);
  });

  it('finds an answer ignoring case, spacing and the question mark', () => {
    const set = loadAnswerSet();
    const question = set.questions[0];
    assert.ok(set.answersFor(question.toUpperCase().replace('?', '  ?')));
    assert.equal(set.answersFor('Who sells shoes?'), undefined);
  });

  it('normalises question keys', () => {
    assert.equal(questionKey('  Who   IS it??  '), 'who is it');
  });

  it('accepts a valid set and returns it', () => {
    const data = valid();
    assert.equal(validateAnswerSet(data), data);
  });

  it('lists every problem at once', () => {
    const data = valid();
    delete data.client.domain;
    delete data.answers['Q1?'].claude;
    data.answers['Q1?'].chatgpt.citations = [{ url: 'ftp://nope' }];
    assert.throws(
      () => validateAnswerSet(data),
      (error) =>
        /client needs a name and a domain/.test(error.message) &&
        /no claude answer text/.test(error.message) &&
        /without an http\(s\) url/.test(error.message),
    );
  });

  it('rejects answers for an engine Xaeo does not ask', () => {
    const data = valid();
    data.answers['Q1?'].gemini = { text: 'x', citations: [] };
    assert.throws(() => validateAnswerSet(data), /unknown engines: gemini/);
  });

  it('rejects a question that has no answers', () => {
    const data = valid();
    data.questions.push('Q2?');
    assert.throws(() => validateAnswerSet(data), /"Q2\?" has no answers/);
  });
});
