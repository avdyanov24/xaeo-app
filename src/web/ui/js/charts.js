// Small chart and stat building blocks: rings, stat tiles, labelled bar lists, the weekly combo chart and help tips.
// Pure SVG and DOM, no library. Motion is transform and opacity only.
import { h, icon, date, meter, countUp, showTip, hideTip, tipShown } from './lib.js';

const NS = 'http://www.w3.org/2000/svg';
export const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  kids.forEach((k) => el.append(k));
  return el;
};
export const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
// U15: one wording for a change between two scans, everywhere: "+2 since 26 Oct" ("since scan 3" when both ran the
// same day, "since last scan" where the date isn't loaded, e.g. the client list). The hedge (one comparison can vary) lives in the help tooltip only, never in the label.
export const sinceWhen = (prev, latest) =>
  !prev?.finishedAt
    ? 'since last scan'
    : latest?.finishedAt && date(prev.finishedAt) === date(latest.finishedAt) && prev.number
      ? `since scan ${prev.number}`
      : `since ${date(prev.finishedAt)}`;
export const deltaText = (delta, prev, latest) => {
  const w = sinceWhen(prev, latest);
  return delta > 0 ? `+${delta} ${w}` : delta < 0 ? `−${Math.abs(delta)} ${w}` : `No change ${w}`;
};
export const DELTA_HEDGE =
  'A change since the previous scan is an early signal: one comparison can vary, so repeat scans under the same setup to see whether it lasts.';

// Round axis ticks (0/5/10/…/25, 0/10/20/30%): step is 1, 2, 2.5 (only from 25 up), 5 × 10^k, at most `count` steps.
export function niceTicks(max, count = 5) {
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

// A small (?) that explains a term in plain words, on hover, focus or tap.
export function hint(text, label = 'What does this mean?') {
  const btn = h(
    'button.hint',
    { type: 'button', 'aria-label': `${label} ${text}` },
    icon('help', 15),
  );
  // Touch: a tap fires pointerenter and focus before click, so only a mouse opens on enter, and a tap's focus waits for
  // the click toggle (otherwise the tip flashes on and straight off).
  let tapping = false;
  btn.addEventListener('pointerdown', (e) => {
    tapping = e.pointerType !== 'mouse';
  });
  btn.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'mouse') showTip(btn, text);
  });
  btn.addEventListener('focus', () => {
    if (!tapping) showTip(btn, text);
  });
  btn.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') hideTip();
  });
  btn.addEventListener('blur', hideTip);
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    tapping = false;
    tipShown() ? hideTip() : showTip(btn, text);
  });
  return btn;
}

// Donut ring showing a fraction, with the percentage in the middle.
export function ring(fraction, { size = 64, tone = 'cobalt', label = null } = {}) {
  const f = Math.max(0, Math.min(1, fraction || 0)),
    r = 26,
    c = 2 * Math.PI * r;
  return h(
    'span.ring',
    {
      class: `ring-${tone}`,
      style: { width: `${size}px`, height: `${size}px` },
      role: 'img',
      'aria-label': `${Math.round(f * 100)}%`,
    },
    svg(
      'svg',
      { viewBox: '0 0 64 64' },
      svg('circle', { cx: 32, cy: 32, r, class: 'ring-track' }),
      f > 0
        ? svg('circle', {
            cx: 32,
            cy: 32,
            r,
            class: 'ring-fill',
            'stroke-dasharray': `${(c * f).toFixed(2)} ${c.toFixed(2)}`,
          })
        : '',
    ),
    h('span.ring-label', label ?? `${Math.round(f * 100)}%`),
  );
}

// Stat tile: label (+ help), a big value, a plain sentence under it, and an optional visual on the right.
export function statTile({
  label,
  help,
  value,
  count = null,
  from = null,
  delay = 0,
  suffix = '',
  sub,
  visual = null,
  tone = '',
  i = 0,
}) {
  const big = h(
    'span.stat-value',
    count != null ? countUp(h('span'), count, { from, delay }) : value,
    suffix ? h('span.stat-suffix', suffix) : null,
  );
  return h(
    'div.stat',
    { class: tone, style: { '--i': String(i) } },
    h(
      'div.stat-main',
      h('p.stat-label', label, help ? hint(help) : null),
      big,
      sub ? h('p.stat-sub', sub) : null,
    ),
    visual ? h('div.stat-visual', visual) : null,
  );
}

// Labelled horizontal bars. rows: [{ name, value, total?, note?, highlight? }]
// Cobalt is the client's own data, pale is everyone else (spec §4). `own: true` when every row is the client's (by-engine).
export function barList(rows, { max = null, format = (r) => String(r.value), own = false } = {}) {
  const top = max ?? Math.max(...rows.map((r) => r.value), 1);
  return h(
    'ol.hbars',
    rows.map((r, i) =>
      h(
        'li',
        { class: r.highlight ? 'me' : '', style: { '--i': String(i) } },
        h('span.hbar-name', h('span.hbar-text', r.name), r.tag ? h('span.tag', r.tag) : null),
        meter(
          r.total != null ? (r.total ? r.value / r.total : 0) : r.value / top,
          r.highlight || own ? 'meter-lg' : 'meter-lg.meter-soft',
        ),
        h('span.num', format(r)),
      ),
    ),
  );
}

