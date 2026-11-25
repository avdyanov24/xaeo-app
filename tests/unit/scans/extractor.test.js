import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  domainOf,
  extractAnswer,
  extractMentions,
  LABELS,
} from '../../../src/server/services/scans/extractor.js';

const context = {
  client: { name: 'Northside Plumbing', domain: 'northsideplumbing.co.uk' },
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

describe('extractAnswer', () => {
  const answer = (text, urls = []) => ({ text, citations: urls.map((url) => ({ url })) });

  it('labels a named client whose site is a source as Cited', () => {
    const result = extractAnswer(
      answer('Try Northside Plumbing.', ['https://www.northsideplumbing.co.uk/drains?x=1']),
      context,
    );
    assert.equal(result.label, LABELS.cited);
    assert.equal(result.cited, true);
    assert.deepEqual(result.citedUrls, ['https://www.northsideplumbing.co.uk/drains?x=1']);
  });

  it('labels a named client without a citation as Mentioned', () => {
    const result = extractAnswer(
      answer('Try Northside Plumbing.', ['https://other.example/a']),
      context,
    );
    assert.equal(result.label, LABELS.mentioned);
    assert.equal(result.cited, false);
    assert.deepEqual(result.citedUrls, []);
  });

  it('labels an unnamed client Not mentioned, even when its site is a source', () => {
    const result = extractAnswer(
      answer('Try Rapid Flow.', ['https://northsideplumbing.co.uk/']),
      context,
    );
    assert.equal(result.label, LABELS.notMentioned);
    assert.equal(result.cited, true);
  });

  it('counts subdomains of the client domain but not look-alike hosts', () => {
    const cited = (url) => extractAnswer(answer('Northside Plumbing', [url]), context).cited;
    assert.equal(cited('https://blog.northsideplumbing.co.uk/post'), true);
    assert.equal(cited('https://notnorthsideplumbing.co.uk/'), false);
    assert.equal(cited('https://northsideplumbing.co.uk.evil.example/'), false);
  });

  it('adds the domain to each citation and falls back to it as the title', () => {
    const result = extractAnswer(
      {
        text: 'x',
        citations: [
          { url: 'https://Rapidflow.example/a', title: 'Emergency plumbing' },
          { url: 'https://citypipe.example/b' },
        ],
      },
      context,
    );
    assert.deepEqual(result.citations, [
      {
        url: 'https://Rapidflow.example/a',
        title: 'Emergency plumbing',
        domain: 'rapidflow.example',
      },
      { url: 'https://citypipe.example/b', title: 'citypipe.example', domain: 'citypipe.example' },
    ]);
  });

  it('drops citations that are not http(s) URLs', () => {
    const result = extractAnswer(
      answer('x', [
        'not a url',
        'javascript:alert(1)',
        'ftp://files.example/a',
        'https://ok.example/',
      ]),
      context,
    );
    assert.deepEqual(
      result.citations.map((c) => c.domain),
      ['ok.example'],
    );
  });

  it('keeps the mention fields alongside the citation fields', () => {
    const result = extractAnswer(answer('Rapid Flow, then Northside Plumbing.'), context);
    assert.equal(result.position, 2);
    assert.equal(result.entities.length, 2);
  });
});

describe('domainOf', () => {
  it('lower-cases the host and drops www', () => {
    assert.equal(domainOf('https://WWW.Example.COM/Path'), 'example.com');
  });

  it('returns null for anything that is not an http(s) URL', () => {
    assert.equal(domainOf('mailto:a@b.example'), null);
    assert.equal(domainOf(''), null);
  });
});
