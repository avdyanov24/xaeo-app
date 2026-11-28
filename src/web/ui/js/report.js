// White-label report page. Agency branding only: no product name, logo or link anywhere.
// Options come from the URL hash: client, type (fix | progress), answers, estimates.
import { clientScanContext, comparisonReasons } from './scan-context.js';
import { fixTitle, fixWhy, isDiagnostic } from './fix-labels.js';
import { brandTokens } from './brand-color.js';
const $ = (tag, props = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') Object.assign(el.style, v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity))
    if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
};
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const day = (ms) => {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};
// YYYY-MM-DD in the page's own timezone (the workspace one inside the PDF render), so the title matches the cover day().
const isoDay = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (names) =>
  names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
const params = new URLSearchParams(location.hash.slice(1));
const opts = { answers: params.get('answers') === '1', estimates: params.get('estimates') === '1' };
let type = params.get('type') === 'progress' ? 'progress' : 'fix';
const root = document.getElementById('report');
let data;

function section(title, ...kids) {
  return $('section', { class: 'r-section' }, $('h2', {}, title), ...kids);
}
function pill(label) {
  return $('span', { class: `r-pill r-${label.replace(/\s/g, '-').toLowerCase()}` }, label);
}
// Question grid: Not mentioned is a ring on screen (label for screen readers and print), so no cell wraps.
function gridPill(label) {
  return label === 'Not mentioned'
    ? $(
        'span',
        { class: 'r-pill r-not-mentioned r-ring-only' },
        $('span', { class: 'r-sr' }, label),
      )
    : pill(label);
}
// The method text can repeat the same engine note; keep each sentence once, one sentence per "Label:" prefix,
// and drop a sentence whose words already appear inside a kept one ("Sample engine: scripted answers." then
// "Scripted answers.").
function dedupeSentences(text) {
  const kept = [],
    prefixes = new Set();
  const norm = (s) =>
    ` ${s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()} `;
  return String(text || '')
    .split(/(?<=\.)\s+/)
    .filter((sentence) => {
      const raw = sentence.trim().toLowerCase(),
        key = norm(sentence),
        prefix = /^([^:.]{3,40}):/.exec(raw)?.[1];
      if (!key.trim() || kept.some((k) => k.includes(key)) || (prefix && prefixes.has(prefix)))
        return false;
      kept.push(key);
      if (prefix) prefixes.add(prefix);
      return true;
    })
    .join(' ');
}
// Impact and evidence badges, matching the app: a 3-bar signal for impact, a tint for evidence.
const LEVEL = { High: 3, Medium: 2, Low: 1 };
function badges(f) {
  return [
    $(
      'span',
      { class: 'r-badge r-impact' },
      $(
        'span',
        { class: `r-signal r-signal-${LEVEL[f.impact] || 1}`, 'aria-hidden': 'true' },
        $('i', {}),
        $('i', {}),
        $('i', {}),
      ),
      `${f.impact} impact`,
    ),
    $(
      'span',
      { class: `r-badge r-ev-${String(f.evidence).toLowerCase()}` },
      `${f.evidence} evidence`,
    ),
  ];
}

// First character of the agency name for the monogram: a whole emoji or letter with its marks, never half a surrogate pair.
const firstLetter = (name) => {
  const text = String(name || '').trim();
  const graphemes =
    typeof Intl.Segmenter === 'function'
      ? Array.from(
          new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
          (part) => part.segment,
        )
      : Array.from(text);
  const first = graphemes[0];
  return (first || '').toUpperCase();
};

// Long names step the cover type down so a 100-character name takes a few lines, not a page (the 52px headline fits about 22 capitals a line).
const sizeOf = (name) => {
  const n = Array.from(String(name || '')).length;
  return n > 80 ? ' r-xlong' : n > 36 ? ' r-long' : '';
};

function cover(kind) {
  const w = data.workspace;
  return $(
    'section',
    { class: 'r-cover' },
    $('div', { class: 'r-band' }),
    $(
      'div',
      { class: 'r-cover-body' },
      w.logo
        ? $('img', { class: 'r-logo', src: w.logo, alt: w.name })
        : $(
            'p',
            { class: `r-agency${sizeOf(w.name)}` },
            $('span', { class: 'r-monogram', 'aria-hidden': 'true' }, firstLetter(w.name)),
            w.name,
          ),
      $('p', { class: 'r-kicker' }, kind),
      data.source?.sample
        ? $('p', { class: 'r-sample-note' }, 'Sample data - these are not customer measurements.')
        : null,
      $('h1', { class: sizeOf(data.client.name).trim() || null }, data.client.name),
      $(
        'p',
        { class: 'r-sub' },
        [data.client.domain, data.client.city].filter(Boolean).join(' · '),
      ),
      $('p', { class: 'r-sub' }, `Answers collected ${day(data.date)}`),
      $('p', { class: 'r-prepared' }, `Prepared by ${w.name}`),
    ),
  );
}

