// Home: every client with its one next action, then the agency at a glance (stats and a weekly chart) (PLAN §P2 flow B).
import {
  api,
  h,
  clear,
  icon,
  xo,
  date,
  dayDate,
  zonedParts,
  plural,
  emptyState,
  button,
  link,
  busy,
  errorToast,
  toast,
  meter,
  countUp,
  scanStarted,
  reducedMotion,
  desk,
} from '../lib.js';
import { state, go, refreshMe, shareRoute } from '../main.js';
import { startTour } from '../tour.js';
import { statTile, barList, weeklyChart, pct, hint, deltaText, DELTA_HEDGE } from '../charts.js';

const prefs = { q: '', sort: 'attention', setupOpen: false };
const stored = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const store = (k, v) => {
  try {
    v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
};
// Name the clicked card's tile and name for the view transition. Only when the browser supports it and motion is
// welcome; otherwise the normal rise plays. Plain clicks only (new-tab clicks keep the default).
function shareToClient(e, id) {
  const cardEl = e.currentTarget.closest('.client-card, .client-row');
  if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  // C2: the press is acknowledged at once (pressed card, transform + border only) while the client loads.
  document
    .querySelectorAll('.client-card.pending, .client-row.pending')
    .forEach((n) => n.classList.remove('pending'));
  cardEl?.classList.add('pending');
  if (!cardEl || typeof document.startViewTransition !== 'function' || reducedMotion()) return;
  // Names must be unique: clear any left from an earlier click.
  document
    .querySelectorAll(':is(.client-card, .client-row) :is(.client-avatar, .client-name)')
    .forEach((n) => {
      n.style.viewTransitionName = '';
    });
  const tile = cardEl.querySelector('.client-avatar'),
    name = cardEl.querySelector('.client-name');
  if (tile) tile.style.viewTransitionName = 'client-tile';
  if (name) name.style.viewTransitionName = 'client-title';
  shareRoute(id);
}

export async function renderClients(view, { archived = false, quiet = false } = {}) {
  const [{ clients, archivedCount }, stats] = await Promise.all([
    api(`/api/app/clients${archived ? '?archived=1' : ''}`),
    archived ? null : api('/api/app/stats'),
  ]);
  const me = await refreshMe();
  let timer = null;

  // An empty workspace may still have an archived sample: the button brings that one back instead of opening an archived page.
  const archivedSample =
    !archived && !clients.length && archivedCount
      ? (await api('/api/app/clients?archived=1').catch(() => ({ clients: [] }))).clients.find(
          (c) => c.sample,
        )
      : null;
  const onSample = (e) =>
    busy(e.currentTarget, async () => {
      try {
        // U10: main.js refreshes the sidebar on xaeo:clients, so the sample is listed the moment it exists.
        if (archivedSample) {
          await api(`/api/app/clients/${archivedSample.id}/unarchive`, { method: 'POST' });
          dispatchEvent(new CustomEvent('xaeo:clients'));
          toast('Sample client restored');
          return go(`#/clients/${archivedSample.id}/overview`);
        }
        const { id } = await api('/api/app/sample', { method: 'POST' });
        dispatchEvent(new CustomEvent('xaeo:clients'));
        toast('Sample client added');
        go(`#/clients/${id}/overview`);
      } catch (err) {
        errorToast(err);
      }
    });
  // Production never has a sample client (the server refuses it), so the app does not offer one there.
  const sampleOk = me?.sampleAvailable !== false;
  const addSample = button(archivedSample ? 'Restore the sample client' : 'Add the sample client', {
    variant: 'secondary',
    onclick: onSample,
  });

  const head = h(
    'div.page-head',
    h(
      'div',
      archived ? h('a.crumb', { href: '#/' }, icon('chevronLeft', 16), 'Clients') : null,
      h('h1', archived ? 'Archived clients' : 'Clients'),
      // A+ desktop: a data line instead of the narrating subtitle.
      desk.matches && !archived
        ? h(
            'p.page-meta',
            plural(clients.length, 'client'),
            stats?.nextRescan
              ? ` · next rescan ${zonedParts(stats.nextRescan, state.me?.workspace?.timezone).day}`
              : '',
          )
        : h(
            'p.lead',
            archived
              ? 'History stays readable. Unarchive a client to scan it again.'
              : 'Who AI engines recommend for each client, and what to fix next.',
          ),
    ),
    archived || !clients.length
      ? null
      : link('Add a client', '#/new', { dataset: { tour: 'add-client' } }, 'plus'),
  );

  const o = me.onboarding;
  // Client steps count active clients only: with every client archived, questions and reports read as not done
  // too (the chip said "2 of 4 done" with zero clients). Branding is workspace-wide and keeps its state.
  const active = clients.length > 0;
  const steps = [
    {
      done: o.client && active,
      title: 'Add a client',
      text: 'Their website, business type and city.',
      href: '#/new',
      cta: 'Add a client',
    },
    {
      done: o.questions && active,
      title: 'Pick buyer questions',
      text: 'The questions their customers ask AI.',
      href: clients[0] ? `#/clients/${clients[0].id}/questions` : '#/new',
      cta: 'Pick questions',
    },
    ...(me.user.workspaceRole === 'owner'
      ? [
          {
            done: o.brand,
            title: 'Brand your reports',
            text: 'Your logo and colors on every report.',
            href: '#/settings/workspace',
            cta: 'Add your brand',
          },
        ]
      : []),
    {
      done: o.report && active,
      title: 'Export your first report',
      text: 'White-label, ready to send.',
      href: clients[0] ? `#/clients/${clients[0].id}/reports` : '#/new',
      cta: 'Export a report',
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const hidden = stored('xaeo-setup-hidden') === '1';
  // Setup guide: one quiet row (progress, step chips, meter) that expands to the 4 step cards. Its mini Xo
  // rests when the workspace is empty, because the empty state below already has one (one Xo per viewport).
  const stepList = () =>
    h(
      'ol.steps#ob-steps',
      steps.map((s, i) =>
        h(
          `li.step${s.done ? '.done' : ''}`,
          h('span.step-mark', s.done ? icon('check', 16) : String(i + 1)),
          h('div', h('strong', s.title), h('span.muted', s.text)),
          s.done
            ? h('span.step-done', 'Done')
            : h('a.step-link', { href: s.href }, s.cta, icon('chevronRight', 16)),
        ),
      ),
    );
  const toggle = button(
    prefs.setupOpen ? 'Hide steps' : 'Show steps',
    {
      variant: 'ghost',
      size: 'sm',
      class: 'onboarding-toggle',
      'aria-expanded': String(!!prefs.setupOpen),
      'aria-controls': 'ob-steps',
      onclick: () => {
        prefs.setupOpen = !prefs.setupOpen;
        renderClients(view, { archived, quiet: true });
      },
    },
    'chevronDown',
  );
  // U9/U22: the mini Xo has his own slot at the start of the setup row (inside the chip row he wrapped it). When a
  // step was completed since the last visit he hops in place, the finished chip pops green and the meter glides.
  // At 4 of 4, Xo cheers once and the strip becomes a one-line "Setup complete" (shown once).
  // Steps can finish in any order, so the last seen state is a mask ("1010"), not a count.
  const mask = steps.map((s) => (s.done ? '1' : '0')).join(''),
    seenMask = stored('xaeo-ob-seen');
  const comparableMask = seenMask && seenMask.length === mask.length;
  const justFinished = steps.map((s, i) => !!(comparableMask && s.done && seenMask[i] === '0'));
  const advanced = !quiet && !archived && justFinished.some(Boolean);
  const seen = comparableMask ? [...seenMask].filter((c) => c === '1').length : doneCount;
  if (!archived && seenMask !== mask) store('xaeo-ob-seen', mask);
  const nextIdx = steps.findIndex((s) => !s.done);
  const obXo =
    clients.length && doneCount < steps.length
      ? xo(advanced ? 'hop' : 'waving', 'onboarding-xo')
      : null;
  const completeLine =
    !archived && !hidden && advanced && doneCount === steps.length
      ? h(
          'section.card.onboarding.ob-complete',
          { 'aria-labelledby': 'ob-title' },
          h(
            'div.onboarding-row',
            xo('cheer', 'onboarding-xo'),
            h(
              'div.ob-summary',
              h('h2#ob-title', 'Setup complete'),
              h(
                'p.muted.small',
                `${steps.length} of ${steps.length} done. Your first report is exported.`,
              ),
            ),
          ),
        )
      : null;
  const onboarding =
    completeLine ||
    (!archived && doneCount < steps.length && !hidden
      ? h(
          'section.card.onboarding',
          {
            class: [quiet ? 'quiet' : '', prefs.setupOpen ? 'open' : '', advanced ? 'advanced' : '']
              .join(' ')
              .trim(),
            dataset: { tour: 'onboarding' },
            'aria-labelledby': 'ob-title',
          },
          h(
            'div.onboarding-row',
            obXo ? h('div.ob-xo-slot', { 'aria-hidden': 'true' }, obXo) : null,
            h(
              'div.ob-summary',
              h('h2#ob-title', 'Get to your first report'),
              h('p.muted.small', `${doneCount} of ${steps.length} done`),
              meter(doneCount / steps.length, 'ob-meter', advanced ? seen / steps.length : null),
            ),
            // The first open step is marked "Next" so it no longer looks like a done chip (P2-10). Xo's li is decoration.
            h(
              'ul.ob-chips',
              { 'aria-label': 'Setup steps' },
              steps.map((s, i) =>
                h(
                  'li',
                  s.done
                    ? h(
                        'span.ob-chip.done',
                        { class: justFinished[i] ? 'just-done' : '' },
                        icon('check', 14),
                        s.title,
                      )
                    : i === nextIdx
                      ? h(
                          'a.ob-chip.next',
                          { href: s.href, 'aria-label': `Next: ${s.title}` },
                          h('span.ob-next', 'Next'),
                          s.title,
                        )
                      : h('a.ob-chip', { href: s.href }, s.title),
                ),
              ),
            ),
            // R3 removal: one control at rest ("Show steps"); hiding the checklist for good lives inside the open panel.
            h('div.ob-actions', toggle),
          ),
          prefs.setupOpen
            ? h(
                'div.ob-panel',
                stepList(),
                h(
                  'p.muted.small',
                  'New here? ',
                  h(
                    'button.linkish',
                    { type: 'button', onclick: () => startTour() },
                    'Take a short tour with Xo',
                  ),
                  ' · ',
                  h(
                    'button.linkish',
                    {
                      type: 'button',
                      onclick: () => {
                        store('xaeo-setup-hidden', '1');
                        renderClients(view, { archived, quiet: true });
                      },
                    },
                    'Hide this checklist',
                  ),
                ),
              )
            : null,
        )
      : null);

  // The agency at a glance. Only once something has been scanned, so a new workspace isn't a wall of zeros.
  // U07: the server totals include the sample client, and its cited answers, per-engine counts and weekly points
  // can't be taken back out here from the client list. So while an active sample client has a scan, the block stays
  // hidden rather than showing sample numbers as the agency's own. A server response that already leaves the
  // sample out (stats.sampleExcluded) shows the block again with a one-line note.
  const sampleScanned = clients.some((c) => c.sample && c.status !== 'archived' && c.latest);
  const statsBlock = () => {
    if (!stats || !stats.scanned) return null;
    if (sampleScanned && stats.sampleExcluded !== true) return null;
    const t = stats.totals,
      prev = stats.previous;
    const rate = pct(t.mentioned, t.ok),
      prevRate = prev ? pct(prev.mentioned, prev.ok) : null;
    const diff = prevRate == null ? null : rate - prevRate;
    const shipped = t.doneFixes,
      open = t.openFixes;
    const n = (v) => (quiet ? { value: String(v) } : { count: v });
    const bestEngine = [...stats.byEngine]
      .filter((e) => e.ok)
      .sort((a, b) => b.mentioned / b.ok - a.mentioned / a.ok)[0];
    return h(
      'section.stats-block',
      { class: quiet ? 'quiet' : '', dataset: { tour: 'stats' }, 'aria-labelledby': 'stats-title' },
      h(
        'div.section-head',
        h(
          'div',
          h('h2#stats-title', 'Across all clients'),
          stats.sampleExcluded === true && clients.some((c) => c.sample)
            ? h('p.muted.small', 'Sample client not included')
            : null,
        ),
      ),
      h(
        'div.stat-tiles',
        statTile({
          i: 0,
          label: 'Answers naming clients',
          help: `The share of successful answers that name one of your clients, across all active clients. Available engines depend on your workspace settings. ${DELTA_HEDGE}`,
          ...n(rate),
          suffix: '%',
          sub: h(
            'span',
            `${t.mentioned} of ${t.ok} answers`,
            diff != null
              ? h(
                  `span.delta-pill.small${diff > 0 ? '.up' : ''}`,
                  icon(diff > 0 ? 'trending' : diff < 0 ? 'trendingDown' : 'minus', 13),
                  diff > 0
                    ? `+${diff} pts since last scan`
                    : diff < 0
                      ? `−${Math.abs(diff)} pts since last scan`
                      : 'No change since last scan',
                )
              : null,
          ),
        }),
        statTile({
          i: 1,
          label: 'Named + linked',
          help: 'Answers that name a client and link to its own website as a source. Stronger than Named alone: the engine is using your client’s page.',
          ...n(t.cited),
          sub: `answers link to a client’s site`,
        }),
        statTile({
          i: 2,
          label: 'Open fixes',
          help: 'Proposals for your clients’ sites and listings, prioritized by the missed answers they relate to. Review each before implementation.',
          ...n(open),
          sub: shipped ? `${shipped} marked done so far` : 'Ranked by current evidence',
        }),
        statTile({
          i: 3,
          label: 'Next rescan',
          tone: 'text',
          help: `Clients with weekly rescans enabled are scheduled each Monday at 09:00 ${(state.me.workspace?.timezone || 'UTC').replace(/_/g, ' ')}. Compare returned answers to review changes.`,
          value: stats.nextRescan
            ? zonedParts(stats.nextRescan, state.me.workspace?.timezone).day
            : stats.rescansPaused
              ? 'Paused'
              : 'Off',
          sub: stats.nextRescan
            ? `${stats.nextRescanCount} client${stats.nextRescanCount === 1 ? '' : 's'} at ${zonedParts(stats.nextRescan, state.me.workspace?.timezone).time}`
            : stats.rescansPaused
              ? 'Weekly rescans are paused for now'
              : 'Turn on weekly rescans in a client’s settings',
        }),
      ),
      h(
        'div.grid-2.grid-wide',
        h(
          'section.card',
          h(
            'div.card-head',
            h('h2', 'Named answers week by week'),
            hint(
              'Each point is the share of answers naming your clients that week, using each client’s latest scan. Bars show fixes marked done that week.',
            ),
          ),
          h(
            'div.chart-legend',
            h('span.lg-line', 'Answers that name your clients'),
            h('span.lg-bar', 'Fixes marked done'),
          ),
          weeklyChart(stats.weeks),
          h(
            'p.muted.small',
            stats.weeklyAggregation?.description ||
              'Descriptive weekly totals may use different clients, questions, providers and answer coverage. They are not a controlled comparison or proof of fix effects.',
          ),
        ),
        h(
          'section.card',
          h(
            'div.card-head',
            h('h2', 'By engine'),
            hint(
              'How often each AI engine names your clients in its answers, across all active clients.',
            ),
          ),
          h(
            'p.muted.small',
            bestEngine && bestEngine.mentioned
              ? `Your clients do best on ${bestEngine.name}.`
              : 'No engine names your clients yet. The fixes show what to change.',
          ),
          barList(
            stats.byEngine.map((e) => ({ name: e.name, value: e.mentioned, total: e.ok })),
            { own: true, format: (r) => (r.total ? `${pct(r.value, r.total)}%` : '-') },
          ),
        ),
      ),
    );
  };

  // Search and sort once the list is long enough to need them.
  const sorters = {
    attention: (a, b) => (b.fixes.todo > 0) - (a.fixes.todo > 0),
    name: (a, b) => a.name.localeCompare(b.name),
    mentions: (a, b) =>
      (b.latest ? b.latest.mentioned / Math.max(b.latest.ok, 1) : -1) -
      (a.latest ? a.latest.mentioned / Math.max(a.latest.ok, 1) : -1),
    fixes: (a, b) => b.fixes.todo - a.fixes.todo,
  };
  const shown = () => {
    const q = prefs.q.trim().toLowerCase();
    const list = clients.filter(
      (c) => !q || `${c.name} ${c.domain} ${c.city}`.toLowerCase().includes(q),
    );
    return sorters[prefs.sort] ? [...list].sort(sorters[prefs.sort]) : list;
  };
  const toolbar =
    clients.length >= 4
      ? h(
          'div.list-tools',
          h(
            'label.search-field',
            icon('search', 16),
            h('input', {
              type: 'search',
              placeholder: 'Find a client',
              value: prefs.q,
              'aria-label': 'Find a client',
              oninput: (e) => {
                prefs.q = e.target.value;
                drawGrid();
              },
            }),
          ),
          h(
            'label.inline-field',
            h('span', 'Sort'),
            h(
              'select',
              {
                onchange: (e) => {
                  prefs.sort = e.target.value;
                  drawGrid();
                },
              },
              [
                ['attention', 'Needs attention first'],
                ['mentions', 'Most mentioned'],
                ['fixes', 'Most open fixes'],
                ['name', 'Name'],
              ].map(([v, l]) => h('option', { value: v, selected: prefs.sort === v }, l)),
            ),
          ),
        )
      : null;

  // Tiny trend line of the last scans. Needs 3+ scans; fewer points read as a broken line.
  const spark = (hist) => {
    if (hist.length < 3) return null;
    const W = 96,
      H = 32,
      max = Math.max(...hist.map((x) => x.ok), 1);
    const pts = hist.map((x, i) => [
      (i * W) / (hist.length - 1),
      H - 3 - (x.mentioned / max) * (H - 6),
    ]);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `-4 -4 ${W + 8} ${H + 8}`);
    svg.setAttribute('class', 'spark');
    svg.setAttribute('aria-hidden', 'true');
    const line = document.createElementNS(svg.namespaceURI, 'polyline');
    line.setAttribute('points', pts.map((p) => p.join(',')).join(' '));
    const dot = document.createElementNS(svg.namespaceURI, 'circle');
    dot.setAttribute('cx', pts.at(-1)[0]);
    dot.setAttribute('cy', pts.at(-1)[1]);
    dot.setAttribute('r', 3.5);
    svg.append(line, dot);
    return svg;
  };

  const card = (c, i) => {
    const action = c.nextAction;
    const actionBtn = action.run
      ? button(
          action.label,
          {
            size: 'sm',
            variant: 'secondary',
            onclick: (e) => {
              e.preventDefault();
              busy(e.currentTarget, async () => {
                try {
                  await api(`/api/app/clients/${c.id}/scans`, { method: 'POST' });
                  scanStarted(c.id);
                  go(`#/clients/${c.id}/overview`);
                } catch (err) {
                  errorToast(err);
                }
              });
            },
          },
          'play',
        )
      : link(
          action.label,
          `#/clients/${c.id}/${action.tab}`,
          { size: 'sm', variant: 'secondary' },
          action.tab === 'fixes' ? 'zap' : action.tab === 'reports' ? 'download' : null,
        );
    const delta =
      c.delta === null
        ? null
        : h(
            `span.delta-pill.small${c.delta > 0 ? '.up' : c.delta < 0 ? '.down' : ''}`,
            icon(c.delta > 0 ? 'trending' : c.delta < 0 ? 'trendingDown' : 'minus', 13),
            deltaText(c.delta),
          );
    return h(
      'article.client-card',
      { dataset: i === 0 ? { tour: 'client-card' } : {}, style: { '--i': String(i) } },
      // U6: the letter tile and the name travel to the client page header (main.js runs the view transition).
      h('a.client-card-link', {
        href: `#/clients/${c.id}/overview`,
        'aria-label': `Open ${c.name}`,
        onclick: (e) => shareToClient(e, c.id),
      }),
      h(
        'div.client-card-top',
        h('span.client-avatar', { 'aria-hidden': 'true' }, c.name.trim()[0]?.toUpperCase() || '?'),
        h(
          'div.client-id',
          h('h2', h('span.client-name', c.name), c.sample ? h('span.tag', 'Sample') : null),
          h('p.muted.small', [c.domain, c.city].filter(Boolean).join(' · ')),
        ),
        c.runningId ? h('span.pill.pill-running', h('span.dot'), 'Scanning') : null,
      ),
      c.latest
        ? h(
            'div.client-score',
            h(
              'div.big',
              quiet
                ? h('span.big-n', String(c.latest.mentioned))
                : countUp(h('span.big-n'), c.latest.mentioned),
              h('span', ` of ${c.latest.ok}`),
            ),
            h('div.client-score-side', h('div.muted.small', 'answers name them'), delta),
            spark(c.history || []) || h('span'),
            meter(c.latest.mentioned / Math.max(c.latest.ok, 1)),
          )
        : h(
            'div.client-score.none',
            icon(c.questions ? 'play' : 'message', 18),
            h(
              'p.muted',
              c.questions
                ? `${plural(c.questions, 'question')} ready. No scan yet.`
                : 'No buyer questions yet.',
            ),
          ),
      h(
        'dl.client-stats',
        h('div', h('dt', 'Open fixes'), h('dd', String(c.fixes.todo))),
        h('div', h('dt', 'Last scan'), h('dd', c.latest ? date(c.latest.finishedAt) : '-')),
        h(
          'div',
          h('dt', 'Next rescan'),
          h(
            'dd',
            c.nextRunAt ? dayDate(c.nextRunAt) : c.status === 'archived' ? 'Archived' : 'Off',
          ),
        ),
      ),
      h('div.client-card-foot', actionBtn, h('span.client-open', 'Open', icon('chevronRight', 16))),
    );
  };
  const addCard = h(
    'a.client-card.add-card',
    { href: '#/new', style: { '--i': String(clients.length) } },
    h('span.add-plus', icon('plus', 26)),
    h('strong', 'Add a client'),
    h('span.muted.small', 'We suggest the buyer questions to start with.'),
  );

  // A+ desktop: one portfolio table (a row per client, the whole row opens it) with an inline add row.
  const row = (c, i) => {
    const action = c.nextAction;
    const actionBtn = action.run
      ? button(
          action.label,
          {
            size: 'sm',
            variant: 'secondary',
            onclick: (e) => {
              e.preventDefault();
              busy(e.currentTarget, async () => {
                try {
                  await api(`/api/app/clients/${c.id}/scans`, { method: 'POST' });
                  scanStarted(c.id);
                  go(`#/clients/${c.id}/overview`);
                } catch (err) {
                  errorToast(err);
                }
              });
            },
          },
          'play',
        )
      : link(action.label, `#/clients/${c.id}/${action.tab}`, { size: 'sm', variant: 'secondary' });
    return h(
      'tr.client-row',
      { dataset: i === 0 ? { tour: 'client-card' } : {}, style: { '--i': String(i) } },
      h(
        'th',
        { scope: 'row' },
        h(
          'div.cr-id',
          h(
            'span.client-avatar',
            { 'aria-hidden': 'true' },
            c.name.trim()[0]?.toUpperCase() || '?',
          ),
          h(
            'div',
            h(
              'a.client-row-link',
              { href: `#/clients/${c.id}/overview`, onclick: (e) => shareToClient(e, c.id) },
              h('span.client-name', c.name),
            ),
            c.sample ? h('span.tag', 'Sample') : null,
            h('span.cr-sub', [c.domain, c.city].filter(Boolean).join(' · ')),
          ),
        ),
      ),
      h(
        'td',
        c.runningId
          ? h('span.pill.pill-running', h('span.dot'), 'Scanning')
          : c.latest
            ? h(
                'span.cr-score',
                h('strong', String(c.latest.mentioned)),
                ` of ${c.latest.ok}`,
                meter(c.latest.mentioned / Math.max(c.latest.ok, 1), 'cr-meter'),
              )
            : h('span.muted', c.questions ? 'No scan yet' : 'No questions yet'),
      ),
      h(
        'td',
        c.delta == null
          ? h('span.muted', '-')
          : h(
              `span.cr-delta${c.delta > 0 ? '.up' : c.delta < 0 ? '.down' : ''}`,
              icon(c.delta > 0 ? 'trending' : c.delta < 0 ? 'trendingDown' : 'minus', 14),
              c.delta > 0 ? `+${c.delta}` : c.delta < 0 ? `−${Math.abs(c.delta)}` : 'No change',
              h('span.visually-hidden', ' since last scan'),
            ),
      ),
      h('td.num', String(c.fixes.todo)),
      h('td', c.latest ? date(c.latest.finishedAt) : '-'),
      h('td', c.nextRunAt ? dayDate(c.nextRunAt) : c.status === 'archived' ? 'Archived' : 'Off'),
      h('td.cr-action', actionBtn),
    );
  };
  const table = h(
    'div.client-table-wrap',
    h(
      'table.client-table',
      h(
        'thead',
        h(
          'tr',
          [
            'Client',
            'Answers that name them',
            'Since last scan',
            'Open fixes',
            'Last scan',
            'Next rescan',
          ].map((t, i) => h(i === 3 ? 'th.num' : 'th', { scope: 'col' }, t)),
          h('th', { scope: 'col' }, h('span.visually-hidden', 'Next action')),
        ),
      ),
      h('tbody'),
    ),
    archived
      ? null
      : h(
          'a.client-add-row',
          { href: '#/new' },
          icon('plus', 16),
          'Add a client',
          h('span.muted', '· we suggest the buyer questions to start with'),
        ),
  );
  const grid = desk.matches ? table : h('div.client-grid', { class: quiet ? 'quiet' : '' });
  function drawGrid() {
    const list = shown();
    if (desk.matches) {
      clear(table.querySelector('tbody'), list.map(row));
      table.querySelector('.client-empty')?.remove();
      if (!list.length)
        table.append(
          h(
            'p.muted.pad.client-empty',
            `No client matches “${prefs.q}”. `,
            h(
              'button.linkish',
              {
                type: 'button',
                onclick: () => {
                  prefs.q = '';
                  const s = view.querySelector('.search-field input');
                  if (s) {
                    s.value = '';
                    s.focus();
                  }
                  drawGrid();
                },
              },
              'Clear search',
            ),
          ),
        );
      return;
    }
    clear(
      grid,
      list.map(card),
      archived || prefs.q ? null : addCard,
      !list.length
        ? h(
            'p.muted.pad',
            `No client matches “${prefs.q}”. `,
            h(
              'button.linkish',
              {
                type: 'button',
                onclick: () => {
                  prefs.q = '';
                  const s = view.querySelector('.search-field input');
                  if (s) {
                    s.value = '';
                    s.focus();
                  }
                  drawGrid();
                },
              },
              'Clear search',
            ),
          )
        : null,
    );
  }
  if (clients.length) drawGrid();
  const list = clients.length
    ? grid
    : archived
      ? emptyState({
          pose: 'happy',
          title: 'No archived clients',
          text: 'Archived clients show up here with their history.',
        })
      : // U5: an empty workspace gets one curious look per session; later visits keep a calm, blinking Xo.
        emptyState({
          pose: (() => {
            try {
              if (sessionStorage.getItem('xaeo-empty-curious')) return 'rest';
              sessionStorage.setItem('xaeo-empty-curious', '1');
            } catch {
              /* storage off */
            }
            return 'curious';
          })(),
          title: 'Add your first client',
          text: `Add a client’s website and we suggest the buyer questions their customers ask.${sampleOk || archivedSample ? ' Or look around with the sample client first.' : ''}`,
          actions: [
            link('Add a client', '#/new', { dataset: { tour: 'add-client' } }, 'plus'),
            sampleOk || archivedSample ? addSample : null,
          ].filter(Boolean),
        });

  const showSetup =
    !archived && doneCount < steps.length && hidden
      ? h(
          'p.list-foot',
          h(
            'button.linkish',
            {
              type: 'button',
              onclick: () => {
                store('xaeo-setup-hidden', null);
                renderClients(view, { archived });
              },
            },
            'Show the setup guide',
          ),
        )
      : null;
  const foot =
    !archived && archivedCount
      ? h('p.list-foot', h('a', { href: '#/archived' }, `Archived clients (${archivedCount})`))
      : null;
  const sampleFoot =
    sampleOk && !archived && clients.length && !clients.some((c) => c.sample)
      ? h(
          'p.list-foot',
          'Want to explore without touching real clients? ',
          h('button.linkish', { type: 'button', onclick: onSample }, 'Add the sample client'),
        )
      : null;
  const listHead =
    clients.length && !archived && desk.matches
      ? toolbar
        ? h('div.section-head.list-head', toolbar)
        : null
      : clients.length && !archived
        ? h(
            'div.section-head.list-head',
            h(
              'div',
              h('h2', 'Your clients'),
              h('p.muted', 'Each card shows the one thing to do next.'),
            ),
            toolbar,
          )
        : null;
  // C5: an empty workspace leads with "Add your first client" (the one action), the setup guide follows it.
  const firstRun = !archived && !clients.length;
  if (firstRun) list.classList.add('first-run');
  clear(
    view,
    head,
    firstRun ? null : onboarding,
    listHead,
    list,
    firstRun ? onboarding : null,
    foot,
    showSetup,
    sampleFoot,
    statsBlock(),
  );
  // Keep running scans live on the list; stops as soon as the user leaves this screen.
  let alive = true,
    cleanupNext = null;
  if (clients.some((c) => c.runningId))
    timer = setTimeout(() => {
      if (alive)
        renderClients(view, { archived, quiet: true }).then((next) => {
          if (alive) cleanupNext = next;
          else next();
        });
    }, 2500);
  return () => {
    alive = false;
    clearTimeout(timer);
    cleanupNext?.();
  };
}
