// Overview: headline number, per-engine results, trend with fix markers, what changed, competitors, sources.
import {
  api,
  h,
  clear,
  icon,
  xo,
  date,
  zonedParts,
  plural,
  emptyState,
  button,
  openAnswer,
  errorToast,
  busy,
  meter,
  setMeter,
  countUp,
  link,
  reducedMotion,
  rollNumber,
  easeOut,
  desk,
} from '../lib.js';
import { createXo, reactionReady } from '../xo.js';
import { state } from '../main.js';
import { statTile, ring, barList, hint, niceTicks, deltaText, DELTA_HEDGE } from '../charts.js';
import { comparisonReasons } from '../scan-context.js';
import { caveatRow } from '../caveats.js';
import { isDiagnostic, fixWhy, fixTitle } from '../fix-labels.js';
import { xoAvailable, askXo } from '../xo-chat.js';
import { presetAnswersFocus, answersSeen } from './answers.js';
import { pendingFor, pendingBlock } from './approvals.js';

const SVG = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  kids.forEach((k) => {
    if (k != null && k !== false) el.append(k);
  });
  return el;
};

// The scan status stays 'running' while it waits; the job says whether it is queued and how many jobs are in front.
// Other agencies' work can still delay a scan, so the count is "about N".
export const isQueued = (p) => p?.job?.status === 'queued';
export const queuedText = (p) => {
  const n = p?.job?.ahead || 0;
  return n ? `about ${n} ${n === 1 ? 'scan' : 'scans'} ahead` : 'starts next';
};
const isStopping = (p) => p?.job?.status === 'cancelling';
const EP_STATE = {
  queued: ['Waiting', 'clock'],
  running: ['Running', null],
  stopping: ['Stopping', 'stop'],
  done: ['Done', 'check'],
  failed: ['Failed', 'alert'],
  skipped: ['Not connected', 'x'],
};

// Scans this browser saw the user stop (session only): the overview then says "You stopped this scan"
// instead of reading the cancelled cells as an engine fault.
const STOPPED_KEY = 'xaeo-stopped-scans';
const stoppedIds = () => {
  try {
    return JSON.parse(sessionStorage.getItem(STOPPED_KEY) || '[]');
  } catch {
    return [];
  }
};
export const markStopped = (id) => {
  try {
    const ids = stoppedIds().filter((x) => x !== id);
    ids.push(id);
    sessionStorage.setItem(STOPPED_KEY, JSON.stringify(ids.slice(-20)));
  } catch {
    /* storage off */
  }
};
const wasStopped = (id) => !!id && stoppedIds().includes(id);

// U5: first client saved -> the "Run the first scan" Xo waves once (new-client.js sets this, read once here).
const FIRST_CLIENT_KEY = 'xaeo-first-client';
const takeFirstClient = (id) => {
  try {
    if (sessionStorage.getItem(FIRST_CLIENT_KEY) !== id) return false;
    sessionStorage.removeItem(FIRST_CLIENT_KEY);
    return true;
  } catch {
    return false;
  }
};

// U4: the trend chart draws itself once per route visit (hash), when it scrolls into view; polling re-renders and
// tab redraws inside the same visit show the final state. A finished-scan reveal may draw it again.
const drawnCharts = new Set();
addEventListener('hashchange', () => drawnCharts.clear());

// Skeleton answers grid: one row per question, one cell per engine. Each engine asks its questions in order,
// so an engine's first `done` cells are the ones that have arrived.
// U2: when the progress payload carries per-engine results (engines[].results: label per asked question, null while
// pending), each arrived cell turns into its pill and a running mention count is shown. Without that field the
// cells fill neutral and the copy says mentions show at the end (no invented results).
const CELL_TONE = {
  Cited: 'cited',
  Mentioned: 'mentioned',
  'Not mentioned': 'missed',
  Failed: 'failed',
  Cancelled: 'off',
  'Not connected': 'off',
};
function scanGrid(ctx, p) {
  const engines = p.engines,
    n = Math.max(0, ...engines.map((e) => e.total));
  const active = ctx.detail.questions.filter((q) => q.active);
  const labels = active.length === n ? active.map((q) => q.text) : null;
  const cols = engines.map(() => []);
  const hasResults = (q) => q.engines.some((e) => Array.isArray(e.results));
  const live = hasResults(p);
  // Desktop: the grid's legend is for screen readers only (the squares and engine heads read on their own).
  const note = h(
    desk.matches ? 'p.visually-hidden' : 'p.muted.small',
    live
      ? 'Each square is one answer. Named answers fill in as they arrive.'
      : 'Each square is one answer. Named answers show when the scan finishes.',
  );
  const tally = h('p.sg-tally', { hidden: !live });
  // Spoken every 5 answers, never per cell.
  const said = h('p.visually-hidden', { role: 'status' });
  let lastSpoken = 0;
  const table = h(
    'div.sg-table',
    { 'aria-hidden': 'true', style: { '--n': engines.length } },
    h(
      'div.sg-row.sg-head',
      h('span'),
      h(
        'span.sg-cells',
        engines.map((e) => h('span.sg-engine', e.name)),
      ),
    ),
    Array.from({ length: n }, (_, i) =>
      h(
        'div.sg-row',
        labels ? h('span.sg-q', labels[i]) : h('span.sk.sg-q-sk'),
        h(
          'span.sg-cells',
          engines.map((e, j) => (cols[j][i] = h('span.sg-cell'))),
        ),
      ),
    ),
  );
  // C5 7.1: each arriving cell takes its real result colour. Cells already in on first render show final (.now);
  // later arrivals of one poll pop in reading order (question, then engine), at most 50ms apart and all started
  // within 600ms, so the score visibly assembles before the headline rolls.
  let first = true,
    settleAt = 0;
  ctx.gridSettle = () => Math.max(0, settleAt - performance.now());
  const update = (q) => {
    if (!q?.engines) return;
    const fresh = [];
    q.engines.forEach((e, j) => {
      const off = e.total && e.skipped === e.total;
      cols[j]?.forEach((cell, i) => {
        if (off) return cell.classList.add('off');
        if (i >= e.done || cell.classList.contains('in')) return;
        const label = Array.isArray(e.results) ? e.results[i] : null;
        if (label) {
          cell.classList.add('res', `res-${CELL_TONE[label] || 'off'}`);
          cell.title = label;
        }
        fresh.push({ cell, i, j });
      });
    });
    fresh.sort((a, b) => a.i - b.i || a.j - b.j);
    const step = Math.max(16, Math.min(50, Math.floor(600 / Math.max(fresh.length, 1))));
    // The cell keeps its pending look until its turn (a CSS delay would blank it or show the colour early).
    const rm = reducedMotion();
    fresh.forEach(({ cell }, idx) => {
      if (first || rm) {
        if (first) cell.classList.add('now');
        cell.classList.add('in');
        return;
      }
      cell.style.setProperty('--cd', `${idx * step}ms`);
      setTimeout(() => cell.classList.add('in'), idx * step);
    });
    if (!first && fresh.length && !reducedMotion())
      settleAt = performance.now() + (fresh.length - 1) * step + 240;
    first = false;
    if (!hasResults(q)) return;
    // D3: only real answers count; failed, cancelled and not-connected slots are not answers.
    const NOT_ANSWER = new Set(['Failed', 'Cancelled', 'Not connected']);
    const arrived = q.engines.reduce(
      (a, e) =>
        a +
        (Array.isArray(e.results) ? e.results.filter((l) => l && !NOT_ANSWER.has(l)).length : 0),
      0,
    );
    const hits = q.engines.reduce(
      (a, e) =>
        a +
        (Array.isArray(e.results)
          ? e.results.filter((l) => l === 'Mentioned' || l === 'Cited').length
          : 0),
      0,
    );
    tally.hidden = false;
    const said1 = isStopping(q)
      ? `Stopped: ${hits} named in ${plural(arrived, 'collected answer')}`
      : `${hits} named so far in ${plural(arrived, 'answer')}`;
    clear(tally, ...said1.split(/(\d+)/).map((part, k) => (k % 2 ? h('span.tnum', part) : part)));
    tally.dataset.said = said1;
    if (arrived - lastSpoken >= 5 || (arrived === q.total && arrived !== lastSpoken)) {
      lastSpoken = arrived;
      said.textContent = tally.dataset.said;
    }
  };
  update(p);
  ctx.progressListeners.add(update);
  return h('section.card.scan-grid', h('h2', 'Answers arriving'), note, table, tally, said);
}