// U05: the scan stores each fix's caution inside its "why" ("Unverified hypothesis: ... Draft only; confirm the website
// facts and replace all placeholders before publishing."). The client reads that caution once, in "How to read these
// fixes" above the list, so each fix keeps only its reasoning. Text without the caution passes through unchanged.
const CAUTION_START = /^\s*Unverified hypothesis:\s*/i;
const CAUTION_END =
  /\s*Draft only; confirm the website facts and replace all placeholders before publishing\.?\s*$/i;
const fixReason = (f) =>
  String(fixWhy(f) || '')
    .replace(CAUTION_START, '')
    .replace(CAUTION_END, '');
function readingNote() {
  return $(
    'div',
    { class: 'r-read-note' },
    $('h3', {}, 'How to read these fixes'),
    $(
      'p',
      {},
      'Each fix is a recommendation based on the answers collected for this report, not a guarantee of future mentions. The code and copy are drafts: the website facts are confirmed and every placeholder in square brackets is filled in before anything is published.',
    ),
  );
}

function methodSection() {
  const d = data.definitions;
  const c = data.coverage;
  const context = clientScanContext(data.source?.configuration);
  return section(
    'Method and limits',
    $(
      'p',
      {},
      `${data.engines.some((e) => e.ok) ? `Returned answers came from ${list(data.engines.filter((e) => e.ok).map((e) => e.name))}.` : 'No engine returned a counted answer.'} The latest answers were collected on ${day(data.date)}.`,
    ),
    c
      ? $(
          'p',
          {},
          `Coverage: ${c.ok} of ${c.total} question–engine pairs returned answers; ${c.failed} failed, ${c.skipped} were not connected. Only returned answers enter the mention share.`,
        )
      : null,
    $('p', {}, dedupeSentences(data.method)),
    $('h3', {}, context.heading),
    context.rows.map(([label, value]) => $('p', {}, $('strong', {}, `${label}: `), value)),
    context.limitations
      .filter((limit) => !String(data.method || '').includes(limit))
      .map((limit) => $('p', { class: 'r-muted' }, limit)),
    $(
      'p',
      {},
      'AI answers vary between engines and over time, and answers in consumer apps can differ from what we collected. An answer counts as a mention when it names the business. Nothing in this report guarantees future mentions or rankings.',
    ),
    $(
      'div',
      { class: 'r-defs' },
      $(
        'div',
        {},
        $('h3', {}, 'Evidence'),
        Object.entries(d.evidence).map(([k, v]) => $('p', {}, $('strong', {}, `${k}: `), v)),
      ),
      $(
        'div',
        {},
        $('h3', {}, 'Impact'),
        Object.entries(d.impact).map(([k, v]) => $('p', {}, $('strong', {}, `${k}: `), v)),
      ),
    ),
  );
}
function contactSection() {
  const w = data.workspace;
  return section(
    'Questions about this report',
    $(
      'p',
      { class: 'r-contact' },
      $('strong', {}, w.name),
      w.website ? ` · ${w.website}` : '',
      w.contact ? ` · ${w.contact}` : '',
    ),
  );
}
function answersAppendix() {
  if (!opts.answers) return null;
  return section(
    'Appendix: full answers',
    data.answers.map((a) =>
      $(
        'div',
        { class: 'r-answer' },
        $(
          'p',
          { class: 'r-answer-head' },
          $('strong', {}, a.engine),
          ` · “${a.question}” · `,
          pill(a.label),
        ),
        $(
          'pre',
          {},
          a.text
            .replace(/\*\*/g, '')
            .replace(/^\* /gm, '• ')
            .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '$1'),
        ),
        a.citations?.length
          ? $(
              'p',
              { class: 'r-sources' },
              'Sources: ',
              ...a.citations.flatMap((c, i) => [
                i ? ', ' : '',
                /^https?:\/\//i.test(c.url)
                  ? $('a', { href: c.url, rel: 'noopener noreferrer' }, c.domain)
                  : c.domain,
              ]),
            )
          : null,
      ),
    ),
  );
}

