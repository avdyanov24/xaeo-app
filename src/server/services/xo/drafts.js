import { createHash } from 'node:crypto';

/**
 * Drafts Xo prepares from what the workspace already knows about a client. A value the client record
 * does not hold (a phone number, a street address) is written as a FILL_IN_NAME placeholder for a
 * person to fill in. Xo never guesses a fact about a business.
 */

const PLACEHOLDER = /FILL_IN_[A-Z0-9_]+/g;

/** SHA-256 of the content, hex. An approval names the hash it reviewed. */
export const contentHash = (code) => createHash('sha256').update(code).digest('hex');

/** The distinct placeholders in a draft, in the order they first appear. */
export const placeholdersIn = (code) => [...new Set(code.match(PLACEHOLDER) ?? [])];

/**
 * Fills placeholders with the values a person typed. Values for names the draft does not contain
 * are ignored. In JSON the value is escaped so it can never break out of its string.
 * @param {string} code
 * @param {'html' | 'json' | 'markdown' | 'text'} lang
 * @param {Record<string, string>} values keyed by placeholder name
 */
export function fillPlaceholders(code, lang, values) {
  let result = code;
  for (const name of placeholdersIn(code)) {
    const value = values[name];
    if (typeof value !== 'string' || !value.trim()) continue;
    const text = value.trim();
    result = result.replaceAll(name, lang === 'json' ? JSON.stringify(text).slice(1, -1) : text);
  }
  return result;
}

/**
 * Why a draft cannot be approved yet, in words for the person reviewing it, or null when it can.
 * @param {{ code: string, lang: string }} draft
 * @returns {string | null}
 */
export function approveBlocker({ code, lang }) {
  const open = placeholdersIn(code).length;
  if (open)
    return `Fill in ${open === 1 ? 'the 1 placeholder' : `the ${open} placeholders`} before approving.`;
  if (lang === 'json') {
    try {
      JSON.parse(code);
    } catch (error) {
      return `This is not valid JSON: ${error.message}`;
    }
  }
  if (!isWhiteLabel(code))
    return 'Remove the Xaeo and Xo mentions: drafts ship under the agency’s name.';
  return null;
}

/** Drafts go on a client's site, so they must not carry Xaeo or Xo branding. */
export const isWhiteLabel = (code) => !/\bxaeo\b|\bxo\b/i.test(code);

/**
 * LocalBusiness structured data for the client's home page.
 * @param {{ name: string, domain: string, city: string, country: string }} client
 */
export function localBusinessJsonLd(client) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: client.name,
    url: `https://${client.domain}/`,
    telephone: 'FILL_IN_PHONE',
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'FILL_IN_STREET_ADDRESS',
      addressLocality: client.city,
      addressCountry: client.country,
    },
  };
  if (!client.city) delete data.address.addressLocality;
  return {
    kind: 'jsonld',
    title: `LocalBusiness data for ${client.name}`,
    summary:
      'Tells AI assistants who the business is, where it works and how to reach it, in a format they read directly.',
    targetUrl: `https://${client.domain}/`,
    lang: 'json',
    risk: 'low',
    code: JSON.stringify(data, null, 2),
    notes: [
      'Name, website and city come from the client record. Phone and address are left for you.',
    ],
    claims: ['Phone number', 'Street address'],
  };
}

/**
 * An llms.txt file: a short plain-text guide to the site for AI assistants.
 * @param {{ name: string, domain: string, type: string, city: string }} client
 */
export function llmsTxt(client) {
  const about = [client.type, client.city && `in ${client.city}`].filter(Boolean).join(' ');
  const code = [
    `# ${client.name}`,
    '',
    `> ${about ? `${about}. ` : ''}FILL_IN_ONE_LINE_SUMMARY`,
    '',
    '## Key pages',
    '',
    `- [Home](https://${client.domain}/): what ${client.name} does`,
    `- [Contact](https://${client.domain}/FILL_IN_CONTACT_PATH): how to reach ${client.name}`,
    '',
  ].join('\n');
  return {
    kind: 'llms_txt',
    title: `llms.txt for ${client.name}`,
    summary: 'A plain-text guide to the site that AI assistants can read before they answer.',
    targetUrl: `https://${client.domain}/llms.txt`,
    lang: 'markdown',
    risk: 'low',
    code,
    notes: ['Save it as llms.txt at the root of the site.'],
    claims: ['One-line summary', 'Contact page path'],
  };
}

/** The drafts Xo can prepare, by the name the chat uses for them. */
export const DRAFTS = Object.freeze({ jsonld: localBusinessJsonLd, llms_txt: llmsTxt });
