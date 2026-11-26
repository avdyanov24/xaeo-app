import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { composeReply, matchIntent } from '../../src/server/services/xo/replies.js';

const NORTHSIDE = {
  id: 7,
  name: 'Northside Plumbing',
  sample: true,
  questions: 5,
  latest: { mentioned: 2, ok: 10 },
  runningId: null,
};
const context = (client = NORTHSIDE, extra = {}) => ({
  client,
  competitors: ['Rapid Flow', 'CityPipe'],
  pendingApprovals: 0,
  ...extra,
});

describe('xo replies: matching', () => {
  it('matches the intents the panel suggests', () => {
    const cases = {
      'Why is Northside missing from AI answers?': 'visibility',
      'What should I fix first?': 'priorities',
      'Run a scan for this client': 'scan',
      'Who is recommended instead?': 'competitors',
      'Write JSON-LD for the home page': 'draft_jsonld',
      'Can you make an llms.txt?': 'draft_llms',
      'What is waiting for approval?': 'approvals',
      'hello there': 'greeting',
      'tell me a joke': 'help',
    };
    for (const [text, intent] of Object.entries(cases))
      assert.equal(matchIntent(text), intent, text);
  });

  it('prefers a named draft over a general fix question', () => {
    assert.equal(matchIntent('what structured data should I fix first?'), 'draft_jsonld');
  });
});

describe('xo replies: composing', () => {
  it('reads the latest scan numbers into the visibility reply', () => {
    const reply = composeReply('visibility', context());
    assert.match(reply.text, /named in 2 of 10 answers/);
    assert.match(reply.text, /other 8 do not/);
    assert.equal(reply.ui, '#/clients/7/answers');
  });

  it('offers a scan when there is no finished scan', () => {
    const reply = composeReply('visibility', context({ ...NORTHSIDE, latest: null }));
    assert.equal(reply.scanCard, true);
    assert.match(reply.text, /no finished scan/);
  });

  it('tells the Northside story for the example client and stays generic for others', () => {
    const sample = composeReply('priorities', context());
    assert.match(sample.text, /four fixes/);
    assert.match(sample.text, /6 of 10 \(estimate\)/);
    assert.equal(sample.draft, 'jsonld');
    const other = composeReply(
      'priorities',
      context({ ...NORTHSIDE, sample: false, name: 'Harbor Dental' }),
    );
    assert.doesNotMatch(other.text, /four fixes|Northside/);
    assert.match(other.text, /Harbor Dental/);
  });

  it('names the sample competitors only for the example client', () => {
    assert.match(composeReply('competitors', context()).text, /Rapid Flow and CityPipe/);
    const other = composeReply('competitors', context({ ...NORTHSIDE, sample: false }));
    assert.doesNotMatch(other.text, /Rapid Flow/);
  });

  it('does not offer a second scan while one is running', () => {
    const reply = composeReply('scan', context({ ...NORTHSIDE, runningId: 3 }));
    assert.equal(reply.scanCard, false);
    assert.match(reply.text, /already running/);
  });

  it('counts the drafts waiting for approval', () => {
    assert.match(
      composeReply('approvals', context(NORTHSIDE, { pendingApprovals: 1 })).text,
      /^1 draft is waiting/,
    );
    assert.match(
      composeReply('approvals', context(NORTHSIDE, { pendingApprovals: 3 })).text,
      /^3 drafts are waiting/,
    );
    assert.match(composeReply('approvals', context()).text, /Nothing is waiting/);
  });

  it('says so when the workspace has no client', () => {
    const reply = composeReply('scan', context(null));
    assert.equal(reply.intent, 'no_client');
    assert.match(reply.text, /no client/);
  });

  it('never names an engine other than ChatGPT and Claude', () => {
    for (const intent of [
      'greeting',
      'visibility',
      'competitors',
      'priorities',
      'draft_jsonld',
      'draft_llms',
      'scan',
      'approvals',
      'help',
    ])
      assert.doesNotMatch(
        composeReply(intent, context()).text,
        /gemini|perplexity|overview/i,
        intent,
      );
  });
});