// U8: every engine's share as a mini bar (latest in the agency color; with a baseline, a pale-blue bar above it).
// Bars are scaleX transforms with a fixed track, so they print exactly as shown. Engines with no answers say so.
function glanceBars(baseline = null) {
  const bar = (f, cls) =>
    $(
      'span',
      { class: `r-mini ${cls}` },
      $('span', { style: { transform: `scaleX(${Math.max(0, Math.min(1, f))})` } }),
    );
  return $(
    'ul',
    {
      class: `r-mini-bars${baseline ? ' r-mini-pairs' : ''}`,
      'aria-label': 'Answers that mention the client, by engine',
    },
    data.engines.map((e) => {
      const before = baseline ? (baseline[e.id] ?? 0) : null;
      const text = !e.ok
        ? 'No answers'
        : baseline
          ? `${before} to ${e.mentioned} of ${e.ok}`
          : `${e.mentioned} of ${e.ok}`;
      return $(
        'li',
        { class: e.ok ? null : 'r-mini-off' },
        $('span', { class: 'r-mini-name' }, e.name),
        $(
          'span',
          { class: 'r-mini-track', 'aria-hidden': 'true' },
          baseline ? bar(e.ok ? before / e.ok : 0, 'r-mini-before') : null,
          bar(e.ok ? e.mentioned / e.ok : 0, 'r-mini-after'),
        ),
        $('span', { class: 'r-mini-num' }, text),
      );
    }),
  );
}

// Screen-only numeral roll (600ms --ease-out), first render only. Print, reduced motion and a print started mid-roll
// all get the final number.
let rolled = false;
const easeOut = (t) => 1 - (1 - t) ** 4; // close to cubic-bezier(.22,1,.36,1) for a short count
function rollOnce(el, from, to) {
  if (rolled || from === to || matchMedia('print, (prefers-reduced-motion: reduce)').matches)
    return;
  rolled = true;
  el.style.minWidth = `${Math.max(String(from).length, String(to).length)}ch`;
  el.textContent = String(from);
  const start = performance.now(),
    done = () => {
      el.textContent = String(to);
    };
  addEventListener('beforeprint', done, { once: true });
  const safety = setTimeout(done, 700);
  const frame = (now) => {
    const t = Math.min(1, (now - start) / 600);
    el.textContent = String(Math.round(from + (to - from) * easeOut(t)));
    if (t < 1) requestAnimationFrame(frame);
    else {
      clearTimeout(safety);
      done();
    }
  };
  requestAnimationFrame(frame);
}

