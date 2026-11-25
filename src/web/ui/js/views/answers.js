// Answers: question × engine grid (a stacked list of question cards below 720px). Click a cell for the full answer,
// sources and who was recommended instead; ← and → in the drawer step through the grid.
import {
  api,
  h,
  clear,
  date,
  icon,
  labelPill,
  openAnswer,
  emptyState,
  segScroll,
  edgeScroll,
  button,
  desk,
} from '../lib.js';
import { caveatRow } from '../caveats.js';
import { get as getPref, set as setPref } from '../prefs.js';

let focus = 'all';
// Same session list overview.js writes when this browser stopped a scan (xaeo-stopped-scans).
const wasStoppedScan = (id) => {
  try {
    return !!id && JSON.parse(sessionStorage.getItem('xaeo-stopped-scans') || '[]').includes(id);
  } catch {
    return false;
  }
};
// Other screens (e.g. the overview's "Review the answers that miss" step) open Answers with a highlight preset.
export const presetAnswersFocus = (key) => {
  focus = key;
};
// U08: per client, the newest scan whose answers the agency has opened here. Stored inside the one device-prefs key
// (`xaeo-prefs`, prefs.js), so no new browser-storage key; a new scan brings the "Review the answers" step back.
export const answersSeen = {
  has: (id, number) => (Number(getPref('answersSeen')?.[id]) || 0) >= number,
  add: (id, number) => {
    const all = { ...(getPref('answersSeen') || {}) };
    if ((Number(all[id]) || 0) >= number) return;
    all[id] = number;
    setPref('answersSeen', all);
  },
};

// U14: one vocabulary on this tab. "Named" (a mention) and "Named + linked" (a citation) are both counted by the
// "Named" filter, so the filter count always equals the cells it highlights. Server labels stay as they are.
const SHOWN = { Cited: 'Named + linked', Mentioned: 'Named', 'Not mentioned': 'Not named' };
const pill = (label) => {
  const p = labelPill(label);
  if (SHOWN[label]) p.lastChild.textContent = SHOWN[label];
  return p;
};
// The answer reader (lib.js openAnswer: the desktop pane or the phone drawer) prints the server label; on this tab it
// says the same words as the grid. Scoped to the Answers route, so other screens keep their own labels.
const relabel = (root) =>
  root.querySelectorAll?.('.answer-meta > .pill').forEach((p) => {
    const t = p.lastChild;
    if (t && SHOWN[t.textContent]) t.textContent = SHOWN[t.textContent];
  });
let readerWatch = null;
const watchReader = () => {
  if (readerWatch || typeof MutationObserver !== 'function') return;
  readerWatch = new MutationObserver((records) => {
    if (document.body.dataset.route !== 'client-answers') return;
    for (const r of records)
      for (const n of r.addedNodes)
        if (n.nodeType === 1) {
          if (n.matches('.answer-meta')) relabel(n.parentNode);
          else relabel(n);
        }
  });
  readerWatch.observe(document.body, { childList: true, subtree: true });
};