function progressCard(ctx) {
  const rows = new Map();
  const list = h('div.engine-progress');
  const title = h('p.scan-count');
  const bar = meter(0, 'meter-lg');
  // Screen readers get a real progressbar and a status line that speaks only at 25/50/75/100%, not every tick.
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', 'Scan progress');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  const said = h('p.visually-hidden', { role: 'status' });
  let milestone = 0;
  const make = (e) => {
    const pill = h('span.ep-pill'),
      count = h('span.ep-count');
    const row = h('div.ep-row', h('span.ep-name', e.name), pill, meter(0), count);
    rows.set(e.id, { row, pill, count, state: '' });
    list.append(row);
  };
  const eyebrow = h('p.eyebrow', 'Scan running'),
    heading = h(
      'h2',
      { tabindex: '-1', dataset: { scanHeading: '' } },
      'Asking the engines your buyer questions',
    );
  // N3: any member can stop a queued or running scan. No confirm: collected answers stay, the rest can be retried.
  // busy() disables the button, so whether it had focus is read at click time (D1), not when the stop lands.
  let cancelFocused = false;
  const cancelBtn = button(
    'Cancel scan',
    {
      variant: 'ghost',
      size: 'sm',
      onclick: (e) => {
        cancelFocused = document.activeElement === e.currentTarget || e.detail === 0;
        ctx.cancelScan?.(e.currentTarget);
      },
    },
    'stop',
  );
  const cancelNote = h('p.muted.small.scan-cancel-note', 'Answers already collected are kept.');
  let phase = null;
  const update = (p, message) => {
    if (message) said.textContent = message;
    if (!p) return;
    const queued = isQueued(p),
      stopping = isStopping(p);
    const next = stopping ? 'stopping' : queued ? 'queued' : 'running';
    if (next !== phase) {
      // Queued -> running is announced once; the counts below keep their own quieter milestones.
      if (phase === 'queued' && next === 'running') said.textContent = 'Scan started.';
      phase = next;
      eyebrow.textContent = {
        queued: 'Queued',
        running: 'Scan running',
        stopping: 'Stopping scan',
      }[next];
      heading.textContent = {
        queued: 'Waiting for a free slot',
        running: 'Asking the engines your buyer questions',
        stopping: 'Finishing the answer in progress',
      }[next];
      // The button hides while stopping; keyboard focus moves to the card heading instead of falling to <body>.
      const lost =
        document.activeElement === cancelBtn ||
        document.activeElement === document.body ||
        !document.activeElement;
      if (stopping && (cancelFocused || document.activeElement === cancelBtn) && lost) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
      cancelBtn.hidden = stopping;
      cancelNote.hidden = stopping;
    }
    // C15: while running, the count glides to each new value (600ms --ease-out, tabular numerals) instead of jumping
    // 6 -> 13 -> 22. Reduced motion and every other state set the final text at once.
    if (!queued && !stopping) {
      let n = title.querySelector('.tnum');
      if (!n) {
        clear(title, (n = h('span.tnum', String(p.done))), h('span.tnum-rest'));
        n._v = p.done;
      }
      title.querySelector('.tnum-rest').textContent = ` of ${p.total} answers collected`;
      if (n._v !== p.done) {
        rollNumber(n, n._v, p.done);
        n._v = p.done;
      }
    } else
      title.textContent = queued
        ? `Queued, ${queuedText(p)}. Answers start arriving when it begins.`
        : `${p.done} of ${p.total} answers collected. Answers already collected are kept.`;
    setMeter(bar, p.total ? p.done / p.total : 0);
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
    bar.setAttribute('aria-valuenow', String(pct));
    const reached = [100, 75, 50, 25].find((m) => pct >= m) || 0;
    // D3: after a stop the cancelled slots count as "done" in the payload, so the line says how many answers were
    // actually collected instead of "All answers collected".
    const collected = p.engines.reduce(
      (a, e) => a + Math.max(0, (e.done || 0) - (e.failed || 0) - (e.skipped || 0)),
      0,
    );
    if (stopping) {
      if (milestone !== -1) {
        milestone = -1;
        if (!message)
          said.textContent = `Stopping. ${plural(collected, 'answer')} collected so far.`;
      }
    } else if (reached > milestone) {
      milestone = reached;
      said.textContent =
        reached === 100 ? 'All answers collected.' : `${reached}% of answers collected.`;
    }
    for (const e of p.engines) {
      if (!rows.has(e.id)) make(e);
      const r = rows.get(e.id);
      setMeter(r.row.querySelector('.meter'), e.total ? e.done / e.total : 0);
      // N5: while queued nothing is running yet, so engines read "Waiting" with no count.
      const state =
        e.done < e.total
          ? queued && !stopping
            ? 'queued'
            : stopping
              ? 'stopping'
              : 'running'
          : e.failed
            ? 'failed'
            : e.skipped === e.total
              ? 'skipped'
              : 'done';
      if (state === 'skipped' || state === 'queued') {
        r.count.textContent = '';
        r.count._n = null;
      } else {
        if (!r.count._n) {
          clear(r.count, (r.count._n = h('span.tnum', String(e.done))), h('span'));
          r.count._n._v = e.done;
        }
        r.count.lastChild.textContent = ` of ${e.total}`;
        if (r.count._n._v !== e.done) {
          rollNumber(r.count._n, r.count._n._v, e.done);
          r.count._n._v = e.done;
        }
      }
      if (state !== r.state) {
        r.state = state;
        r.row.dataset.state = state;
        const [label, ic] = EP_STATE[state];
        clear(
          r.pill,
          ic ? icon(ic, 14) : h('span.dot'),
          state === 'failed' ? `${e.failed} failed` : label,
        );
      }
    }
  };
  update(ctx.detail.running);
  ctx.progressListeners.add(update);
  return [
    h(
      'section.card.scan-card',
      xo('thinking', 'scan-xo'),
      h(
        'div.scan-card-body',
        eyebrow,
        heading,
        title,
        bar,
        said,
        list,
        h('div.scan-cancel', cancelBtn, cancelNote),
      ),
    ),
    scanGrid(ctx, ctx.detail.running),
  ];
}

// U1: the headline numeral rolls from the previous scan's value in 600ms with the --ease-out curve.
// rollNumber and easeOut live in lib.js (shared with the post-scan KPI count-ups).

// Time (0-1) at which the --ease-out curve reaches progress f: the line is drawn along that curve, so a dot or a
// fix marker appears exactly when the tip of the line passes it.
const easeTime = (f) => {
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (easeOut(mid) < f) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
};
const DRAW_MS = 600;
// Axis labels: dates when every scan is on its own day, otherwise "Scan N" (the tooltip still gives date and time).
export const scanAxisLabels = (scans) => {
  const days = scans.map((sc) => date(sc.finishedAt));
  return new Set(days).size === days.length
    ? days
    : scans.map((sc, i) => `Scan ${sc.number ?? i + 1}`);
};