function fixReport() {
  const s = data.summary,
    engines = data.engines
      .filter((e) => e.ok)
      .sort((a, b) => b.mentioned / (b.ok || 1) - a.mentioned / (a.ok || 1));
  const best = engines[0],
    worst = engines.at(-1),
    top = data.competitors[0];
  // The website-check diagnostic is not a proposed fix: it is never counted or numbered, and it follows the ranked list.
  const ranked = data.fixes.filter((f) => !isDiagnostic(f)),
    checks = data.fixes.filter(isDiagnostic);
  const open = ranked.filter((f) => f.status === 'todo'),
    high = open.filter((f) => f.impact === 'High').length;
  return [
    cover('AI visibility report'),
    // U8 "At a glance": one scan, so one numeral (no before/after, no invented change) and each engine.
    // U16: the numeral and its words share one baseline ("4 of 15 AI answers mention ..."), the date sits under them,
    // and these bars are the report's one engine-by-engine view (the old table repeated them).
    $(
      'section',
      { class: 'r-glance', 'aria-labelledby': 'r-glance-title' },
      $('h2', { class: 'r-glance-title', id: 'r-glance-title' }, 'At a glance'),
      $(
        'div',
        { class: 'r-glance-stat' },
        $(
          'p',
          { class: 'r-glance-line' },
          $('span', { class: 'r-proof-n' }, String(s.mentioned)),
          ' ',
          $('span', { class: 'r-proof-of' }, `of ${s.ok} AI answers mention ${data.client.name}`),
        ),
        $('p', { class: 'r-proof-label' }, `Answers collected ${day(data.date)}`),
      ),
      glanceBars(),
    ),
    section(
      'Summary',
      $(
        'p',
        {},
        `${data.client.name} is named most by ${best.name} (${best.mentioned} of ${best.ok}) and least by ${worst.name} (${worst.mentioned} of ${worst.ok}).${top ? ` ${top.name} appears in ${plural(top.count, 'answer')}.` : ''}${s.cited ? ` ${data.client.domain || 'The client’s website'} is cited as a source in ${plural(s.cited, 'answer')}.` : ''}`,
      ),
      $(
        'p',
        {},
        open.length
          ? `This report lists ${plural(open.length, 'proposed fix', 'proposed fixes')} to review${high ? `, ${high} marked high impact` : ''}.`
          : 'There are no open fixes.',
      ),
      opts.estimates && data.estimate
        ? $(
            'p',
            { class: 'r-estimate' },
            `${data.estimate.projected - data.estimate.current} currently missed answers are linked to open proposals. This does not predict how many will change.`,
          )
        : null,
    ),
    section(
      'Question by question',
      $(
        'div',
        { class: 'r-grid-wrap' },
        $(
          'table',
          { class: 'r-table r-grid' },
          $(
            'thead',
            {},
            $(
              'tr',
              {},
              $('th', {}, 'Buyer question'),
              data.engineNames.map((n) => $('th', {}, n)),
            ),
          ),
          $(
            'tbody',
            {},
            data.grid.map((r) =>
              $(
                'tr',
                {},
                $('td', {}, r.question),
                r.cells.map((c) => $('td', {}, c ? gridPill(c.label) : '-')),
              ),
            ),
          ),
        ),
        $(
          'p',
          { class: 'r-legend' },
          $('span', { class: 'r-pill r-not-mentioned r-ring-only', 'aria-hidden': 'true' }),
          'Not mentioned',
        ),
      ),
    ),
    section(
      'Who the engines recommend instead',
      data.competitors.length
        ? $(
            'ol',
            { class: 'r-list' },
            data.competitors.map((c) =>
              $(
                'li',
                {},
                $('span', {}, c.name),
                $('span', { class: 'r-num' }, plural(c.count, 'answer')),
              ),
            ),
          )
        : $('p', {}, 'No other businesses were named.'),
    ),
    section(
      'Sources the engines cite',
      !data.sources.length
        ? $('p', {}, 'No sources were cited.')
        : $(
            'ol',
            { class: 'r-list' },
            data.sources.map((x) =>
              $(
                'li',
                {},
                $('span', {}, x.name, $('span', { class: 'r-muted' }, ` · ${x.kind}`)),
                $('span', { class: 'r-num' }, plural(x.count, 'answer')),
              ),
            ),
          ),
    ),
    section(
      'Proposed fixes, prioritized by current evidence',
      ranked.length ? readingNote() : null,
      [...ranked, ...checks].map((f, i) =>
        isDiagnostic(f)
          ? $(
              'article',
              { class: 'r-fix' },
              $('h3', {}, `Website check: ${fixTitle(f)}`),
              $('p', {}, fixWhy(f)),
            )
          : $(
              'article',
              { class: 'r-fix' },
              $(
                'h3',
                {},
                `${i + 1}. ${fixTitle(f)}`,
                f.status === 'done' ? $('span', { class: 'r-done' }, ' · Marked done') : null,
              ),
              $(
                'p',
                { class: 'r-fix-meta' },
                ...badges(f),
                $('span', {}, `${f.engines.join(', ')} · ${f.url}`),
              ),
              $('p', {}, fixReason(f)),
              $('pre', {}, f.code),
              $('p', {}, $('strong', {}, 'How to verify: '), f.verify),
              opts.estimates && f.gain
                ? $(
                    'p',
                    { class: 'r-muted' },
                    `Linked to ${plural(f.gain, 'currently missed answer')}; outcome unverified.`,
                  )
                : null,
            ),
      ),
    ),
    methodSection(),
    contactSection(),
    answersAppendix(),
  ];
}

// Phones draw a narrower chart so 12px axis labels stay 12px once the SVG is scaled to the paper. The size follows
// the viewport (rotate, resize) and print always gets the wide chart.
const narrow = matchMedia('screen and (max-width: 700px)');
let printing = false;
function redrawChart() {
  const box = root.querySelector('.r-proof-chart');
  if (box && data?.progress) box.replaceChildren(trend(data.progress.scans));
}
narrow.addEventListener('change', redrawChart);
addEventListener('beforeprint', () => {
  printing = true;
  redrawChart();
});
addEventListener('afterprint', () => {
  printing = false;
  redrawChart();
});