export async function renderAnswers(el, ctx, scanId = null) {
  const data = await api(`/api/app/clients/${ctx.id}/answers${scanId ? `?scan=${scanId}` : ''}`);
  // U08: the overview's "Review the answers that miss" step is done once the agency has opened this tab.
  if (data.scan?.number) answersSeen.add(ctx.id, data.scan.number);
  watchReader();
  if (!data.scan)
    return clear(
      el,
      ctx.detail.running
        ? emptyState({
            pose: 'thinking',
            title: 'The first scan is running',
            text: 'Answers appear here as soon as it finishes.',
          })
        : emptyState({
            pose: 'curious',
            title: 'No answers yet',
            text: 'Run the first scan to fill this grid.',
            actions: [
              button('Run first scan', { onclick: (e) => ctx.startScan(e.currentTarget) }, 'play'),
            ],
          }),
    );
  const picker = h(
    'select',
    { 'aria-label': 'Scan', onchange: (e) => renderAnswers(el, ctx, e.target.value) },
    data.scans.map((s) =>
      h(
        'option',
        { value: s.id, selected: s.id === data.scan.id },
        `Scan ${s.number} · ${date(s.finishedAt)} · ${s.ok ? `${s.mentioned} of ${s.ok}` : 'no answers'}`,
      ),
    ),
  );
  const comparison = data.scan.comparisonToPrevious;
  // D5: the server labels slots a stop never reached "Failed". They are not an engine fault, so a stopped scan's
  // failed cells read "Cancelled" (server ask filed in team/handoff-maya-api.md for a real per-answer label).
  const stopped =
    data.scan.job?.status === 'cancelled' ||
    data.scan.status === 'cancelled' ||
    wasStoppedScan(data.scan.id);
  const isCancelled = (c) =>
    /cancelled before this answer/i.test(c.error || c.reason || c.text || '') ||
    (stopped && c.label === 'Failed');
  Object.values(data.cells).forEach((r) =>
    Object.values(r).forEach((c) => {
      if (c && c.label === 'Failed' && isCancelled(c)) c.label = 'Cancelled';
    }),
  );
  // Reading order for the drawer: row by row, left to right.
  const order = data.questions.flatMap((q) =>
    data.engines.map((e) => data.cells[q.id]?.[e.id]?.id).filter(Boolean),
  );
  const kind = (c) =>
    c.status !== 'ok' ? 'other' : c.label === 'Not mentioned' ? 'missed' : 'mentioned';
  // The "· " is its own span so the compact desktop matrix can drop it when the rank sits under the label.
  const pos = (c) =>
    c.position && c.label !== 'Not mentioned'
      ? h('span.pos', h('span.pos-sep', '· '), `#${c.position}`)
      : null;
  const ariaLabel = (c, engine = '') =>
    `${engine}${SHOWN[c.label] || c.label}${c.position ? `, listed number ${c.position}` : ''}. Open answer`;
  const cell = (c) =>
    !c
      ? h('td.cell.empty-cell', '-')
      : h(
          'td.cell',
          { dataset: { kind: kind(c) } },
          h(
            'button.cell-btn',
            { type: 'button', onclick: () => openAnswer(c.id, order), 'aria-label': ariaLabel(c) },
            pill(c.label),
            pos(c),
          ),
        );
  const totals = data.engines.map((e) => {
    const list = data.questions
      .map((q) => data.cells[q.id]?.[e.id])
      .filter((c) => c && c.status === 'ok');
    return {
      name: e.name,
      hit: list.filter((c) => c.label !== 'Not mentioned').length,
      of: list.length,
    };
  });
  const hasLabel = (l) =>
    Object.values(data.cells).some((r) => Object.values(r).some((c) => c.label === l));
  // Phones get one card per question; CSS shows the table or the list, never both.
  const row = (e, c) =>
    !c
      ? h('li.answer-row.empty-cell', h('span.answer-engine', e.name), h('span', '-'))
      : h(
          'li',
          { dataset: { kind: kind(c) } },
          h(
            'button.answer-row',
            {
              type: 'button',
              onclick: () => openAnswer(c.id, order),
              'aria-label': ariaLabel(c, `${e.name}: `),
            },
            h('span.answer-engine', e.name),
            h('span.answer-result', pill(c.label), pos(c)),
          ),
        );
  const gridHint = h(
    'p.grid-hint.muted.small',
    { hidden: true },
    icon('arrowRight', 14),
    'Scroll sideways for more engines',
  );
  const body = h(
    'div.answers-body',
    { dataset: { tour: 'grid', focus } },
    h(
      'ul.engine-totals',
      { 'aria-label': 'Named by engine' },
      totals.map((t) => h('li', `${t.name} `, t.of ? h('strong', `${t.hit} of ${t.of}`) : '-')),
    ),
    ((wrap) => edgeScroll(wrap, h('div.grid-frame', wrap), gridHint))(
      h(
        'div.grid-wrap',
        h(
          'table.answer-grid',
          h(
            'thead',
            h(
              'tr',
              h('th', { scope: 'col' }, 'Buyer question'),
              data.engines.map((e) => h('th', { scope: 'col' }, e.name)),
            ),
          ),
          h(
            'tbody',
            data.questions.map((q) =>
              h(
                'tr',
                h('th', { scope: 'row' }, q.text),
                data.engines.map((e) => cell(data.cells[q.id]?.[e.id])),
              ),
            ),
          ),
          h(
            'tfoot',
            h(
              'tr',
              h('th', { scope: 'row' }, 'Named in'),
              totals.map((t) =>
                h(
                  'td.total',
                  t.of
                    ? h('span', h('strong', String(t.hit)), ` of ${t.of}`)
                    : h('span.muted', '-'),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
    h(
      'ol.answer-list',
      data.questions.map((q) =>
        h(
          'li.answer-card',
          h('h3', q.text),
          h(
            'ul',
            data.engines.map((e) => row(e, data.cells[q.id]?.[e.id])),
          ),
        ),
      ),
    ),
  );
  const LEGEND = [
    ['Cited', 'Named, and the client’s site is one of the sources.'],
    ['Mentioned', 'The client is named in the answer.'],
    ['Not mentioned', 'The client isn’t named.'],
    ['Failed', 'The engine didn’t answer. Retry from the overview.'],
    ['Cancelled', 'The scan was stopped before this answer. Not counted.'],
    ['Not connected', 'The engine isn’t connected yet.'],
  ];
  const seg = (key, label) =>
    h(
      'button.seg',
      {
        type: 'button',
        'aria-pressed': String(focus === key),
        onclick: (e) => {
          focus = key;
          body.dataset.focus = key;
          e.currentTarget.parentElement
            .querySelectorAll('.seg')
            .forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
        },
      },
      label,
    );
  // The one-line key under the filter: what "Named" counts and what the cobalt cell adds.
  const keyLine = () =>
    h(
      'p.answers-key',
      pill('Cited'),
      h(
        'span',
        `names the client and links to ${ctx.detail?.domain || 'its site'}. The Named filter counts both kinds.`,
      ),
    );
  if (desk.matches) return deskAnswers();
  clear(
    el,
    h(
      'div.section-head',
      h(
        'div',
        h('h2', 'Answers'),
        h(
          'p.muted',
          'Every question, every engine. Open a cell to read the full answer',
          h('span.kbd-hint', '; use ← and → to step through'),
          '.',
        ),
      ),
      h('label.inline-field', h('span', 'Scan'), picker),
    ),
    // One caveat row instead of a card, so the grid starts higher (P1-8).
    caveatRow({
      configuration: data.scan.configuration,
      comparison,
      comparableText:
        'Comparable with the previous scan. Answer variation can still occur; this does not establish what caused a change.',
      baselineText: 'New baseline: no headline comparison with the previous scan.',
    }),
    h(
      'div.grid-tools',
      segScroll(
        h(
          'div.segmented',
          { role: 'group', 'aria-label': 'Highlight' },
          seg('all', 'All'),
          seg('mentioned', 'Named'),
          seg('missed', 'Not named'),
        ),
      ),
      gridHint,
    ),
    keyLine(),
    body,
    h(
      'dl.legend',
      { 'aria-label': 'What the labels mean' },
      LEGEND.filter(
        ([l]) => ['Cited', 'Mentioned', 'Not mentioned'].includes(l) || hasLabel(l),
      ).map(([l, text]) => h('div', h('dt', pill(l)), h('dd', text))),
      h('div', h('dt', h('span.pos', '· #2')), h('dd', 'Second in the engine’s list.')),
    ),
  );

  // ---- A+ desktop: question x engine matrix with an inline reading pane (master-detail). A cell opens its answer in
  // the pane; ← and → step through the answers in reading order, ↑ and ↓ move within an engine's column. Below
  // 1024px the grid and drawer above stay as they are.
  function deskAnswers() {
    const pane = h('aside.answer-pane', { 'aria-label': 'Selected answer', tabindex: '-1' });
    const area = h('div.answers-desk');
    const counts = { all: order.length, mentioned: 0, missed: 0 };
    Object.values(data.cells).forEach((r) =>
      Object.values(r).forEach((c) => {
        if (c?.status === 'ok') counts[kind(c)]++;
      }),
    );
    const show = (i, id) =>
      area.querySelectorAll('.cell-btn[data-id]').forEach((b) => {
        const on = b.dataset.id === id;
        b.classList.toggle('is-open', on);
        if (on) b.setAttribute('aria-current', 'true');
        else b.removeAttribute('aria-current');
        // Stepping from the pane's own arrows keeps the marked cell on screen (the pane is sticky, the matrix scrolls).
        if (on && pane.contains(document.activeElement))
          b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
    const open = (id) => openAnswer(id, order, { into: pane, scope: area, onShow: show });
    // On narrow canvases the pane sits under the matrix (app.css): a click brings it into view if it is off screen.
    // Arrow keys in the grid only step (the matrix keeps the eye; the pane follows below).
    const reveal = () => {
      const r = pane.getBoundingClientRect(),
        m = matrix.getBoundingClientRect();
      if (r.top >= m.bottom - 1 && r.top > innerHeight - 120)
        pane.scrollIntoView({
          block: 'start',
          behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        });
    };
    const dcell = (c) =>
      !c
        ? h('td.cell.empty-cell', '-')
        : h(
            'td.cell',
            { dataset: { kind: kind(c) } },
            h(
              'button.cell-btn',
              {
                type: 'button',
                dataset: { id: c.id },
                onclick: () => {
                  open(c.id);
                  reveal();
                },
                'aria-label': ariaLabel(c),
              },
              pill(c.label),
              pos(c),
            ),
          );
    const INTENT = {
      discovery: 'Discovery',
      price: 'Price',
      comparison: 'Comparison',
      branded: 'Branded',
      local: 'Local',
    };
    const seg2 = (key, label) =>
      h(
        'button.seg',
        {
          type: 'button',
          'aria-pressed': String(focus === key),
          onclick: (e) => {
            focus = key;
            matrix.dataset.focus = key;
            e.currentTarget.parentElement
              .querySelectorAll('.seg')
              .forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
          },
        },
        label,
        h('span.count', String(counts[key])),
      );
    const matrix = h(
      'div.answers-body.answer-matrix',
      { dataset: { tour: 'grid', focus } },
      h(
        'p.visually-hidden#answers-keys',
        'Arrow keys move between answers: left and right in reading order, up and down within an engine.',
      ),
      h(
        'div.grid-wrap',
        h(
          'table.answer-grid',
          { 'aria-describedby': 'answers-keys' },
          h(
            'thead',
            h(
              'tr',
              h('th', { scope: 'col' }, 'Buyer question'),
              data.engines.map((e) => h('th', { scope: 'col' }, e.name)),
            ),
          ),
          h(
            'tbody',
            data.questions.map((q) =>
              h(
                'tr',
                h(
                  'th',
                  { scope: 'row' },
                  h('span.q-text-cell', q.text),
                  INTENT[q.intent] ? h('span.q-intent', INTENT[q.intent]) : null,
                ),
                data.engines.map((e) => dcell(data.cells[q.id]?.[e.id])),
              ),
            ),
          ),
          h(
            'tfoot',
            h(
              'tr',
              h('th', { scope: 'row' }, 'Named in'),
              totals.map((t) =>
                h(
                  'td.total',
                  t.of
                    ? h('span', h('strong', String(t.hit)), ` of ${t.of}`)
                    : h('span.muted', '-'),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    // Grid keys on a cell: ← and → step in reading order, ↑ and ↓ stay in the engine's column; focus follows the open
    // answer (scrolled into view), so the next key carries on from there. In the pane, ← and → step (openAnswer).
    const cellFor = (id) => matrix.querySelector(`.cell-btn[data-id="${id}"]`);
    matrix.addEventListener('keydown', (e) => {
      const b = e.target.closest?.('.cell-btn[data-id]');
      if (
        !b ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.shiftKey ||
        !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      let target = null;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
        target = cellFor(order[order.indexOf(b.dataset.id) + (e.key === 'ArrowRight' ? 1 : -1)]);
      else {
        const col = b.closest('td').cellIndex;
        for (let r = b.closest('tr'); r && !target;) {
          r = e.key === 'ArrowDown' ? r.nextElementSibling : r.previousElementSibling;
          target = r?.cells[col]?.querySelector('.cell-btn[data-id]');
        }
      }
      if (!target) return;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      open(target.dataset.id);
    });
    clear(area, matrix, pane);
    clear(
      el,
      h(
        'div.section-head.answers-head',
        h('h2.visually-hidden', 'Answers'),
        h(
          'div.segmented',
          { role: 'group', 'aria-label': 'Highlight' },
          seg2('all', 'All'),
          seg2('mentioned', 'Named'),
          seg2('missed', 'Not named'),
        ),
        h('label.inline-field', h('span', 'Scan'), picker),
      ),
      keyLine(),
      area,
      h(
        'div.answers-foot',
        h(
          'dl.legend',
          { 'aria-label': 'What the labels mean' },
          LEGEND.filter(
            ([l]) => ['Cited', 'Mentioned', 'Not mentioned'].includes(l) || hasLabel(l),
          ).map(([l, text]) => h('div', h('dt', pill(l)), h('dd', text))),
        ),
        caveatRow({
          configuration: data.scan.configuration,
          comparison,
          comparableText:
            'Comparable with the previous scan. Answer variation can still occur; this does not establish what caused a change.',
          baselineText: 'New baseline: no headline comparison with the previous scan.',
        }),
        h(
          'a.ov-method',
          { href: '/methodology', target: '_blank', rel: 'noopener' },
          icon('info', 16),
          'How answers are collected and read',
        ),
      ),
    );
    // Open the first answer that names the client (else the first answer), without moving focus.
    const first =
      order.find((id) =>
        Object.values(data.cells).some((r) =>
          Object.values(r).some((c) => c?.id === id && kind(c) === 'mentioned'),
        ),
      ) || order[0];
    if (first) open(first);
    else clear(pane, h('p.muted.pane-empty', 'No answers in this scan.'));
  }
}
