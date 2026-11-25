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
 * @property {{ name: string }} client the business the scan is for
 * @property {string[]} [competitors] other business names to look for
 */

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