// Round axis ticks (same rule as the app chart, ui/js/charts.js niceTicks): 0/5/10/15/20/25.
function niceTicks(max, count = 5) {
  const m = Math.max(1, Math.ceil(max)),
    raw = m / count,
    mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(
    1,
    [1, 2, 2.5, 5, 10].map((f) => f * mag).find((st) => st >= raw && Number.isInteger(st)),
  );
  const top = Math.ceil(m / step) * step;
  return { top, ticks: Array.from({ length: top / step + 1 }, (_, i) => i * step) };
}

// U4 report version: the final state only (no draw animation), so screen, PDF and paper match.
function trend(points) {
  const NS = 'http://www.w3.org/2000/svg',
    W = narrow.matches && !printing ? 330 : 640,
    H = 200,
    P = W < 400 ? 30 : 44;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'r-chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute(
    'aria-label',
    `Answers that mention the client: ${points.map((p) => `${day(p.date)} ${p.mentioned} of ${p.ok}`).join(', ')}`,
  );
  const { top: max, ticks } = niceTicks(Math.max(...points.map((p) => p.ok), 1));
  const x = (i) =>
      P + (points.length === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (points.length - 1)),
    y = (v) => 16 + (1 - v / max) * (H - 60);
  const add = (tag, attrs, text) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text) el.textContent = text;
    svg.append(el);
  };
  for (const v of ticks) {
    add('line', { x1: P, x2: W - P / 2, y1: y(v), y2: y(v), class: 'r-grid-line' });
    add('text', { x: P - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'r-axis' }, String(v));
  }
  let segment = [];
  const drawSegment = () => {
    if (segment.length > 1) add('polyline', { points: segment.join(' '), class: 'r-line' });
  };
  points.forEach((p, i) => {
    if (i && p.comparableToPrevious === false) {
      drawSegment();
      segment = [];
    }
    segment.push(`${x(i)},${y(p.mentioned)}`);
  });
  drawSegment();
  // B3: equal dates (same-day rescans) are labelled by scan order instead of repeating "24 Oct"; narrow charts with
  // more than 4 points label only the first, the last and every other one.
  const days = points.map((p) =>
    ((d) => `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`)(new Date(p.date)),
  );
  const labels =
    new Set(days).size === days.length ? days : points.map((p, i) => `Scan ${p.number ?? i + 1}`);
  // N2: thin by measured width at every size (first and last always; a middle label only with 8 units clear).
  const anchorOf = (i) =>
    points.length > 1 && i === 0
      ? 'start'
      : points.length > 1 && i === points.length - 1
        ? 'end'
        : 'middle';
  const extent = (i) => {
    const w = labels[i].length * 7 + 4,
      a = anchorOf(i);
    return a === 'start'
      ? [x(i), x(i) + w]
      : a === 'end'
        ? [x(i) - w, x(i)]
        : [x(i) - w / 2, x(i) + w / 2];
  };
  const shown = new Set(points.length ? [0, points.length - 1] : []);
  if (points.length > 2) {
    let right = extent(0)[1];
    const stop = extent(points.length - 1)[0];
    for (let i = 1; i < points.length - 1; i++) {
      const [l, r] = extent(i);
      if (l >= right + 8 && r <= stop - 8) {
        shown.add(i);
        right = r;
      }
    }
  }
  points.forEach((p, i) => {
    add('circle', { cx: x(i), cy: y(p.mentioned), r: 5, class: 'r-dot' });
    add(
      'text',
      { x: x(i), y: y(p.mentioned) - 10, 'text-anchor': 'middle', class: 'r-val' },
      String(p.mentioned),
    );
    if (shown.has(i))
      add('text', { x: x(i), y: H - 8, 'text-anchor': anchorOf(i), class: 'r-axis' }, labels[i]);
  });
  return svg;
}
// Two points are a comparison, not a trend: the report says so under the chart.
const trendNote = (points) =>
  points.length <= 2
    ? $('p', { class: 'r-chart-note' }, 'Two scans so far: this is a comparison, not yet a trend.')
    : null;

