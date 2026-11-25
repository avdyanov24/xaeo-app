/**
 * Reads an engine's answer and works out how the client appears in it. Fixed rules only, no model
 * calls, so the same answer always gives the same result.
 *
 * @typedef {object} Entity a business named in the answer text
 * @property {string} quote the text as written in the answer
 * @property {'client' | 'competitor'} classification
 * @property {number} start offset of the first character in the answer text
 * @property {number} end offset just after the last character
 *
 * @typedef {object} ExtractContext
 * @property {{ name: string, domain: string }} client the business the scan is for and its website
 * @property {string[]} [competitors] other business names to look for
 */

/** The labels the web app shows for one answer. `Cited` means named and the client's site is a source. */
export const LABELS = Object.freeze({
  cited: 'Cited',
  mentioned: 'Mentioned',
  notMentioned: 'Not mentioned',
});

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The first place `name` is written as a whole word or phrase, ignoring case. */
function findName(text, name) {
  const wordEdge = '[\\p{L}\\p{N}]';
  const pattern = new RegExp(`(?<!${wordEdge})${escapeRegex(name)}(?!${wordEdge})`, 'iu');
  const match = pattern.exec(text);
  return match ? { quote: match[0], start: match.index, end: match.index + match[0].length } : null;
}

/**
 * Finds the client and the known competitors in an answer.
 * `position` is the client's place in the order businesses are first named, starting at 1, or null
 * when the client is not named.
 * @param {string} text
 * @param {ExtractContext} context
 */
export function extractMentions(text, { client, competitors = [] }) {
  const names = [
    { name: client.name, classification: 'client' },
    ...competitors.map((name) => ({ name, classification: 'competitor' })),
  ];
  /** @type {Entity[]} */
  const entities = names
    .map(({ name, classification }) => {
      const found = findName(text, name);
      return found && { ...found, classification };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  const index = entities.findIndex((entity) => entity.classification === 'client');
  return {
    mentioned: index !== -1,
    position: index === -1 ? null : index + 1,
    competitors: entities.filter((e) => e.classification === 'competitor').map((e) => e.quote),
    entities,
  };
}

/** Host of a URL without a leading `www.`, lower-case, or null when it is not an http(s) URL. */
export function domainOf(url) {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'http:' && protocol !== 'https:') return null;
    return hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** True when `host` is the client's domain or one of its subdomains. */
const isClientHost = (host, domain) => host === domain || host.endsWith(`.${domain}`);

/**
 * Works out how the client appears in one engine answer.
 * Citations that are not usable URLs are dropped. The client counts as cited when any citation is
 * on its own domain, even if the answer text never names it; the label stays `Not mentioned` then,
 * because a link alone does not mean the engine recommended the business.
 * @param {{ text: string, citations: { url: string, title?: string }[] }} answer
 * @param {ExtractContext} context
 */
export function extractAnswer(answer, context) {
  const mentions = extractMentions(answer.text, context);
  const domain = context.client.domain.toLowerCase().replace(/^www\./, '');

  const citations = answer.citations.flatMap((citation) => {
    const host = domainOf(citation.url);
    return host ? [{ url: citation.url, title: citation.title ?? host, domain: host }] : [];
  });
  const citedUrls = citations.filter((c) => isClientHost(c.domain, domain)).map((c) => c.url);
  const cited = citedUrls.length > 0;

  const label = !mentions.mentioned ? LABELS.notMentioned : cited ? LABELS.cited : LABELS.mentioned;

  return { ...mentions, cited, citedUrls, citations, label };
}