function trendChart(detail, { replay = false } = {}) {
  // Scans with no returned answers (stopped before any came back) would plot a false 0; they are left out.
  const scans = detail.scans.filter((sc) => sc.ok > 0);
  const comparable = (scan) =>
    scan.comparisonToPrevious?.comparable === true && scan.configuration?.state === 'recorded';
  // Phones get a narrower drawing so labels stay readable.
  const narrow = innerWidth < 640;
  const W = narrow ? 360 : 640,
    H = narrow ? 230 : 240,
    P = { l: 30, r: narrow ? 14 : 20, t: 26, b: 36 };
  const { top: max, ticks } = niceTicks(Math.max(...scans.map((x) => x.ok), 1));
  // C5: points sit inset from the tick column and the right edge; gridlines still run the full plot width.
  const IN = narrow ? 16 : 20,
    X0 = P.l + IN,
    X1 = W - P.r - IN;
  const x = (i) => (scans.length === 1 ? (X0 + X1) / 2 : X0 + (i * (X1 - X0)) / (scans.length - 1));
  const y = (v) => P.t + (1 - v / max) * (H - P.t - P.b);
  // Draws once per route visit, never on polling; reduced motion and old browsers get the final state.
  const key = `${location.hash}|${detail.id}`;
  const animate =
    scans.length > 0 &&
    !reducedMotion() &&
    'IntersectionObserver' in window &&
    (replay || !drawnCharts.has(key));
  drawnCharts.add(key);
  const wrap = h('div.chart.trend', { class: animate ? 'draw' : '' });
  const tip = h('div.chart-tip', { role: 'status' });
  const svg = s('svg', {
    viewBox: `0 0 ${W} ${H}`,
    role: 'img',
    'aria-label': `Answers mentioning ${detail.name}: ${scans.map((sc) => `${date(sc.finishedAt)} ${sc.mentioned} of ${sc.ok}`).join(', ')}`,
  });
  for (const v of ticks)
    svg.append(
      s('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), class: 'grid' }),
      s('text', { x: P.l - 10, y: y(v) + 4, class: 'axis tick', 'text-anchor': 'end' }, String(v)),
    );
  const pts = scans.map((sc, i) => [x(i), y(sc.mentioned)]);
  // Progress along the whole line (0-1) at each point, so the separate comparable segments draw as one stroke.
  const cum = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum.at(-1) || 1;
  const frac = (i) => (pts.length < 2 ? 1 : cum[i] / total);
  const fracAtX = (px) => {
    if (pts.length < 2) return 1;
    for (let i = 1; i < pts.length; i++)
      if (px <= pts[i][0]) {
        const t = Math.max(0, (px - pts[i - 1][0]) / Math.max(1, pts[i][0] - pts[i - 1][0]));
        return (cum[i - 1] + t * (cum[i] - cum[i - 1])) / total;
      }
    return 1;
  };
  const at = (f) => Math.round(DRAW_MS * easeTime(Math.max(0, Math.min(1, f))));
  const lines = [];
  if (pts.length > 1) {
    let segment = [],
      from = 0;
    const drawSegment = (to) => {
      if (segment.length < 2) return;
      svg.append(
        s('path', {
          d: `M ${segment[0][0]} ${y(0)} ${segment.map((p) => `L ${p[0]} ${p[1]}`).join(' ')} L ${segment.at(-1)[0]} ${y(0)} Z`,
          class: 'area',
        }),
      );
      const line = s('polyline', {
        points: segment.map((p) => p.join(',')).join(' '),
        class: 'line',
        pathLength: '1',
      });
      svg.append(line);
      lines.push({ line, a: frac(from), b: frac(to) });
    };
    scans.forEach((scan, i) => {
      if (i && !comparable(scan)) {
        drawSegment(i - 1);
        segment = [];
        from = i;
      }
      segment.push(pts[i]);
    });
    drawSegment(scans.length - 1);
  }
  // Hidden until the chart is on screen: the dash pattern starts just past the end of each segment.
  if (animate)
    lines.forEach(({ line }) => {
      line.style.strokeDasharray = '1 2';
      line.style.strokeDashoffset = '1.01';
    });
  // B3: same-day rescans would repeat "24 Oct" under every point, so equal dates switch the axis to scan numbers.
  // Narrow charts with many scans label only the first, the last and every other point.
  const axisLabels = scanAxisLabels(scans);
  // N2: labels are thinned by measured width, at every size: first and last always show, a middle label only when it
  // clears its left neighbour and the last label by 8 units. 12px Inter ~ 7 units per character (estimate, padded).
  const anchorOf = (i) =>
    i === 0 && scans.length > 1
      ? 'start'
      : i === scans.length - 1 && scans.length > 1
        ? 'end'
        : 'middle';
  const extent = (i) => {
    const w = axisLabels[i].length * 7 + 4,
      px = pts[i][0],
      a = anchorOf(i);
    return a === 'start' ? [px, px + w] : a === 'end' ? [px - w, px] : [px - w / 2, px + w / 2];
  };
  const shownLabels = new Set(scans.length ? [0, scans.length - 1] : []);
  if (scans.length > 2) {
    let right = extent(0)[1];
    const stop = extent(scans.length - 1)[0];
    for (let i = 1; i < scans.length - 1; i++) {
      const [l, r] = extent(i);
      if (l >= right + 8 && r <= stop - 8) {
        shownLabels.add(i);
        right = r;
      }
    }
  }
  scans.forEach((sc, i) => {
    // A new baseline: one quiet rule halfway between the two scans, from the top of the plot to the axis.
    if (i && !comparable(sc)) {
      const mid = (pts[i - 1][0] + pts[i][0]) / 2;
      svg.append(s('line', { x1: mid, x2: mid, y1: P.t, y2: y(0), class: 'baseline' }));
    }
    if (shownLabels.has(i))
      svg.append(
        s(
          'text',
          { x: pts[i][0], y: H - 12, 'text-anchor': anchorOf(i), class: 'axis' },
          axisLabels[i],
        ),
      );
  });
  // C19: a quiet ceiling line names the most answers a scan can return, so the headroom above the line reads as intended.
  const ceiling = Math.max(...scans.map((sc) => sc.ok), 0);
  if (ceiling > 0 && y(ceiling) - P.t >= 0)
    svg.append(
      s('line', { x1: P.l, x2: W - P.r, y1: y(ceiling), y2: y(ceiling), class: 'ceiling' }),
      s(
        'text',
        { x: W - P.r, y: y(ceiling) - 6, 'text-anchor': 'end', class: 'axis ceiling-label' },
        `${ceiling} answers per scan`,
      ),
    );
  // Fix markers: a small square on the axis where each fix shipped.
  const t0 = scans[0]?.finishedAt,
    t1 = scans.at(-1)?.finishedAt;
  detail.doneMarkers.forEach((m, i) => {
    let mx;
    if (scans.length < 2 || m.doneAt >= t1)
      mx =
        scans.length < 2
          ? x(0) + 24
          : Math.min(W - P.r - 4, x(scans.length - 1) + 12 + (i % 3) * 12);
    else mx = x(0) + ((m.doneAt - t0) / Math.max(t1 - t0, 1)) * (x(scans.length - 1) - x(0));
    const g = s('g', { class: 'fix-marker', tabindex: '0' });
    // The marker drops onto the baseline when the line's tip passes its date.
    g.style.setProperty('--d', `${at(fracAtX(mx))}ms`);
    // N5: an invisible circle gives the 10-unit square a 44px touch area (sized in sizeHits below); visuals unchanged.
    g.append(
      s('title', {}, `Fix done ${date(m.doneAt)}: ${m.title}`),
      s('circle', { cx: mx, cy: y(0), r: 8, class: 'mhit' }),
      s('rect', { x: mx - 5, y: y(0) - 5, width: 10, height: 10, rx: 3 }),
    );
    svg.append(g);
  });
  // Dots pop as the tip reaches them, at least 80ms apart (less when there are many scans, so it never drags).
  const gap = Math.min(80, DRAW_MS / Math.max(1, scans.length));
  const dotAt = [];
  scans.forEach((sc, i) => dotAt.push(Math.max(at(frac(i)), i ? dotAt[i - 1] + gap : 0)));
  // "+N observed" bracket between the previous and the latest scan, only when the plotted counts agree with the
  // comparable delta (never a number the pill above does not also say).
  const last = scans.at(-1),
    prev = scans.at(-2);
  const observed =
    prev &&
    comparable(last) &&
    detail.comparisonAvailability?.comparable === true &&
    detail.delta != null &&
    detail.delta !== 0 &&
    last.mentioned - prev.mentioned === detail.delta
      ? detail.delta
      : null;
  if (observed != null) {
    const [x1, y1] = pts.at(-2),
      [x2, y2] = pts.at(-1),
      bx = x2 - 18;
    if (Math.abs(y2 - y1) >= 18 && bx - x1 > 24) {
      const label = deltaText(observed, prev, last);
      // R2-5/N3: the text needs its own clear space left of the bracket; on phones (and whenever it would touch the
      // line) it is removed and the delta pill above the chart carries the number.
      const fits = !narrow && bx - 8 - (label.length * 7 + 4) > (x1 + x2) / 2 + 8; // left edge stays right of the line at mid-height
      const b = s(
        'g',
        { class: 'bracket', 'aria-hidden': 'true' },
        s('line', { x1, x2: bx, y1, y2: y1, class: 'bracket-guide' }),
        s('path', { d: `M ${bx + 5} ${y1} H ${bx} V ${y2} H ${bx + 5}`, class: 'bracket-line' }),
        fits
          ? s(
              'text',
              { x: bx - 8, y: (y1 + y2) / 2 + 4, 'text-anchor': 'end', class: 'bracket-label' },
              label,
            )
          : null,
      );
      b.style.setProperty('--d', `${dotAt.at(-1) + 240}ms`);
      svg.append(b);
    }
  }
  // R11: when points are under 24 units apart (phones, long histories) every value label collided ("3 3 3 3"); there
  // only the first, last and turning points keep a label. Every value stays in the tooltip and the svg label.
  const dense = pts.length > 1 && pts[1][0] - pts[0][0] < 24;
  const labelled = (i) => {
    if (!dense || i === 0 || i === scans.length - 1) return true;
    const v = scans[i].mentioned,
      p = scans[i - 1].mentioned,
      n = scans[i + 1].mentioned;
    return v !== p && (v - p) * (n - v) <= 0;
  };
  scans.forEach((sc, i) => {
    const g = s('g', { class: 'point', tabindex: '0' });
    g.style.setProperty('--d', `${dotAt[i]}ms`);
    const show = () => {
      tip.textContent = `${axisLabels[i].startsWith('Scan') ? `${axisLabels[i]} · ${date(sc.finishedAt, true)}` : date(sc.finishedAt)} · ${sc.mentioned} of ${sc.ok} answers${comparisonReasons(sc.comparisonToPrevious).length ? ` · New baseline: ${comparisonReasons(sc.comparisonToPrevious).join(' ')}` : ''}`;
      const box = wrap.getBoundingClientRect();
      tip.style.transform = `translate(${Math.max(0, Math.min(box.width - 170, (pts[i][0] / W) * box.width - 85))}px, ${(pts[i][1] / H) * box.height - 52}px)`;
      tip.classList.add('on');
    };
    const hide = () => tip.classList.remove('on');
    // D4: on touch, pointerleave fires right after the tap and hid the tip at once; touch tips close on blur instead.
    g.addEventListener('pointerenter', show);
    g.addEventListener('focus', show);
    g.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') hide();
    });
    g.addEventListener('blur', hide);
    // D4: nearest-point hit testing. Each point owns the column from the midpoint with its left neighbour to the
    // midpoint with its right one, over the plot height, so dense charts never split taps into 20px slivers and a
    // tap anywhere picks the closest scan. The circle stays as the keyboard focus ring only (no pointer events).
    const left = i ? (pts[i - 1][0] + pts[i][0]) / 2 : P.l - 8,
      right = i < pts.length - 1 ? (pts[i][0] + pts[i + 1][0]) / 2 : W - P.r + 8;
    g.append(
      s('rect', {
        x: left,
        y: P.t - 22,
        width: Math.max(1, right - left),
        height: H - P.b - P.t + 22,
        class: 'col',
      }),
      s('circle', { cx: pts[i][0], cy: pts[i][1], r: 16, class: 'hit' }),
      s('circle', { cx: pts[i][0], cy: pts[i][1], r: 6, class: 'dot' }),
      labelled(i)
        ? s(
            'text',
            { x: pts[i][0], y: pts[i][1] - 14, 'text-anchor': 'middle', class: 'val' },
            String(sc.mentioned),
          )
        : null,
    );
    svg.append(g);
  });
  // The fix markers sit on the baseline (y = 0); painted after the points so their 44px circle stays whole.
  svg.querySelectorAll('.fix-marker').forEach((m) => svg.append(m));
  // Two points are a comparison, not a trend; one point is a baseline.
  const note =
    scans.length && scans.length <= 2
      ? h('p.chart-note.muted.small', icon('info', 14), 'Add a scan to see a trend.')
      : null;
  wrap.append(svg, tip);
  if (note) wrap.append(note);
  // N5: hit areas are in viewBox units, so a phone (svg narrower than W) shrank them below 44px. Re-size them to
  // 46px / 44px on screen whenever the chart's width changes. Only the invisible circles change.
  const sizeHits = () => {
    const w = svg.getBoundingClientRect().width;
    if (!w) return;
    const k = W / w;
    svg
      .querySelectorAll('.point .hit')
      .forEach((c) => c.style.setProperty('r', `${Math.max(16, 23 * k)}px`));
    svg
      .querySelectorAll('.mhit')
      .forEach((c) => c.style.setProperty('r', `${Math.max(8, 22 * k)}px`));
  };
  if ('ResizeObserver' in window) new ResizeObserver(sizeHits).observe(svg);
  else requestAnimationFrame(sizeHits);
  if (animate) {
    // The line follows the --ease-out curve across all segments: each segment's dash offset is sampled from
    // the one global curve (16 steps), so the tip never changes speed at a segment break.
    const play = () => {
      wrap.classList.add('go');
      for (const { line, a, b } of lines) {
        const frames = Array.from({ length: 17 }, (_, k) => {
          const p = easeOut(k / 16),
            local = b > a ? Math.max(0, Math.min(1, (p - a) / (b - a))) : 1;
          return { strokeDashoffset: String(local >= 1 ? 0 : 1.01 - local * 1.01), offset: k / 16 };
        });
        const anim = line.animate?.(frames, {
          duration: DRAW_MS,
          easing: 'linear',
          fill: 'forwards',
        });
        const settle = () => {
          line.style.strokeDasharray = '';
          line.style.strokeDashoffset = '';
          anim?.cancel();
        };
        if (anim) anim.onfinish = settle;
        else settle();
        // Paused timelines (hidden tab) must not leave the line invisible.
        setTimeout(settle, DRAW_MS + 400);
      }
    };
    // Final state without scrolling: automated screenshots (webdriver), printing, and a tab rendered in the background.
    const finish = () => {
      io.disconnect();
      wrap.classList.add('go', 'done');
      lines.forEach(({ line }) => {
        line.style.strokeDasharray = '';
        line.style.strokeDashoffset = '';
      });
    };
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        removeEventListener('beforeprint', finish);
        play();
      },
      { threshold: 0.35 },
    );
    if (navigator.webdriver === true || document.visibilityState === 'hidden') finish();
    else {
      io.observe(wrap);
      addEventListener('beforeprint', finish, { once: true });
    }
  }
  return wrap;
}