function progressReport() {
  const p = data.progress;
  const availability = data.source?.comparisonAvailability;
  const reasons = comparisonReasons(availability);
  if (!p || availability?.comparable === false)
    return [
      cover('AI visibility progress report'),
      section(
        'Summary',
        $('p', {}, 'New baseline: no headline progress comparison is available.'),
        reasons.length
          ? $(
              'ul',
              {},
              reasons.map((reason) => $('li', {}, reason)),
            )
          : $(
              'p',
              {},
              'A progress report needs an earlier scan with a compatible saved setup and answer coverage.',
            ),
      ),
      methodSection(),
      contactSection(),
      answersAppendix(),
    ];
  const diff = p.latest.mentioned - p.baseline.mentioned;
  // Only fixes marked done inside the compared window can sit behind this change; later ones are named apart.
  const doneList = (p.done || []).filter((d) => !isDiagnostic(d));
  const inWindow = doneList.filter((d) => d.doneAt >= p.baseline.date && d.doneAt <= p.latest.date);
  const afterLatest = doneList.filter((d) => d.doneAt > p.latest.date);
  // N6: both scans on one day would read "Between 23 October and 23 October".
  const span =
    day(p.baseline.date) === day(p.latest.date)
      ? `Between the two scans on ${day(p.latest.date)}`
      : `Between ${day(p.baseline.date)} and ${day(p.latest.date)}`;
  const windowText =
    `${span}, ${inWindow.length ? `${plural(inWindow.length, 'fix was', 'fixes were')} marked done` : 'no fixes were marked done'}.` +
    (afterLatest.length
      ? ` ${inWindow.length ? plural(afterLatest.length, 'more fix was', 'more fixes were') : plural(afterLatest.length, 'fix was', 'fixes were')} marked done after the latest scan, so these answers cannot reflect ${afterLatest.length === 1 ? 'it' : 'them'} yet.`
      : '') +
    ' Website changes were not independently verified.';
  const rows = data.engines
    .filter((e) => e.ok)
    .map((e) => ({
      name: e.name,
      before: p.baseline.perEngine[e.id],
      after: e.mentioned,
      ok: e.ok,
    }));
  // Proof hero: the before/after and the observed delta read in one glance; the chart follows directly.
  const short = (ms) => {
    const d = new Date(ms);
    return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
  };
  const arrow = (() => {
    const NS = 'http://www.w3.org/2000/svg',
      s = document.createElementNS(NS, 'svg'),
      a = document.createElementNS(NS, 'path'),
      b = document.createElementNS(NS, 'path');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('class', 'r-proof-arrow');
    s.setAttribute('aria-hidden', 'true');
    a.setAttribute('d', 'M5 12h14');
    b.setAttribute('d', 'm12 5 7 7-7 7');
    s.append(a, b);
    return s;
  })();
  const delta =
    diff > 0
      ? `+${diff} ${diff === 1 ? 'answer' : 'answers'} observed`
      : diff < 0
        ? `−${Math.abs(diff)} ${diff === -1 ? 'answer' : 'answers'} observed`
        : 'No change observed';
  const afterN = $('span', { class: 'r-proof-n' }, String(p.latest.mentioned));
  rollOnce(afterN, p.baseline.mentioned, p.latest.mentioned);
  return [
    cover('AI visibility progress report'),
    // U8 "At a glance" band: before -> after, the observed change, and every engine's bar pair.
    $(
      'section',
      { class: 'r-glance', 'aria-labelledby': 'r-glance-title' },
      $('h2', { class: 'r-glance-title', id: 'r-glance-title' }, 'At a glance'),
      !availability
        ? $(
            'p',
            { class: 'r-muted' },
            'Historical saved comparison. Its original scan setup was not recorded, so compatibility under the current rules is unknown. The saved counts below have not been replaced with current results.',
          )
        : null,
      $(
        'div',
        {
          class: 'r-proof',
          role: 'group',
          'aria-label': `From ${p.baseline.mentioned} to ${p.latest.mentioned} of ${p.latest.ok} answers mentioning ${data.client.name}`,
        },
        $(
          'div',
          { class: 'r-proof-nums' },
          $(
            'div',
            { class: 'r-proof-col r-proof-before' },
            $('span', { class: 'r-proof-n' }, String(p.baseline.mentioned)),
            $('span', { class: 'r-proof-label' }, `Baseline · ${short(p.baseline.date)}`),
          ),
          arrow,
          $(
            'div',
            { class: 'r-proof-col' },
            afterN,
            $('span', { class: 'r-proof-label' }, `Latest · ${short(p.latest.date)}`),
          ),
          $(
            'span',
            { class: 'r-proof-of' },
            `of ${p.latest.ok} answers mention ${data.client.name}`,
          ),
        ),
        $('p', { class: 'r-proof-pill' }, delta),
      ),
      glanceBars(p.baseline.perEngine),
    ),
    section(
      'Summary',
      $('p', {}, windowText),
      $('div', { class: 'r-proof-chart' }, trend(p.scans)),
      trendNote(p.scans),
      p.matchedPairs != null
        ? $(
            'p',
            {},
            `${p.matchedPairs} question–engine pairs returned answers in both scans${availability?.comparable ? ' under the same recorded collection setup' : ' in this saved historical comparison'}. This is one observation per date; answer variation and other changes can affect the result, so it does not establish what caused the difference.`,
          )
        : null,
      opts.estimates && data.estimate
        ? $(
            'p',
            { class: 'r-estimate' },
            `${data.estimate.projected - data.estimate.current} currently missed answers are linked to open proposals. This does not predict how many will change.`,
          )
        : null,
    ),
    section(
      'Before and after, per engine',
      $(
        'table',
        { class: 'r-table' },
        $(
          'thead',
          {},
          $(
            'tr',
            {},
            $('th', {}, 'Engine'),
            $('th', {}, 'Baseline'),
            $('th', {}, 'Latest'),
            $('th', {}, 'Change'),
          ),
        ),
        $(
          'tbody',
          {},
          rows.map((r) =>
            $(
              'tr',
              {},
              $('td', {}, r.name),
              $('td', {}, `${r.before} of ${r.ok}`),
              $('td', {}, `${r.after} of ${r.ok}`),
              $(
                'td',
                { class: 'r-num' },
                r.after - r.before > 0
                  ? `+${r.after - r.before}`
                  : r.after - r.before < 0
                    ? `−${r.before - r.after}`
                    : '0',
              ),
            ),
          ),
        ),
      ),
    ),
    section(
      'Fixes marked done',
      doneList.length
        ? $(
            'ol',
            { class: 'r-list' },
            doneList.map((d) =>
              $(
                'li',
                {},
                $(
                  'span',
                  {},
                  d.title,
                  d.doneAt > p.latest.date
                    ? $('span', { class: 'r-muted' }, ' · after the latest scan')
                    : null,
                ),
                $('span', { class: 'r-num' }, day(d.doneAt)),
              ),
            ),
          )
        : $('p', {}, 'None yet.'),
    ),
    ((todo) =>
      section(
        'Still to do',
        todo.length
          ? $(
              'ol',
              { class: 'r-list' },
              todo.map((f) =>
                $(
                  'li',
                  {},
                  $('span', {}, fixTitle(f)),
                  $('span', { class: 'r-num' }, `${f.impact} impact`),
                ),
              ),
            )
          : $('p', {}, doneList.length ? 'Every fix is done.' : 'No fixes are open.'),
      ))(data.fixes.filter((f) => f.status === 'todo' && !isDiagnostic(f))),
    methodSection(),
    contactSection(),
    answersAppendix(),
  ];
}

