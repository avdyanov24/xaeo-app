// Plain text shared by the agency screens and the printable report. No current settings are substituted.
// Labels only. Xaeo asks ChatGPT and Claude; the engines offered for a scan come from the server.
const ENGINE_NAMES = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
};
const SOURCE_NAMES = {
  sample: 'Scripted sample answers',
  'live-engine': 'Live engine collection',
  unknown: 'Evidence source unknown',
};
const text = (value) =>
  typeof value === 'string' && value
    ? value
    : typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : 'Not recorded';
const strings = (value) =>
  Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v) : [];

export function scanContextText(configuration) {
  const recorded = configuration?.state === 'recorded' && configuration.snapshot;
  const snapshot = recorded ? configuration.snapshot : null;
  const rows = [
    [
      'Saved setup',
      recorded ? 'Recorded at scan start' : 'Unknown; current settings are not substituted',
    ],
  ];
  if (snapshot) {
    rows.push(
      ['Methodology', text(snapshot.methodology)],
      ['Answer extraction', text(snapshot.extractionVersion)],
      [
        'Buyer questions',
        Array.isArray(snapshot.questions)
          ? `${snapshot.questions.length} saved ${snapshot.questions.length === 1 ? 'question and intent' : 'questions and intents'}`
          : 'Not recorded',
      ],
      [
        'Client location',
        `Country: ${text(snapshot.client?.country)}; city: ${text(snapshot.client?.city)}`,
      ],
      ['Competitor extraction', text(snapshot.competitors?.mode)],
      [
        'Request limits',
        [
          ['maxInputTokens', 'Input tokens'],
          ['maxOutputTokens', 'Output tokens'],
          ['maxSearches', 'Searches'],
          ['maxRequestsPerAnswer', 'Requests per answer'],
        ]
          .map(
            ([key, label]) =>
              `${label}: ${Number.isFinite(snapshot.requestLimits?.[key]) ? snapshot.requestLimits[key] : 'Not recorded'}`,
          )
          .join('; '),
      ],
      [
        'Retry policy',
        `${text(snapshot.retryPolicy?.method)}; attempts: ${Number.isFinite(snapshot.retryPolicy?.httpAttempts) ? snapshot.retryPolicy.httpAttempts : 'Not recorded'}`,
      ],
    );
    for (const provider of Array.isArray(snapshot.providers) ? snapshot.providers : []) {
      const name = ENGINE_NAMES[provider.id] || text(provider.id);
      const location = provider.location || {};
      rows.push(
        [
          `${name} requested setup`,
          `Provider: ${text(provider.provider)}; requested model: ${text(provider.model)}; configured state: ${text(provider.state)}; web search: ${provider.webSearch === true ? 'Enabled' : provider.webSearch === false ? 'Disabled' : 'Not recorded'}`,
        ],
        [
          `${name} collection settings`,
          `Adapter: ${text(provider.adapterVersion)}; prompt: ${text(provider.prompt)}; country: ${text(location.country)}; city: ${text(location.city)}; language: ${location.language ? text(location.language) : 'Not pinned'}${location.languagePolicy ? ` (${text(location.languagePolicy)})` : ''}${location.device ? `; device: ${text(location.device)}` : ''}`,
        ],
      );
    }
  }
  for (const observed of Array.isArray(configuration?.observed) ? configuration.observed : []) {
    const name = ENGINE_NAMES[observed.engine] || text(observed.engine);
    const models = strings(observed.models).join(', ') || 'Unknown';
    const providerReported =
      observed.modelIdentity === 'provider-reported' && observed.reportedModelKnown;
    const identity =
      observed.modelIdentity === 'simulator' ? 'Not applicable (simulated)' : 'Unknown';
    rows.push([
      `${name} recorded evidence`,
      `${providerReported ? `Provider-reported model: ${models}` : `Stored model label: ${models}; actual provider model: ${identity}`}${strings(observed.productIdentifiers).length ? `; product label: ${strings(observed.productIdentifiers).join(', ')}` : ''}; collection method: ${strings(observed.methods).join('; ') || 'Unknown'}${observed.modelIdentity ? `; identity basis: ${text(observed.modelIdentity)}` : '; model identity basis was not recorded'}${observed.reportedModelKnown ? '' : '; model or method is unknown for one or more answers'}`,
    ]);
  }
  const limitations = strings(configuration?.limitations);
  if (!recorded && !limitations.length)
    limitations.push(
      'This historical result has no saved configuration. Its original setup cannot be reconstructed from today’s settings.',
    );
  return {
    evidenceLabel: SOURCE_NAMES[configuration?.source] || SOURCE_NAMES.unknown,
    rows,
    limitations,
  };
}

export function comparisonReasons(comparison) {
  return (Array.isArray(comparison?.reasons) ? comparison.reasons : [])
    .map((reason) => reason?.message)
    .filter((message) => typeof message === 'string' && message);
}
