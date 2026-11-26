/**
 * Xo's scripted reply set. A message is matched to an intent by simple keyword rules, and each
 * intent has a fixed reply that is filled in from the workspace's own numbers. No model is called;
 * the numbers in a reply come from the database, so they are always grounded.
 *
 * @typedef {object} ReplyContext
 * @property {{ id: number, name: string, sample: boolean, questions: number, latest: { mentioned: number, ok: number } | null, runningId: number | null } | null} client
 *   the client the person is looking at, or null when the workspace has none
 * @property {string[]} competitors who the sample answers recommend instead (sample client only)
 * @property {number} pendingApprovals drafts waiting for a decision in the workspace
 *
 * @typedef {object} Reply
 * @property {string} intent
 * @property {string} text what Xo says; blank lines separate paragraphs
 * @property {string[]} steps labels of the checks Xo shows as it works
 * @property {'jsonld' | 'llms_txt' | null} draft a draft to prepare and show as a card
 * @property {boolean} scanCard whether to show a "Run scan" card
 * @property {string | null} ui a `#/...` route to open
 */

/** Rules are tried in order; the first match wins. Messages are matched in lower case. */
const RULES = [
  ['draft_jsonld', /\b(json-?ld|schema|structured data|markup)\b/],
  ['draft_llms', /\bllms(\.txt)?\b/],
  ['approvals', /\b(approval|approvals|approve|pending|waiting for)\b/],
  ['scan', /\b(scan|rescan|re-scan|run again|check again|refresh)\b/],
  ['competitors', /\b(competitor|competitors|instead|rapid flow|citypipe|who is|who's|who are)\b/],
  [
    'priorities',
    /\b(fix|fixes|first|priority|priorities|prioriti[sz]e|improve|next step|what should)\b/,
  ],
  [
    'visibility',
    /\b(missing|visible|visibility|mention|mentioned|recommend|recommended|appear|rank|why)\b/,
  ],
  ['greeting', /^\s*(hi|hello|hey|hiya)\b/],
];

/** @returns {string} the intent for a message, or `help` when nothing matches */
export function matchIntent(text) {
  const message = String(text).toLowerCase();
  return RULES.find(([, pattern]) => pattern.test(message))?.[0] ?? 'help';
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const answersLine = (client) =>
  `${client.name} is named in ${client.latest.mentioned} of ${plural(client.latest.ok, 'answer')} from its latest scan.`;
const NO_CLIENT =
  'There is no client in this workspace yet. Add one on the Clients page and I can look at how it appears in ChatGPT and Claude answers.';
const noScan = (client) =>
  `${client.name} has no finished scan yet, so there is nothing to read. A scan asks each of its buyer questions of ChatGPT and Claude and records who gets named.`;

const reply = (intent, text, extra = {}) => ({
  intent,
  text,
  steps: [],
  draft: null,
  scanCard: false,
  ui: null,
  ...extra,
});

/**
 * Builds the reply for a matched intent.
 * @param {string} intent
 * @param {ReplyContext} context
 * @returns {Reply}
 */
export function composeReply(intent, { client, competitors, pendingApprovals }) {
  const needsClient = [
    'draft_jsonld',
    'draft_llms',
    'scan',
    'competitors',
    'priorities',
    'visibility',
  ];
  if (needsClient.includes(intent) && !client) return reply('no_client', NO_CLIENT);

  switch (intent) {
    case 'greeting':
      return reply(
        'greeting',
        'Hello. I can tell you why a client is missing from AI answers, what to fix first, and prepare drafts such as structured data or an llms.txt file. Nothing ships until you approve it.',
      );

    case 'visibility': {
      if (!client.latest) return reply('visibility', noScan(client), { scanCard: true });
      const missing = client.latest.ok - client.latest.mentioned;
      return reply(
        'visibility',
        [
          answersLine(client),
          missing
            ? `The other ${missing} do not name it, which is why it looks missing: an assistant only recommends a business it can find clear facts about.`
            : 'Every answer names it, so the work now is keeping it that way.',
          'The Answers tab shows each answer with who was named instead.',
        ].join('\n\n'),
        { steps: ['Read the latest scan'], ui: `#/clients/${client.id}/answers` },
      );
    }

    case 'competitors': {
      if (!client.sample || !competitors.length)
        return reply(
          'competitors',
          `The Answers tab lists who each answer names for ${client.name}, engine by engine. I only summarise competitors for the example client.`,
          { ui: `#/clients/${client.id}/answers` },
        );
      return reply(
        'competitors',
        `${competitors.join(' and ')} are the businesses the sample answers recommend where ${client.name} is missing. The Answers tab shows which question and which engine named each one.`,
        { steps: ['Compare who is named'], ui: `#/clients/${client.id}/answers` },
      );
    }

    case 'priorities': {
      if (client.sample)
        return reply(
          'priorities',
          [
            `${client.name} has four fixes. The first is already shipped, and each of the others should win about one more answer.`,
            'Finishing all four could lift it from 2 of 10 answers to 6 of 10 (estimate). I have prepared structured data below, because assistants read it before they read anything else on the page.',
          ].join('\n\n'),
          { steps: ['Check the open fixes'], draft: 'jsonld' },
        );
      return reply(
        'priorities',
        `Start with the facts an assistant cannot find on ${client.name}'s site today. I have prepared structured data below with what the client record already holds; the rest is left for you to fill in.`,
        { steps: ['Check the client record'], draft: 'jsonld' },
      );
    }

    case 'draft_jsonld':
      return reply(
        'draft_jsonld',
        `Here is LocalBusiness structured data for ${client.name}. I filled in what the client record holds and left the phone number and address as values for you to fill in. I never guess a fact about a business.`,
        { steps: ['Read the client record', 'Draft the structured data'], draft: 'jsonld' },
      );

    case 'draft_llms':
      return reply(
        'draft_llms',
        `Here is an llms.txt for ${client.name}: a short guide to the site that assistants can read first. Two values are left for you to fill in before it can be approved.`,
        { steps: ['Read the client record', 'Draft the llms.txt'], draft: 'llms_txt' },
      );

    case 'scan':
      if (client.runningId)
        return reply(
          'scan',
          `A scan is already running for ${client.name}. It finishes in a few seconds, and the overview updates when it does.`,
          { ui: `#/clients/${client.id}/overview` },
        );
      return reply(
        'scan',
        `A scan asks ${plural(client.questions, 'buyer question')} of ChatGPT and Claude and records who gets named. Start it below when you are ready.`,
        { scanCard: true },
      );

    case 'approvals':
      return reply(
        'approvals',
        pendingApprovals
          ? `${plural(pendingApprovals, 'draft')} ${pendingApprovals === 1 ? 'is' : 'are'} waiting for a decision. Open Approvals to review each one; nothing ships until it is approved.`
          : 'Nothing is waiting for approval. Ask me for a draft and it will appear here for review.',
        { steps: ['Check the approval queue'], ui: '#/approvals' },
      );

    default:
      return reply(
        'help',
        [
          'I can help with:',
          '- why a client is missing from AI answers',
          '- who is named instead',
          '- what to fix first',
          '- drafts: structured data (JSON-LD) or an llms.txt file',
          '- starting a scan, and what is waiting for approval',
        ].join('\n'),
      );
  }
}