function render() {
  root.replaceChildren(...(type === 'progress' ? progressReport() : fixReport()).filter(Boolean));
  document.querySelector('[data-foot]').textContent = [
    data.workspace.website || data.workspace.name,
    data.client.name,
  ].join(' · ');
}

async function load() {
  const reportId = params.get('report'),
    clientId = params.get('client');
  const id = reportId || clientId;
  if (!/^[\w-]{36}$/.test(id || '')) {
    fail({
      icon: 'link',
      title: 'This report link is incomplete',
      text: 'It’s missing the report’s ID. Open the report again from the client’s Reports tab.',
    });
    return;
  }
  const response = await fetch(
    reportId ? `/api/app/reports/${id}` : `/api/app/clients/${id}/report?type=${type}`,
    { credentials: 'same-origin' },
  );
  if (response.status === 401) {
    location.assign('/login?next=' + encodeURIComponent(location.pathname + location.hash));
    return;
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status >= 500) loadError('server');
    else if (response.status === 404)
      fail({
        icon: 'file',
        title: 'Report not found',
        text: 'It may have been deleted, or the link belongs to another workspace. Open it again from the client’s Reports tab.',
      });
    else
      fail({
        icon: 'file',
        title: 'This report can’t be opened',
        text: body.error
          ? `${body.error.replace(/\.?$/, '.')} Open it again from the client’s Reports tab.`
          : 'Open it again from the client’s Reports tab.',
      });
    return;
  }
  data = body;
  // Old scans have no saved client settings, so the name arrives as null: say "This client" instead of printing it.
  if (!data.client?.name) data.client = { ...data.client, name: 'This client' };
  if (reportId) {
    type = body.reportType;
    opts.answers = !!body.reportOptions.answers;
    opts.estimates = !!body.reportOptions.estimates;
  }
  // Back goes to this client's Reports tab (where the report was exported), not the client list.
  const backId = data.source?.clientId || clientId;
  if (/^[\w-]{36}$/.test(backId || '')) {
    document.querySelector('[data-back]')?.setAttribute('href', `/app#/clients/${backId}/reports`);
    const label = document.querySelector('[data-back-label]');
    if (label)
      label.textContent = data.client.name ? `Back to ${data.client.name}` : 'Back to this client';
  }
  // Raw colour for the band; same-hue shades that pass contrast for text, fills and charts (brand-color.js).
  const t = brandTokens(data.workspace.color);
  for (const [k, v] of Object.entries({
    '--brand': t.brand,
    '--brand-ink': t.ink,
    '--brand-graphic': t.graphic,
    '--brand-fill': t.fill,
    '--brand-on': t.on,
  }))
    document.documentElement.style.setProperty(k, v);
  document.title = `${data.client.name} ${type === 'progress' ? 'AI visibility progress report' : 'AI visibility report'} ${isoDay(data.date)}`;
  for (const box of document.querySelectorAll('[data-opt]')) {
    box.checked = opts[box.dataset.opt];
    box.addEventListener('change', () => {
      opts[box.dataset.opt] = box.checked;
      render();
    });
  }
  render();
  // The toolbar (report-actions.js, screen only) needs to know what to save when the report is printed.
  document.dispatchEvent(
    new CustomEvent('report:loaded', {
      detail: {
        reportId: reportId || null,
        clientId: /^[\w-]{36}$/.test(backId || '') ? backId : null,
        type,
        scanId: data.source?.scanId || null,
        opts: { ...opts },
      },
    }),
  );
}
// A failed load says what happened and offers one way on, in the app's empty-state shape: icon tile, heading,
// one sentence, one action (R13). White-label: a neutral line icon, no product name or mascot.
const FAIL_ICONS = {
  link: '<path d="M9 17H7A5 5 0 0 1 7 7"/><path d="M15 7h2a5 5 0 0 1 4 8"/><line x1="8" x2="12" y1="12" y2="12"/><line x1="2" x2="22" y1="2" y2="22"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m14.5 12.5-5 5"/><path d="m9.5 12.5 5 5"/>',
  offline:
    '<path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M19 12.859a10 10 0 0 0-2.007-1.523"/><path d="M2 8.82a15 15 0 0 1 4.177-2.643"/><path d="M22 8.82a15 15 0 0 0-11.288-3.764"/><path d="m2 2 20 20"/>',
};
function fail({ icon, title, text, action }) {
  document.body.classList.add('report-failed');
  document.title = title;
  const tile = $('span', { class: 'r-error-icon', 'aria-hidden': 'true' });
  // The icon markup is a constant from FAIL_ICONS (never data); parsed as SVG so no HTML sink is involved.
  tile.append(
    document.importNode(
      new DOMParser().parseFromString(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${FAIL_ICONS[icon]}</svg>`,
        'image/svg+xml',
      ).documentElement,
      true,
    ),
  );
  const back = document.querySelector('[data-back]')?.getAttribute('href') || '/app';
  // R14: when the card's one action is "Back to the workspace", the toolbar's identical Back link goes (one Tab stop);
  // with "Try again" the toolbar keeps Back, a different action.
  if (!action) document.body.classList.add('report-failed-back');
  root.replaceChildren(
    $(
      'div',
      { class: 'r-error', role: 'alert' },
      tile,
      $('h1', {}, title),
      $('p', {}, text),
      action || $('a', { class: 'tb-btn', href: back }, 'Back to the workspace'),
    ),
  );
}
// Says what happened and what to do: a server answer that failed is not the reader's connection.
// $() sets attributes, so an onclick there became an inline handler the CSP blocks: the listener is added directly.
function loadError(kind) {
  const retry = $('button', { class: 'tb-btn', type: 'button' }, 'Try again');
  retry.addEventListener('click', () => location.reload());
  fail({
    icon: kind === 'server' ? 'file' : 'offline',
    title: 'This report couldn’t be loaded',
    text:
      kind === 'server'
        ? 'The server had a problem sending it. Try again in a minute.'
        : 'Check your connection, then try again.',
    action: retry,
  });
}
load().catch(() => loadError());
addEventListener('hashchange', () => location.reload());
