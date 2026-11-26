import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EngineError } from '../../../src/server/services/engines/engine.js';
import { collectAnswer, FAILED_LABEL } from '../../../src/server/services/scans/collect.js';

const context = {
  client: { name: 'Acme Plumbing', domain: 'acme.test' },
  competitors: ['Rapid Flow'],
};

const engineReturning = (answer) => ({ id: 'claude', ask: async () => answer });

describe('collectAnswer', () => {
  it('reads the answer into the fields the answers table stores', async () => {
    const engine = engineReturning({
      text: 'Try Rapid Flow, then Acme Plumbing.',
      citations: [{ url: 'https://www.acme.test/boilers', title: 'Boilers' }],
    });
    const result = await collectAnswer({ engine, question: 'Who fixes boilers?', context });
    assert.deepEqual(result, {
      engine: 'claude',
      status: 'ok',
      text: 'Try Rapid Flow, then Acme Plumbing.',
      mentioned: true,
      position: 2,
      label: 'Cited',
      citations: [{ url: 'https://www.acme.test/boilers', title: 'Boilers', domain: 'acme.test' }],
      citedUrls: ['https://www.acme.test/boilers'],
      competitors: ['Rapid Flow'],
    });
  });

  it('records an engine that cannot answer as a failed answer', async () => {
    const engine = {
      id: 'chatgpt',
      ask: async () => {
        throw new EngineError('no_answer', 'No sample answer for "Who?".');
      },
    };
    assert.deepEqual(await collectAnswer({ engine, question: 'Who?', context }), {
      engine: 'chatgpt',
      status: 'failed',
      error: 'No sample answer for "Who?".',
      label: FAILED_LABEL,
    });
  });

  it('lets a programming error through instead of hiding it as a failed answer', async () => {
    const engine = {
      id: 'claude',
      ask: async () => {
        throw new TypeError('bug');
      },
    };
    await assert.rejects(collectAnswer({ engine, question: 'Who?', context }), TypeError);
  });
});
