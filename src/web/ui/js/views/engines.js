// Engines: the AI engines Xaeo asks, and where this workspace's answers come from right now.
// GET /api/app/engines returns { mode: 'sample' | 'live', engines: [{ id, name, provider, state, model? }] }.
import { api, h, clear, icon, plural } from '../lib.js';

const STATE = {
  live: ['Connected', 'pill-mentioned'],
  sample: ['Sample engine', 'pill-running'],
  paused: ['Paused', 'pill-off'],
  off: ['Turned off', 'pill-off'],
};

const NOTES = {
  claude: 'Asked with Anthropic’s Claude. Answers can differ from the Claude app.',
  chatgpt: 'Asked with OpenAI’s ChatGPT. Answers can differ from the ChatGPT app.',
};

const detail = (e) =>
  e.state === 'sample'
    ? 'Answers come from a scripted sample set, so the numbers stay the same on every scan.'
    : e.state === 'paused'
      ? 'Paused for now. The other engine keeps running.'
      : e.model
        ? `Model: ${e.model}.`
        : 'Location and language follow each client’s settings.';

export async function renderEngines(view) {
  const s = await api('/api/app/engines');
  const live = s.engines.filter((e) => e.state === 'live');

  clear(
    view,
    h(
      'div.page-head',
      h(
        'div',
        h('h1', 'Engines'),
        h(
          'p.lead',
          s.mode === 'sample'
            ? 'Sample data. Scans read scripted answers for ChatGPT and Claude, so no engine is called.'
            : `${plural(live.length, 'engine')} connected. Scans ask ${live.length ? live.map((e) => e.name).join(', ') : 'no engine'}.`,
        ),
      ),
    ),
    h(
      'ul.engine-list',
      s.engines.map((e) => {
        const [label, tone] = STATE[e.state] || STATE.off;
        return h(
          'li.card.engine-row',
          { dataset: { engine: e.id, state: e.state } },
          h(
            'div.engine-row-head',
            h('span.engine-dot', { 'aria-hidden': 'true' }),
            h('h2', e.name),
            h(`span.pill.${tone}`, e.state === 'live' ? icon('check', 12) : null, label),
            h('span.muted.small', e.provider),
          ),
          h('p', detail(e)),
          h('p.muted.small', NOTES[e.id] || ''),
        );
      }),
    ),
  );
}