export async function renderOverview(el, ctx) {
  const d = ctx.detail;
  const blocks = [];
  // Xo drafts waiting for approval (M2.2): fetched alongside, shown once the result and next step are on screen.
  const pendingReq = d.latest ? pendingFor(d.id) : null;
  const firstClient = takeFirstClient(d.id);
  if (d.running) blocks.push(...progressCard(ctx));
  if (!d.questions.filter((q) => q.active).length) {
    blocks.push(
      emptyState({
        pose: 'thinking',
        title: 'Pick the questions their customers actually ask',
        text: `Each question is asked to ${d.engines.length} engines. Only connected engines return answers.`,
        actions: [h('a.btn', { href: `#/clients/${d.id}/questions` }, 'Pick questions')],
      }),
    );
    return clear(el, blocks);
  }
  if (!d.latest) {
    if (!d.running)
      blocks.push(
        emptyState({
          pose: firstClient ? 'waving' : 'curious',
          title: 'Run the first scan',
          text: `${plural(d.questions.filter((q) => q.active).length, 'question')} across ${d.engines.length} engines. Connected engines determine how many answers return.`,
          actions: [
            button('Run first scan', { onclick: (e) => ctx.startScan(e.currentTarget) }, 'play'),
          ],
        }),
      );
    return clear(el, blocks);
  }

  const L = d.latest;
  const unavailable = d.comparisonAvailability?.comparable !== true;
  const comparisonIssues = comparisonReasons(d.comparisonAvailability);
  // The reveal is handed over by client.js only when a scan finished while this tab was watching it.
  // R3-4: ids are compared as strings, and a watched FIRST scan always matches the only scan (the wizard's first scan
  // could arrive under a different id shape and silently skip the reveal).
  const isWatched = (r) =>
    !!r && (String(r.scanId) === String(d.latestScanId) || (r.first && d.scans.length === 1));
  const reveal = isWatched(ctx.reveal) && L.ok ? ctx.reveal : null;
  if (reveal) reveal.used = true;
  const stopped = wasStopped(d.latestScanId);
  // N4: an empty latest scan (stopped before any answer, or none came back) never becomes a "0 of 0" headline.
  const empty = !L.ok;
  // U5 failed scan: when a scan the user watched ends with answers missing (not a stop), Xo looks uneasy once,
  // in the notice or the empty card. A result reaction (cheer / nod) takes precedence: one Xo per screen.
  const justFinished = isWatched(ctx.reveal) ? ctx.reveal : null;
  if (justFinished && empty) justFinished.used = true; // the empty card says it; no "0 of 0" toast
  const uneasyXo = () => {
    if (!justFinished || stopped || !d.failed || ctx.reveal?.xoShown) return null;
    if (!reactionReady()) return null;
    justFinished.xoShown = true;
    const x = createXo({ mood: 'uneasy' }).el;
    x.classList.add('notice-xo');
    return x;
  };
  const lastWithAnswers = empty
    ? [...d.scans].reverse().find((sc) => sc.ok > 0 && sc.number !== L.number)
    : null;
  const retry = (label = 'Retry now', variant = 'secondary') =>
    button(
      label,
      {
        variant,
        size: 'sm',
        onclick: (e) =>
          busy(e.currentTarget, async () => {
            try {
              ctx.detail.running = await api(`/api/app/scans/${d.latestScanId}/retry`, {
                method: 'POST',
              });
              await ctx.refresh();
            } catch (err) {
              errorToast(err);
            }
          }),
      },
      'refresh',
    );
  const resultReaction =
    reveal && (reveal.first || (d.delta != null && !unavailable && d.delta >= 0)); // cheer / nod own the slot
  const noticeXo = d.failed && !empty && !resultReaction ? uneasyXo() : null;
  if (d.failed && d.status !== 'archived' && !empty)
    blocks.push(
      h(
        'div.notice',
        { class: noticeXo ? 'has-xo' : '' },
        noticeXo || icon(stopped ? 'stop' : 'alert'),
        h(
          'p',
          stopped
            ? `You stopped this scan. ${plural(d.failed, 'answer was', 'answers were')} not collected and ${d.failed === 1 ? 'doesn’t' : 'don’t'} count towards the total.`
            : `${plural(d.failed, 'answer')} didn’t come back in the last scan. Those cells show as failed and don’t count towards the total.`,
        ),
        retry(stopped ? 'Collect the rest' : 'Retry now'),
      ),
    );

  if (d.skipped)
    blocks.push(
      h(
        'div.notice.notice-soft',
        icon('info'),
        h(
          'p',
          `${plural(d.skipped, 'answer')} in the last scan came from engines that aren’t connected. They don’t count towards the total.`,
        ),
        h('a.btn.btn-secondary.btn-sm', { href: '#/engines' }, h('span', 'See engines')),
      ),
    );

  // One clear next step, so nobody has to work out what to do from the numbers.
  const K = d.kpis;
  const lastFixDone = Math.max(0, ...d.doneMarkers.map((m) => m.doneAt));
  const archived = d.status === 'archived';
  // A diagnostic (the website could not be inspected) or a Low-impact, Weak-evidence fix is never the headline next step;
  // the answers that miss the client are the more useful first move.
  const topFix =
    d.topFix &&
    !isDiagnostic(d.topFix) &&
    !(d.topFix.impact === 'Low' && d.topFix.evidence === 'Weak')
      ? d.topFix
      : null;
  const missed = Math.max(0, L.ok - L.mentioned);
  const reviewMissed = () => {
    presetAnswersFocus('missed');
  };
  const openFixes = Number(d.fixes?.todo) || 0;
  const fixesSeen = (() => {
    try {
      return localStorage.getItem(`xaeo-fixes-seen:${d.id}`) === '1';
    } catch {
      return true;
    }
  })();
  // U08: answers that miss the client outrank "Send the report" until the agency has opened the Answers tab for this
  // client's latest scan (answers.js), so a client named in 1 of 15 answers is never told "nothing to fix, send it".
  // Fixes marked done after the last scan still put the rescan first.
  const reviewFirst =
    missed > 0 && (d.topFix || !answersSeen.has(d.id, L.number)) && !(lastFixDone > L.finishedAt);
  // F1-12: phones and tablets get the desktop "Ask Xo to draft it" as the step's quiet second way on (same .next-alt).
  const draftIt = (f) =>
    xoAvailable()
      ? {
          label: 'Ask Xo to draft it',
          run: (e) =>
            askXo(
              `Draft the fix “${f.title}” for ${d.name}, ready for me to review.`,
              e.currentTarget,
              { send: true },
            ),
        }
      : null;
  const askWhy = () =>
    xoAvailable()
      ? {
          label: 'Ask Xo why',
          run: (e) =>
            askXo(
              `Why do ${plural(missed, 'answer')} miss ${d.name}, and who do the engines name instead?`,
              e.currentTarget,
              { send: true },
            ),
        }
      : null;
  const step = d.running
    ? null
    : archived
      ? {
          icon: 'archive',
          eyebrow: 'Archived',
          title: 'This client is archived',
          text: 'History stays readable. Unarchive to scan again and turn weekly rescans back on.',
          action: link('Unarchive in settings', `#/clients/${d.id}/settings`, {}, 'undo'),
        }
      : !L.ok && d.skipped
        ? {
            eyebrow: 'Next step',
            title: 'Connect an AI engine',
            text: 'No engine answered the last scan because none is connected. Add an API key, then rescan.',
            action: link('See engines', '#/engines', {}, 'zap'),
          }
        : // D5: a scan with no answers has nothing to report or fix; its own card carries the one action (collect / retry).
          empty
          ? null
          : topFix
            ? {
                eyebrow: 'Next step',
                title: topFix.title,
                text: topFix.gain
                  ? `Linked to ${plural(topFix.gain, 'currently missed answer')}. Review the proposed change, then rescan to see what actually changed.`
                  : 'Review this proposal against website evidence. Later scans can show answer changes.',
                action: link('Open the fix', `#/clients/${d.id}/fixes`, {}, 'zap'),
                alt: draftIt(topFix),
              }
            : // R3-8: open fixes outrank the report. Until the agency has opened the Fixes tab for this client, the next step
              // is the first open fix, not "Send the report".
              openFixes && !fixesSeen
              ? {
                  eyebrow: 'Next step',
                  title: `Review fix 1 of ${openFixes}`,
                  text: 'Each fix shows the answers it is linked to and the exact change to make. Review it before you send the report.',
                  action: link('Open the fix', `#/clients/${d.id}/fixes`, {}, 'zap'),
                }
              : reviewFirst
                ? {
                    icon: 'search',
                    eyebrow: 'Next step',
                    title: `Review the ${plural(missed, 'answer')} that miss ${d.name}`,
                    short: `Review ${plural(missed, 'missed answer')}`,
                    text: 'See what the engines say instead and which businesses they name.',
                    action: link(
                      'See the answers',
                      `#/clients/${d.id}/answers`,
                      { onclick: reviewMissed },
                      'arrowRight',
                    ),
                    alt: askWhy(),
                  }
                : lastFixDone > L.finishedAt
                  ? {
                      eyebrow: 'Next step',
                      title: 'Rescan to check the answers',
                      text: 'Fixes were marked done after the last scan. Compare the next answers with the earlier ones; this does not verify the website change or prove its effect.',
                      action: button(
                        'Run a rescan',
                        {
                          dataset: { step: 'rescan' },
                          onclick: (e) => ctx.startScan(e.currentTarget),
                        },
                        'refresh',
                      ),
                    }
                  : !d.reports
                    ? {
                        eyebrow: 'Next step',
                        title: 'Send the report',
                        text: `White‑label, in your brand. It shows ${d.name} what the engines say and what you’re fixing.`,
                        action: link(
                          'Export the report',
                          `#/clients/${d.id}/reports`,
                          {},
                          'download',
                        ),
                      }
                    : {
                        icon: 'check',
                        eyebrow: 'All caught up',
                        title: 'Nothing to do until the next rescan',
                        text: d.nextRunAt
                          ? `The next rescan runs ${zonedParts(d.nextRunAt, state.me?.workspace?.timezone).day} at ${zonedParts(d.nextRunAt, state.me?.workspace?.timezone).time}.`
                          : state.me?.rescansPaused
                            ? 'Weekly rescans are paused for now. Run a scan when you’re ready.'
                            : 'Weekly rescans are off. Run a scan when you’re ready.',
                        action: null,
                      };
  const stepBlock = step
    ? h(
        'section.next-step',
        { dataset: { tour: 'next-step' } },
        h('span.next-step-icon', { 'aria-hidden': 'true' }, icon(step.icon || 'zap', 22)),
        h(
          'div.next-copy',
          h('p.eyebrow', step.eyebrow),
          h(
            'h2',
            h('span.next-title-full', step.title),
            step.short ? h('span.next-title-short', step.short) : null,
          ),
          h('p.muted', step.text),
          step.alt
            ? h(
                'button.linkish.next-alt',
                { type: 'button', onclick: step.alt.run },
                icon('message', 15),
                step.alt.label,
              )
            : null,
        ),
        step.action,
      )
    : null;
  // First scan: the result is the moment, so the number comes first and the next step follows it.
  // A finished-scan reveal also puts the number first, so on phones the roll happens where the user is looking (M1).
  const firstScan = d.scans.length === 1;
  const resultFirst = firstScan || !!reveal;
  if (stepBlock && !resultFirst) blocks.push(stepBlock);

  const est = d.estimate;
  const comparableDelta = d.delta !== null && d.delta !== undefined && !unavailable;
  const prevDone = d.scans.length > 1 ? d.scans[d.scans.length - 2] : null; // the scan d.delta compares against
  const bigNum = countUp(h('span.big'), L.mentioned);
  // R3-4: a watched first scan gets its own pill (the numeral above already says "N of 25"): a baseline, observed.
  const deltaPill = reveal?.first
    ? h('p.delta-pill.first', icon('check', 14), 'First scan · your baseline')
    : comparableDelta
      ? h(
          `p.delta-pill${d.delta > 0 ? '.up' : d.delta < 0 ? '.down' : ''}`,
          icon(d.delta > 0 ? 'trending' : d.delta < 0 ? 'trendingDown' : 'minus', 14),
          deltaText(d.delta, prevDone, L),
        )
      : d.scans.length > 1
        ? h('p.delta-pill', icon('info', 14), 'New baseline · review comparison limits below')
        : null;
  const linked = est && d.fixes.todo ? est.projected - est.current : 0;
  // The delta's hedge lives in the headline help tip (DELTA_HEDGE); the line below only appears for linked (estimated) answers.
  const caveat = linked
    ? `${plural(linked, 'missed answer is', 'missed answers are')} linked to open fixes. Rescan to measure any change.`
    : null;
  const best = [...d.engines]
    .filter((e) => e.ok)
    .sort((a, b) => b.mentioned / b.ok - a.mentioned / a.ok)[0];
  // U1 reveal: Xo cheers when the comparable number went up, nods when flat, stays away when it went down.
  // R3-4: the first scan reacts too: cheer when any answer mentions the client, a calm nod at 0.
  const mood = !reveal
    ? null
    : reveal.first
      ? L.mentioned > 0
        ? 'cheer'
        : 'nod'
      : comparableDelta
        ? d.delta > 0
          ? 'cheer'
          : d.delta === 0
            ? 'nod'
            : null
        : null;
  const revealXo = mood && reactionReady() ? createXo({ mood }).el : null;
  if (revealXo) revealXo.classList.add('reveal-xo');
  const seeChanges =
    reveal && comparableDelta && d.delta < 0
      ? button(
          'See what changed',
          {
            variant: 'secondary',
            size: 'sm',
            class: 'see-changes',
            onclick: () => {
              const target = el.querySelector('.changes h2');
              if (!target) return;
              target.tabIndex = -1;
              target.focus({ preventScroll: true });
              target
                .closest('.card')
                ?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
            },
          },
          'arrowDown',
        )
      : null;
  const revealSaid = reveal ? h('p.visually-hidden', { role: 'status' }) : null;
  if (desk.matches && !empty) return deskOverview();
  const headline = empty
    ? h(
        'section.card.headline.headline-empty',
        {
          dataset: { tour: 'headline' },
          class: justFinished && !stopped && d.failed ? 'has-xo' : '',
        },
        justFinished && !stopped && d.failed ? uneasyXo() : null,
        h(
          'div.headline-main',
          h('p.eyebrow', `Scan ${L.number} · ${date(L.finishedAt, true)}`),
          h(
            'h2.headline-empty-title',
            stopped
              ? 'You stopped this scan before any answer came back'
              : 'No answers came back in this scan',
          ),
          h(
            'p.muted',
            lastWithAnswers
              ? `The latest result with answers is scan ${lastWithAnswers.number} (${date(lastWithAnswers.finishedAt)}): ${lastWithAnswers.mentioned} of ${lastWithAnswers.ok} answers name ${d.name}.`
              : `Nothing was counted, so there is no result for ${d.name} yet.`,
          ),
          d.failed && d.status !== 'archived'
            ? h('div.row', retry(stopped ? 'Collect the answers' : 'Retry now', null))
            : null,
          justFinished
            ? ((n) => {
                setTimeout(() => {
                  n.textContent = `Scan ${L.number} finished. No answers came back.`;
                }, 150);
                return n;
              })(h('p.visually-hidden', { role: 'status' }))
            : null,
        ),
      )
    : h(
        'section.card.headline',
        { dataset: { tour: 'headline' }, class: reveal ? 'revealing' : '' },
        h(
          'div.headline-main',
          h('p.eyebrow', `Scan ${L.number} · ${date(L.finishedAt, true)}`),
          h('p.headline-num', bigNum, h('span.headline-of', ` of ${L.ok}`), revealXo),
          h(
            'p.headline-text',
            'answers name ',
            h('strong', d.name),
            hint(
              `Each buyer question is asked to ${d.engines.length} engines; only returned answers count here. Named means the answer names ${d.name}; Named + linked also links to ${d.domain}.${comparableDelta ? ' ' + DELTA_HEDGE : ''}`,
            ),
          ),
          deltaPill,
          seeChanges,
          revealSaid,
          caveat
            ? h(
                'p.caveat',
                h('span', caveat),
                hint(
                  'One comparison can vary. Repeat scans under the same setup to see whether a change lasts. Linked answers are an estimate, not a promise of mentions.',
                ),
              )
            : null,
        ),
        h(
          'div.engine-bars',
          h(
            'p.engine-bars-title',
            'By engine',
            best && best.mentioned ? h('span.muted', ` · strongest on ${best.name}`) : null,
          ),
          // On a reveal the bars glide from the previous scan's share instead of growing from zero.
          d.engines.map((e) =>
            h(
              'div.engine-bar',
              { class: !e.ok ? 'off' : '' },
              h('span.name', e.name),
              meter(
                e.ok ? e.mentioned / e.ok : 0,
                '',
                reveal && !reveal.first ? (reveal.engines[e.id] ?? 0) : null,
              ),
              h('span.num', e.ok ? `${e.mentioned} of ${e.ok}` : '-'),
            ),
          ),
        ),
      );
  blocks.push(headline);
  // C7 sizes: 72px Xo beside the number, 96px when the observed gain is 3 or more.
  if (revealXo && d.delta >= 3) revealXo.classList.add('reveal-xo-lg');
  if (reveal) {
    // The roll starts after the card is in view (see the end of this function); until then it shows the old value.
    bigNum.textContent = String(reveal.first ? 0 : reveal.from);
    const change = reveal.first
      ? ' First scan: this observed result is the baseline later scans compare against.'
      : comparableDelta
        ? ` ${deltaText(d.delta, prevDone, L)}.`
        : '';
    // Filled after the region is in the page, so screen readers announce it.
    setTimeout(() => {
      revealSaid.textContent = `Scan ${L.number} finished. ${L.mentioned} of ${L.ok} answers name ${d.name}.${change}`;
    }, 150);
  }
  if (stepBlock && resultFirst) blocks.push(stepBlock);
  // One caveat surface: chips + "About this scan" (P1-8). The full wording stays inside the disclosure.
  blocks.push(
    caveatRow({
      configuration: d.latestConfiguration,
      comparison: d.comparisonAvailability,
      early: d.delta !== null && !unavailable,
      comparableText:
        'Comparable with the previous scan. This does not prove a website change caused the answer difference. One comparison can vary; repeat scans under the same setup to see whether a change lasts.',
      baselineText: 'This scan is a new baseline; a headline comparison is unavailable.',
    }),
  );
  const pending = await pendingReq;
  if (pending?.approvals?.some((r) => r.status === 'pending'))
    blocks.push(pendingBlock(d.id, pending));

  if (!empty)
    blocks.push(
      h(
        'div.stat-tiles.kpis',
        { dataset: { tour: 'kpis' } },
        statTile({
          i: 0,
          label: 'Named + linked',
          help: `Answers that name ${d.name} and link to ${d.domain}. The engine used the client’s own page, which is the strongest result.`,
          count: K.cited,
          from: reveal && !reveal.first ? (reveal.kpis?.cited ?? null) : null,
          delay: 600,
          sub: `of ${K.ok} answers link to ${d.domain}`,
          visual: ring(K.ok ? K.cited / K.ok : 0, { size: 62 }),
        }),
        statTile({
          i: 1,
          label: 'Spot when named',
          help: 'When an answer lists several businesses, this is where the client usually appears. #1 means first in the list.',
          value: K.avgPosition ? `#${K.avgPosition}` : '-',
          sub: K.firstPlace
            ? `Listed first in ${plural(K.firstPlace, 'answer')}`
            : K.avgPosition
              ? 'Not listed first yet'
              : 'Not named yet',
        }),
        statTile({
          i: 2,
          label: 'Top competitor',
          help: 'The business the engines name most often in these answers.',
          value: K.topRival ? K.topRival.name : '-',
          sub: K.topRival
            ? `Named in ${plural(K.topRival.count, 'answer')}, ${d.name} in ${K.mentioned}`
            : 'No competitors named',
          tone: 'text',
        }),
        statTile({
          i: 3,
          label: 'Fixes marked done',
          help: 'Agency-reported completion, not an independent website check. A later rescan can show whether targeted answers changed.',
          value: `${K.fixesDone}`,
          sub: K.fixesTotal ? `of ${plural(K.fixesTotal, 'fix', 'fixes')}` : 'No fixes yet',
        }),
      ),
    );

  const comparison = unavailable ? null : d.comparison;
  const allChanges = unavailable
    ? []
    : [
        ...d.changes.gained.map((c) => ({ ...c, up: true })),
        ...d.changes.lost.map((c) => ({ ...c, up: false })),
      ];
  const changed = allChanges.length;
  const changeIds = allChanges.map((c) => c.answerId);
  // D5: with no scan that returned answers there is nothing to plot, compare or rank.
  const plottable = d.scans.some((sc) => sc.ok > 0);
  // R14: the divider sentence (and its hint) only when the chart really draws a divider; day 1 has one scan and none.
  const plotted = d.scans.filter((sc) => sc.ok > 0);
  const divided = plotted.some(
    (sc, i) =>
      i &&
      !(sc.comparisonToPrevious?.comparable === true && sc.configuration?.state === 'recorded'),
  );
  const DIVIDER_NOTE =
    'Lines connect comparable scans only; a dashed divider marks an incompatible or unknown saved setup or answer coverage.';
  if (plottable)
    blocks.push(
      h(
        'div.grid-2.grid-wide.align-start',
        // R3 removal: phones keep the first legend sentence; the rest sits behind the "?" (shown on phones only).
        h(
          'section.card',
          { dataset: { tour: 'trend' } },
          h(
            'div.card-head',
            h(
              'h2',
              'Named answers over time',
              divided ? h('span.legend-hint', hint(DIVIDER_NOTE)) : null,
            ),
            h('span.muted.small', plural(d.scans.length, 'scan')),
          ),
          // D5: the lead sentence is short enough for one line at 320 (~37 characters at 13px in a ~250px card).
          h(
            'p.muted.small.trend-legend',
            'Green squares mark fixes marked done.',
            divided
              ? h('span.legend-more', ` ${DIVIDER_NOTE}`)
              : plotted.length > 1
                ? ' Lines connect comparable scans.'
                : null,
          ),
          trendChart(d, { replay: !!reveal }),
        ),
        h(
          'section.card.changes',
          h(
            'div.card-head',
            h('h2', 'What changed'),
            comparison
              ? h('span.muted.small', `${comparison.matchedPairs} matched question–engine pairs`)
              : null,
          ),
          d.scans.length < 2
            ? h(
                'div.changes-empty',
                d.running || revealXo ? null : xo('curious', 'mini-xo'),
                h('p.muted', 'The next scan shows what changed. Rescans run every Monday.'),
              )
            : !changed
              ? h(
                  'div.changes-empty',
                  d.running || revealXo ? null : xo('happy', 'mini-xo'),
                  h(
                    'p.muted',
                    comparison
                      ? 'No matched answers changed since the previous scan.'
                      : 'New baseline: the previous scan is not comparable.',
                  ),
                )
              : h(
                  'ul.change-list',
                  allChanges.map((c) =>
                    h(
                      'li',
                      h(
                        'button.change-row',
                        { type: 'button', onclick: () => openAnswer(c.answerId, changeIds) },
                        h(
                          `span.change-mark.${c.up ? 'up' : 'down'}`,
                          icon(c.up ? 'arrowUp' : 'arrowDown', 14),
                        ),
                        h('span.change-text', h('strong', c.engine), h('span', `“${c.question}”`)),
                        h('span.change-label', c.up ? 'Now mentioned' : 'Dropped'),
                      ),
                    ),
                  ),
                ),
          h(
            'p.muted.small',
            comparison
              ? `${comparison.matchedPairs} pairs answered both times, from ${comparison.previousOk} earlier and ${comparison.currentOk} now.${comparison.complete ? '' : ' Coverage changed, so no headline trend is shown.'} These observations do not prove what caused a change.`
              : comparisonIssues.join(' ') ||
                  'Changes require compatible saved setups, reported models, collection methods and answer coverage.',
          ),
          h(
            'p.changes-foot',
            icon('calendar', 16),
            d.nextRunAt
              ? h(
                  'span',
                  'Next rescan ',
                  h('strong', zonedParts(d.nextRunAt, state.me?.workspace?.timezone).day),
                  `, ${zonedParts(d.nextRunAt, state.me?.workspace?.timezone).time}`,
                )
              : h(
                  'span',
                  state.me?.rescansPaused
                    ? 'Weekly rescans are paused for now. Run a scan when you’re ready.'
                    : 'Weekly rescans are off. Turn them on in Settings.',
                ),
          ),
        ),
      ),
    );

  const rows = [
    ...d.competitors.slice(0, 6).map((c) => ({ name: c.name, value: c.count })),
    { name: d.name, value: L.mentioned, highlight: true, tag: 'Your client' },
  ].sort((a, b) => b.value - a.value || (b.highlight ? 1 : -1));
  const rank = rows.findIndex((r) => r.highlight) + 1;
  const maxC = Math.max(...rows.map((r) => r.value), 1);
  // C17: competitors and sources are reference detail, so they sit in one collapsed row below the first scroll.
  if (!empty)
    blocks.push(
      h(
        'details.more-detail',
        h(
          'summary.more-detail-head',
          h(
            'span',
            h('strong', 'More detail'),
            h('span.muted', ' · who the engines recommend and the sources they cite'),
          ),
          icon('chevronDown', 18),
        ),
        h(
          'div.grid-2',
          h(
            'section.card',
            h(
              'div.card-head',
              h('h2', 'Who the engines recommend'),
              hint(
                'How many answers in the latest scan name each business. Your client is highlighted, so you can see where they rank.',
              ),
            ),
            h(
              'p.muted.small',
              rank && rows.length > 1
                ? `${d.name} ranks #${rank} of ${rows.length} by answers.`
                : 'Businesses the engines named in the latest scan.',
            ),
            barList(rows, { max: maxC, format: (r) => plural(r.value, 'answer') }),
          ),
          h(
            'section.card',
            h(
              'div.card-head',
              h('h2', 'Sources the engines cite'),
              hint(
                'The websites the engines used for these answers. Listings and review sites that show up often are worth claiming and keeping up to date.',
              ),
            ),
            h('p.muted.small', 'Where the answers got their information.'),
            h(
              'ul.source-table',
              d.sources.map((x) =>
                h(
                  'li',
                  h('span.bar-name', { title: x.name }, x.name),
                  x.kind === 'Client site'
                    ? h('span.kind.kind-client', x.kind)
                    : h('span.kind', x.kind),
                  h('span.num', plural(x.count, 'answer')),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  clear(el, blocks);
  if (reveal)
    startReveal(
      headline,
      bigNum,
      reveal.first ? 0 : reveal.from,
      L.mentioned,
      reveal.first ? L.mentioned > 0 : comparableDelta && d.delta > 0,
    );

  // ---- A+ desktop overview (>=1024px). Same data and states as above, arranged as: a cobalt scan band with the
  // "Do this next" card, then the fixes table beside a side column (named instead, new since, scans), the trend and
  // the reference detail. No per-metric (?) here: one "How answers and fixes are measured" link carries the method.
  async function deskOverview() {
    const fixesReq = api(`/api/app/clients/${d.id}/fixes`).catch(() => null);
    const plotted = d.scans.filter((sc) => sc.ok > 0);
    const plottable = plotted.length > 0;
    const comparison = unavailable ? null : d.comparison;
    const allChanges = unavailable
      ? []
      : [
          ...d.changes.gained.map((c) => ({ ...c, up: true })),
          ...d.changes.lost.map((c) => ({ ...c, up: false })),
        ];
    const changed = allChanges.length,
      changeIds = allChanges.map((c) => c.answerId);
    const divided = plotted.some(
      (sc, i) =>
        i &&
        !(sc.comparisonToPrevious?.comparable === true && sc.configuration?.state === 'recorded'),
    );
    const DIVIDER_NOTE =
      'Lines connect comparable scans only; a dashed divider marks an incompatible or unknown saved setup or answer coverage.';
    const prevScan = plotted.length > 1 ? plotted[plotted.length - 2] : null;
    // U15: the band says the count; the change sits under it in the one shared wording, its hedge in the (?) tip.
    const sentence = reveal?.first
      ? `answers name ${d.name}. This first scan is the baseline.`
      : `answers name ${d.name}.`;
    const bandDelta =
      !reveal?.first && comparableDelta
        ? h(
            'p.band-delta',
            icon(d.delta > 0 ? 'trending' : d.delta < 0 ? 'trendingDown' : 'minus', 16),
            h('span', deltaText(d.delta, prevDone, L)),
            hint(DELTA_HEDGE, 'About this change.'),
          )
        : null;
    const engines = h(
      'dl.band-engines',
      d.engines.map((e) =>
        h(
          'div.band-engine',
          { class: !e.ok ? 'off' : '' },
          h('dt', e.name),
          h(
            'dd',
            e.ok
              ? h(
                  'span.band-dots',
                  { 'aria-hidden': 'true' },
                  Array.from({ length: e.ok }, (_, i) =>
                    h('span', { class: i < e.mentioned ? 'on' : '' }),
                  ),
                )
              : null,
            h('span.band-of', e.ok ? `${e.mentioned} of ${e.ok}` : 'No answers'),
          ),
        ),
      ),
      h(
        'div.band-engine.band-cited',
        h('dt', 'Named + linked'),
        h(
          'dd',
          h('strong.band-cited-num', String(K.cited)),
          h('span.band-of', K.cited === 1 ? 'answer links the site' : 'answers link the site'),
        ),
      ),
    );
    const band = h(
      'section.ov-band.headline',
      {
        dataset: { tour: 'headline' },
        class: reveal ? 'revealing' : '',
        'aria-labelledby': 'ov-band-title',
      },
      h(
        'div.band-main',
        h('p.band-eyebrow', `Scan ${L.number} · ${date(L.finishedAt, true)}`),
        h(
          'h2.band-title#ov-band-title',
          h('span.band-num', bigNum, h('span.band-of-total', ` of ${L.ok}`)),
          h('span.band-sentence', sentence),
        ),
        bandDelta,
        seeChanges,
        revealSaid,
        engines,
      ),
    );
    // Do this next: the existing next-step decision, with the fix's own reasoning and labels when it is a fix.
    let next = null;
    if (step) {
      const fixStep = topFix && step.title === topFix.title;
      const action = step.action;
      action?.classList.add('btn-chunky');
      const askBtn =
        fixStep && xoAvailable()
          ? button('Ask Xo to draft it', {
              variant: 'secondary',
              onclick: (e) =>
                askXo(
                  `Draft the fix “${topFix.title}” for ${d.name}, ready for me to review.`,
                  e.currentTarget,
                  { send: true },
                ),
            })
          : step.alt
            ? button(step.alt.label, { variant: 'secondary', onclick: step.alt.run }, 'message')
            : null;
      next = h(
        'section.ov-next',
        { dataset: { tour: 'next-step' }, 'aria-labelledby': 'ov-next-title' },
        h(
          'p.eyebrow.ov-next-eyebrow',
          icon(
            step.icon === 'check' ? 'check' : step.icon === 'archive' ? 'archive' : 'arrowRight',
            16,
          ),
          fixStep ? 'Do this next' : step.eyebrow,
        ),
        h('h2#ov-next-title', step.title),
        h(
          'p.ov-next-text',
          fixStep && fixWhy(topFix)
            ? fixWhy(topFix)
                .replace(/^Unverified hypothesis:\s*/i, '')
                .split(/(?<=\.)\s+/)
                .slice(0, 2)
                .join(' ')
            : step.text,
        ),
        fixStep
          ? h(
              'p.ov-next-meta',
              h(`span.ev-dot.ev-${topFix.evidence.toLowerCase()}`, { 'aria-hidden': 'true' }),
              h('span', `${topFix.evidence} evidence`),
              h('span', `${topFix.impact} impact`),
              topFix.gain ? h('span', plural(topFix.gain, 'missed answer')) : null,
            )
          : null,
        action || askBtn ? h('div.row.ov-next-actions', action, askBtn) : null,
        revealXo,
      );
    }
    const top = h('div.ov-top', { class: next ? '' : 'solo' }, band, next);
    const pending = await pendingReq;
    const fixData = await fixesReq;
    const ranked = (fixData?.fixes || []).filter(
      (f) => !isDiagnostic(f) && f.status !== 'dismissed',
    );
    const todo = ranked.filter((f) => f.status === 'todo'),
      done = ranked.filter((f) => f.status === 'done');
    const where = (f) => {
      try {
        const u = new URL(f.url);
        return u.hostname.replace(/^www\./, '') === d.domain
          ? u.pathname === '/'
            ? '/'
            : u.pathname.replace(/\/$/, '')
          : `${u.hostname.replace(/^www\./, '')} listing`;
      } catch {
        return '';
      }
    };
    const statusCell = (f) =>
      f.status === 'done'
        ? h('span.fx-status.done', icon('check', 14), 'Done')
        : h('span.fx-status', icon('circleDashed', 14), 'To do');
    const fixRows = [...todo, ...done].slice(0, 6);
    const fixesCard = h(
      'section.ov-fixes',
      { 'aria-labelledby': 'ov-fixes-title' },
      h(
        'div.ov-sec-head',
        h(
          'h2#ov-fixes-title',
          'Fixes',
          h(
            'span.ov-sec-sub',
            todo.length
              ? `${todo.length} to do${done.length ? ` · ${done.length} done` : ''}`
              : done.length
                ? `${done.length} done`
                : '',
          ),
        ),
        h(
          'a.ov-sec-link',
          { href: `#/clients/${d.id}/fixes` },
          'All fixes',
          icon('arrowRight', 14),
        ),
      ),
      fixData == null
        ? h('p.muted', 'Fixes didn’t load. Open the Fixes tab to see them.')
        : !fixRows.length
          ? h('p.muted.ov-empty-line', 'No fixes for this scan yet.')
          : h(
              'div.ov-table-wrap',
              h(
                'table.ov-table',
                h(
                  'thead',
                  h(
                    'tr',
                    h('th', { scope: 'col' }, 'Fix'),
                    h('th', { scope: 'col' }, 'Evidence'),
                    h('th', { scope: 'col' }, 'Impact'),
                    h('th.num', { scope: 'col' }, 'Missed answers'),
                    h('th', { scope: 'col' }, 'Status'),
                  ),
                ),
                h(
                  'tbody',
                  fixRows.map((f) =>
                    h(
                      'tr',
                      { class: f.status === 'done' ? 'is-done' : '' },
                      h(
                        'th',
                        { scope: 'row' },
                        h(
                          'a.fx-title',
                          { href: `#/clients/${d.id}/fixes` },
                          fixTitle(f),
                          topFix && f.id === topFix.id && f.status === 'todo'
                            ? h('span.fx-next', 'Next')
                            : null,
                        ),
                        h(
                          'span.fx-sub',
                          [where(f), (f.engines || []).join(', ')].filter(Boolean).join(' · '),
                        ),
                      ),
                      h(
                        'td',
                        h(`span.ev-dot.ev-${String(f.evidence).toLowerCase()}`, {
                          'aria-hidden': 'true',
                        }),
                        f.evidence,
                      ),
                      h('td', f.impact),
                      h('td.num', String(f.gain ?? '-')),
                      h('td', statusCell(f)),
                    ),
                  ),
                ),
              ),
            ),
    );
    // Side column: who the engines name instead, what changed since the previous scan, the scans themselves.
    const rivals = d.competitors.slice(0, 3);
    const named = h(
      'section.ov-side-sec',
      { 'aria-labelledby': 'ov-named-title' },
      h('h2#ov-named-title', 'Named instead'),
      rivals.length
        ? h(
            'ul.ov-list',
            rivals.map((c) =>
              h(
                'li',
                h(
                  'span.ov-tile',
                  { 'aria-hidden': 'true' },
                  (c.name.trim()[0] || '?').toUpperCase(),
                ),
                h(
                  'span.ov-list-text',
                  h('strong', c.name),
                  h('span', `Named in ${plural(c.count, 'answer')}`),
                ),
              ),
            ),
          )
        : h('p.muted.ov-empty-line', 'No other businesses were named in this scan.'),
    );
    const since = prevScan ? `New since ${date(prevScan.finishedAt)}` : 'What changed';
    const changesSec = h(
      'section.ov-side-sec',
      { 'aria-labelledby': 'ov-new-title' },
      h('h2#ov-new-title.changes-title', since),
      d.scans.length < 2
        ? h('p.muted.ov-empty-line', 'The next scan shows what changed.')
        : !changed
          ? h(
              'p.muted.ov-empty-line',
              comparison
                ? 'No matched answers changed since the previous scan.'
                : 'New baseline: the previous scan is not comparable.',
            )
          : h(
              'ul.ov-list',
              allChanges
                .slice(0, 5)
                .map((c) =>
                  h(
                    'li',
                    h(
                      'button.ov-change',
                      { type: 'button', onclick: () => openAnswer(c.answerId, changeIds) },
                      h(
                        `span.ov-tile.${c.up ? 'up' : 'down'}`,
                        { 'aria-hidden': 'true' },
                        icon(c.up ? 'arrowUpRight' : 'arrowDown', 14),
                      ),
                      h(
                        'span.ov-list-text',
                        h(
                          'strong',
                          c.engine,
                          h(
                            'span.visually-hidden',
                            c.up ? ', now names the client' : ', dropped the client',
                          ),
                        ),
                        h('span', c.question),
                      ),
                    ),
                  ),
                ),
            ),
    );
    const scansSec = h(
      'section.ov-side-sec',
      { 'aria-labelledby': 'ov-scans-title' },
      h('h2#ov-scans-title', 'Scans'),
      h(
        'table.ov-scans',
        h(
          'tbody',
          [...d.scans]
            .reverse()
            .slice(0, 4)
            .map((sc) =>
              h(
                'tr',
                h('th', { scope: 'row' }, date(sc.finishedAt || sc.startedAt)),
                h('td', `Scan ${sc.number}`),
                h(
                  'td.num',
                  sc.ok
                    ? h('span', h('strong', String(sc.mentioned)), ` of ${sc.ok}`)
                    : 'No answers',
                ),
              ),
            ),
        ),
      ),
    );
    const trend = plottable
      ? h(
          'section.ov-trend',
          {
            dataset: { tour: 'trend' },
            'aria-labelledby': 'ov-trend-title',
            'aria-describedby': 'ov-trend-desc',
          },
          h(
            'div.ov-sec-head',
            h(
              'h2#ov-trend-title',
              'Named answers over time',
              h('span.ov-sec-sub', plural(d.scans.length, 'scan')),
            ),
          ),
          // The legend no longer narrates on screen; it stays as the section's description for screen readers.
          h(
            'p.visually-hidden#ov-trend-desc',
            'Green squares mark fixes marked done.',
            divided
              ? ` ${DIVIDER_NOTE}`
              : plotted.length > 1
                ? ' Lines connect comparable scans.'
                : null,
          ),
          trendChart(d, { replay: !!reveal }),
        )
      : null;
    const rows = [
      ...d.competitors.slice(0, 6).map((c) => ({ name: c.name, value: c.count })),
      { name: d.name, value: L.mentioned, highlight: true, tag: 'Your client' },
    ].sort((a, b) => b.value - a.value || (b.highlight ? 1 : -1));
    const more = h(
      'details.more-detail',
      h(
        'summary.more-detail-head',
        h(
          'span',
          h('strong', 'More detail'),
          h('span.muted', ' · who the engines recommend and the sources they cite'),
        ),
        icon('chevronDown', 18),
      ),
      h(
        'div.grid-2',
        h(
          'section.card',
          h('div.card-head', h('h2', 'Who the engines recommend')),
          barList(rows, {
            max: Math.max(...rows.map((r) => r.value), 1),
            format: (r) => plural(r.value, 'answer'),
          }),
        ),
        h(
          'section.card',
          h('div.card-head', h('h2', 'Sources the engines cite')),
          h(
            'ul.source-table',
            d.sources.map((x) =>
              h(
                'li',
                h('span.bar-name', { title: x.name }, x.name),
                x.kind === 'Client site'
                  ? h('span.kind.kind-client', x.kind)
                  : h('span.kind', x.kind),
                h('span.num', plural(x.count, 'answer')),
              ),
            ),
          ),
        ),
      ),
    );
    const foot = h(
      'div.ov-foot',
      caveatRow({
        configuration: d.latestConfiguration,
        comparison: d.comparisonAvailability,
        early: d.delta !== null && !unavailable,
        comparableText:
          'Comparable with the previous scan. This does not prove a website change caused the answer difference. One comparison can vary; repeat scans under the same setup to see whether a change lasts.',
        baselineText: 'This scan is a new baseline; a headline comparison is unavailable.',
      }),
      h(
        'a.ov-method',
        { href: '/methodology', target: '_blank', rel: 'noopener' },
        icon('info', 16),
        'How answers and fixes are measured',
      ),
    );
    // Above the band: a running scan's card and the failed / not-connected notices (the next step moved into the band).
    clear(
      el,
      ...blocks.filter((b) => b !== stepBlock),
      top,
      pending?.approvals?.some((r) => r.status === 'pending') ? pendingBlock(d.id, pending) : null,
      h(
        'div.ov-grid',
        h('div.ov-main', fixesCard, trend),
        h('aside.ov-side', { 'aria-label': 'Answers detail' }, named, changesSec, scansSec),
      ),
      more,
      foot,
    );
    if (reveal) {
      // Same reveal as the phone layout: the old value until the roll, and one spoken result line.
      bigNum.textContent = String(reveal.first ? 0 : reveal.from);
      const change = reveal.first
        ? ' First scan: this observed result is the baseline later scans compare against.'
        : comparableDelta
          ? ` ${deltaText(d.delta, prevDone, L)}.`
          : '';
      setTimeout(() => {
        revealSaid.textContent = `Scan ${L.number} finished. ${L.mentioned} of ${L.ok} answers name ${d.name}.${change}`;
      }, 150);
      startReveal(
        band,
        bigNum,
        reveal.first ? 0 : reveal.from,
        L.mentioned,
        reveal.first ? L.mentioned > 0 : comparableDelta && d.delta > 0,
      );
    }
  }
}

// U1 + M1: on phones the result card scrolls into view first (smooth, ends on scrollend or after 420ms), then the
// numeral rolls, the pill and Xo come in (held paused until then), and a rise ends with a 240ms punch on the number.
function startReveal(card, num, from, to, up) {
  const r = card.getBoundingClientRect();
  const phone = innerWidth < 720;
  const offscreen = r.top < 48 || r.top > innerHeight * 0.4;
  let started = false;
  const go = () => {
    if (started) return;
    started = true;
    card.classList.remove('hold');
    rollNumber(num, from, to);
    if (up && !reducedMotion())
      setTimeout(() => {
        num.classList.add('punch');
        num.addEventListener('animationend', () => num.classList.remove('punch'), { once: true });
      }, 600);
  };
  if (!phone || !offscreen || reducedMotion()) {
    if (phone && offscreen) card.scrollIntoView({ block: 'start' });
    return go();
  }
  card.classList.add('hold');
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  addEventListener('scrollend', go, { once: true });
  setTimeout(go, 420);
}
