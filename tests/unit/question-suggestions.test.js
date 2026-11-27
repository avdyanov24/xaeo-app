import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { INTENTS } from '../../src/server/repositories/question-repository.js';
import { suggestQuestions } from '../../src/server/services/question-suggestions.js';

describe('suggestQuestions', () => {
  it("writes six questions from the client's type and city, five of them on", () => {
    const questions = suggestQuestions({
      name: 'Northside Plumbing',
      type: 'Plumber',
      city: 'Leeds',
    });
    assert.deepEqual(
      questions.map((q) => q.text),
      [
        'Who is the best plumber in Leeds?',
        'Which plumber in Leeds can help me today?',
        'What are the best-reviewed plumber companies in Leeds?',
        'How do I find a trustworthy plumber in Leeds?',
        'How do I choose a plumber in Leeds?',
        'Is Northside Plumbing a good plumber in Leeds?',
      ],
    );
    assert.deepEqual(
      questions.map((q) => q.on),
      [true, true, true, true, true, false],
    );
  });

  it('uses only the intents the app knows', () => {
    for (const q of suggestQuestions({ name: 'Acme' })) assert.ok(INTENTS.includes(q.intent));
  });

  it('still reads naturally without a type or a city', () => {
    const [first, , , , , branded] = suggestQuestions({ name: 'Acme' });
    assert.equal(first.text, 'Who is the best local business?');
    assert.equal(branded.text, 'Is Acme a good local business?');
  });

  it('gives the same questions for the same details', () => {
    const details = { name: 'Acme', type: 'Electrician', city: 'Bristol' };
    assert.deepEqual(suggestQuestions(details), suggestQuestions(details));
  });

  it('keeps every question within the 200 characters a question may have', () => {
    const long = 'x'.repeat(100);
    for (const q of suggestQuestions({ name: long, type: long, city: long }))
      assert.ok(q.text.length <= 200);
  });
});