// Week-by-week chart for the whole agency: a line for the share of answers naming clients, bars for fixes shipped.
export function weeklyChart(
  weeks,
  { label = 'Share of answers that name your clients, week by week' } = {},
) {
  const narrow = innerWidth < 640;
  const W = narrow ? 360 : 680,
    H = 230,
    P = { l: 38, r: 16, t: 26, b: 34 };
  const wrap = h('div.chart.weekly');
  const tip = h('div.chart-tip');
  const rates = weeks.map((w) => pct(w.mentioned, w.ok));
  const { top, ticks } = niceTicks(Math.min(100, Math.max(20, Math.max(...rates, 1) * 1.2)), 4);
  const fixMax = Math.max(...weeks.map((w) => w.fixesDone), 1);
  const band = (W - P.l - P.r) / Math.max(weeks.length, 1);
  const x = (i) => P.l + band * i + band / 2;
  const y = (v) => P.t + (1 - v / top) * (H - P.t - P.b);
  const uid = 'w' + Math.random().toString(36).slice(2, 7);
  const root = svg('svg', {
    viewBox: `0 0 ${W} ${H}`,
    role: 'img',
    'aria-label': `${label}: ${weeks.map((w, i) => `week of ${date(w.start)} ${rates[i]}%`).join(', ')}`,
  });
  root.append(
    svg(
      'defs',
      {},
      svg(
        'clipPath',
        { id: `${uid}-r` },
        svg('rect', { x: 0, y: 0, width: W, height: H, class: 'chart-reveal' }),
      ),
    ),
  );
  for (const v of ticks)
    root.append(
      svg('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), class: 'grid' }),
      svg('text', { x: P.l - 8, y: y(v) + 4, class: 'axis tick', 'text-anchor': 'end' }, `${v}%`),
    );
  // Fix bars sit on the baseline, up to 40% of the height.
  weeks.forEach((w, i) => {
    if (!w.fixesDone) return;
    const bh = (w.fixesDone / fixMax) * (H - P.t - P.b) * 0.4,
      bw = Math.min(26, band * 0.5);
    const bar = svg('rect', {
      x: x(i) - bw / 2,
      y: y(0) - bh,
      width: bw,
      height: bh,
      rx: 5,
      class: 'fix-bar',
    });
    bar.style.setProperty('--d', `${Math.round(80 + (i / Math.max(1, weeks.length - 1)) * 360)}ms`);
    root.append(bar);
  });
  const pts = weeks.map((w, i) => [x(i), y(rates[i])]);
  const drawn = svg('g', { 'clip-path': `url(#${uid}-r)` });
  if (pts.length > 1) {
    drawn.append(
      svg('path', {
        d: `M ${pts[0][0]} ${y(0)} ${pts.map((p) => `L ${p[0]} ${p[1]}`).join(' ')} L ${pts.at(-1)[0]} ${y(0)} Z`,
        class: 'area',
      }),
      svg('polyline', { points: pts.map((p) => p.join(',')).join(' '), class: 'line' }),
    );
  }
  root.append(drawn);
  const every = Math.ceil(weeks.length / (narrow ? 4 : 8));
  weeks.forEach((w, i) => {
    if (i % every === 0 || i === weeks.length - 1)
      root.append(
        svg('text', { x: x(i), y: H - 10, 'text-anchor': 'middle', class: 'axis' }, date(w.start)),
      );
    const g = svg('g', { class: 'point', tabindex: '0' });
    // Dots follow the 600ms clip reveal: spread over 120-540ms whatever the number of weeks.
    g.style.setProperty('--d', `${Math.round(120 + (i / Math.max(1, weeks.length - 1)) * 420)}ms`);
    const show = () => {
      tip.textContent = `Week of ${date(w.start)} · ${w.mentioned} of ${w.ok} answers (${rates[i]}%)${w.fixesDone ? ` · ${w.fixesDone} fix${w.fixesDone === 1 ? '' : 'es'} marked done` : ''}`;
      const box = wrap.getBoundingClientRect();
      tip.style.transform = `translate(${Math.max(0, Math.min(box.width - 220, (pts[i][0] / W) * box.width - 110))}px, ${(pts[i][1] / H) * box.height - 56}px)`;
      tip.classList.add('on');
    };
    const hide = () => tip.classList.remove('on');
    g.addEventListener('pointerenter', show);
    g.addEventListener('focus', show);
    g.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') hide();
    });
    g.addEventListener('blur', hide);
    g.append(
      svg('rect', { x: x(i) - band / 2, y: P.t, width: band, height: H - P.t - P.b, class: 'hit' }),
      svg('circle', { cx: pts[i][0], cy: pts[i][1], r: 3.5, class: 'dot' }),
    );
    if (i === weeks.length - 1 || weeks.length <= 6)
      g.append(
        svg(
          'text',
          { x: pts[i][0], y: pts[i][1] - 10, 'text-anchor': 'middle', class: 'val' },
          `${rates[i]}%`,
        ),
      );
    root.append(g);
  });
  wrap.append(root, tip);
  return wrap;
}
