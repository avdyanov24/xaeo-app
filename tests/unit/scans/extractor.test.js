import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractMentions } from '../../../src/server/services/scans/extractor.js';

const context = {
  client: { name: 'Northside Plumbing' },
  competitors: ['Rapid Flow', 'CityPipe'],
};

describe('extractMentions', () => {
  it('finds the client and its position among the businesses named', () => {
    const text = 'Rapid Flow is a common first call. Northside Plumbing is another. CityPipe too.';
    const result = extractMentions(text, context);
    assert.equal(result.mentioned, true);
    assert.equal(result.position, 2);
    assert.deepEqual(result.competitors, ['Rapid Flow', 'CityPipe']);
  });

  it('gives position 1 when the client is named first', () => {
    const result = extractMentions('Northside Plumbing, then Rapid Flow.', context);
    assert.equal(result.position, 1);
  });

  it('reports no mention and no position when the client is absent', () => {
    const result = extractMentions('Rapid Flow and CityPipe are the usual choices.', context);
    assert.equal(result.mentioned, false);
    assert.equal(result.position, null);
    assert.deepEqual(result.competitors, ['Rapid Flow', 'CityPipe']);
  });

  it('returns offsets that point at the matched text', () => {
    const text = 'Try Rapid Flow first, or Northside Plumbing.';
    for (const entity of extractMentions(text, context).entities) {
      assert.equal(text.slice(entity.start, entity.end), entity.quote);
    }
  });

  it('orders entities by where they first appear and labels each one', () => {
    const { entities } = extractMentions('CityPipe, then Northside Plumbing.', context);
    assert.deepEqual(
      entities.map((e) => [e.quote, e.classification]),
      [
        ['CityPipe', 'competitor'],
        ['Northside Plumbing', 'client'],
      ],
    );
  });

  it('ignores case and keeps the quote as written', () => {
    const result = extractMentions('call northside plumbing today', context);
    assert.equal(result.mentioned, true);
    assert.equal(result.entities[0].quote, 'northside plumbing');
  });

  it('matches a possessive and punctuation around the name', () => {
    assert.equal(
      extractMentions("Northside Plumbing's team (usually) helps.", context).mentioned,
      true,
    );
    assert.equal(extractMentions('(Northside Plumbing)', context).mentioned, true);
  });

  it('does not match inside a longer word or name', () => {
    assert.equal(extractMentions('Northside Plumbingware Ltd', context).mentioned, false);
    assert.equal(extractMentions('Not Northside Plumbing', context).mentioned, true);
    assert.deepEqual(extractMentions('Rapid Flowers sells bouquets.', context).competitors, []);
  });

  it('treats regular expression characters in a name as plain text', () => {
    const result = extractMentions('Ask A.B. (Leeds) Plumbing.', {
      client: { name: 'A.B. (Leeds) Plumbing' },
    });
    assert.equal(result.mentioned, true);
    assert.equal(
      extractMentions('AxB (Leeds) Plumbing', { client: { name: 'A.B. (Leeds) Plumbing' } })
        .mentioned,
      false,
    );
  });

  it('works with no competitors and with empty text', () => {
    assert.equal(extractMentions('Northside Plumbing', { client: context.client }).position, 1);
    assert.deepEqual(extractMentions('', context), {
      mentioned: false,
      position: null,
      competitors: [],
      entities: [],
    });
  });
});
