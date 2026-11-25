// Fixes: ranked by observed answer coverage, then evidence. Each includes a proposal, a check, and a ticket.
import {
  api,
  h,
  clear,
  icon,
  xo,
  date,
  plural,
  badge,
  button,
  copyText,
  openAnswer,
  emptyState,
  errorToast,
  toast,
  busy,
  meter,
  highlight,
  reducedMotion,
  labelPill,
  withTip,
  segScroll,
} from '../lib.js';
import { hint } from '../charts.js';
import { reactionReady } from '../xo.js';
import { state } from '../main.js';
import { ticketMarkdown } from '../ticket.js';
import { isDiagnostic, fixTitle, fixWhy, rankedTodo } from '../fix-labels.js';
import { xoAvailable, askXo } from '../xo-chat.js';
import { draftsFor, draftStrip } from './approvals.js';
export { ticketMarkdown } from '../ticket.js';

export const TYPE_NAMES = {
  jsonld: 'Schema',
  page: 'New page',
  listing: 'Listing',
  copy: 'On-page copy',
  crawler: 'Crawler access',
};
const filters = { status: 'open', engine: '', type: '' };
// The open rows of the last Fixes render, so an in-place refresh (Xo `refresh`, ctx.keep) keeps them open too.
let kept = { id: null, open: new Set() };
const CONDITION_LABELS = {
  met: 'Condition met',
  'not-met': 'Condition not met',
  unknown: 'Could not verify condition',
};
const CHANGE_LABELS = {
  'condition-added': 'Absent before; present after',
  'already-present': 'Already present in both observations',
  'still-missing': 'Absent in both observations',
  regressed: 'Present before; absent after',
  unknown: 'The saved evidence does not establish a comparison',
};

function reviewNextScan(ctx, el) {
  document.querySelector('.toasts')?.replaceChildren();
  // Focus returns to the Fixes heading (the toggled row has left the Open list), never to <body>.
  const close = () => {
    wrap.remove();
    document.removeEventListener('keydown', onKey);
    const back = el.querySelector('.section-head h2');
    if (back) {
      back.tabIndex = -1;
      back.focus({ preventScroll: true });
    }
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  // U3 + C6: Xo cheers inside a burst of flat squares, 8-12px (a 12px square spun 45deg measures ~17px across; its
  // side never passes 12px). CSS-drawn, 600ms --ease-out, hidden under reduced motion. Brand colours only: cobalt,
  // pale blue, ink. N7: the burst fans upward and sideways only (-112..112deg from up), so no piece crosses the
  // heading under Xo. R2 C6: wide screens get a denser, longer burst (24 pieces, 170-220px) that leaves the card.
  const BURST = ['var(--cobalt)', 'var(--pale-blue-strong)', 'var(--ink)', 'var(--cobalt)'];
  const wide = innerWidth >= 900,
    count = wide ? 24 : 16,
    span = 224;
  const burst = h(
    'span.burst',
    { 'aria-hidden': 'true' },
    Array.from({ length: count }, (_, i) =>
      h('i', {
        style: {
          '--a': `${-span / 2 + (i * span) / (count - 1) + (i % 2 ? 4 : -4)}deg`,
          '--r': `${(wide ? 170 : 120) + (i % 3) * (wide ? 25 : 20)}px`,
          '--c': BURST[i % 4],
          '--s': `${[8, 10, 12][i % 3]}px`,
        },
      }),
    ),
  );
  const wrap = h(
    'div.celebrate',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'All fixes marked done' },
    h(
      'div.celebrate-card',
      h('div.celebrate-stage', burst, xo('cheer', 'celebrate-xo')),
      h('h2', 'All fixes marked done'),
      h(
        'p',
        'Marked done records your agency’s status. Rescan to see what changed in the AI answers; website changes are not verified.',
      ),
      h(
        'div.row.center',
        button(
          'Run a rescan',
          {
            onclick: (e) => {
              close();
              ctx.startScan(e.currentTarget);
            },
          },
          'refresh',
        ),
        button('Close', { variant: 'ghost', onclick: close }),
      ),
    ),
  );
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) close();
  });
  document.body.append(wrap);
  wrap.querySelector('button').focus();
}

// Reads the "Fix ID" column of the exported CSV (RFC 4180: quoted cells may hold commas, quotes and newlines).
function csvFixIds(text) {
  const rows = [[]];
  let cell = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      rows.at(-1).push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      rows.at(-1).push(cell);
      cell = '';
      rows.push([]);
    } else cell += c;
  }
  rows.at(-1).push(cell);
  const head = rows.shift().map((x) => x.replace(/^\uFEFF/, '').trim());
  const col = head.indexOf('Fix ID');
  return col < 0 ? [] : [...new Set(rows.map((r) => (r[col] || '').trim()).filter(Boolean))];
}

export async function renderFixes(el, ctx) {
  const [first, handoffs, drafts] = await Promise.all([
    api(`/api/app/clients/${ctx.id}/fixes`),
    api(`/api/app/clients/${ctx.id}/handoffs`).catch(() => null),
    draftsFor(ctx.id),
  ]);
  let data = first;
  // U01 (UI part): how many of this client's Xo drafts are approved or waiting, kept current by `xaeo:artifact`.
  // One element for the whole visit, so every redraw keeps it (and its listener) instead of refetching.
  const strip = drafts ? draftStrip(ctx.id, ctx.detail.name, drafts) : null;
  // R3-8: once the Fixes tab was opened, the Overview next step may move on to "Send the report".
  try {
    localStorage.setItem(`xaeo-fixes-seen:${ctx.id}`, '1');
  } catch {
    /* private mode: the step order just stays fix-first */
  }
  // CSV handoff state per fix: fixId -> { state: 'new'|'sent'|'changed', lastAt }. GET fixes.csv is read-only;
  // each download is recorded with POST /handoffs {channel:'csv'} (exportCsv below).
  const csvState = new Map((handoffs?.handoffs || []).map((x) => [x.fixId, x.csv]));
  // Every visit starts on Open: a leftover "Done" filter hid the first open fix (and stalled the tour). A hash query
  // (`?engine=claude&status=all&type=jsonld`) sets the starting filters; unknown values are
  // ignored. The filter holds engine display names (fixesView maps ids through engineName). UI changes never rewrite the hash.
  // Xo's `refresh` re-renders in place (ctx.keep): the filters and open rows the user set stay as they are.
  const keep = ctx.keep && kept.id === ctx.id;
  let engineNote = null;
  if (!keep) ((filters.status = 'open'), (filters.engine = ''), (filters.type = ''));
  const q = keep ? null : ctx.query;
  if (q) {
    if (['open', 'done', 'wont', 'stale', 'all'].includes(q.get('status')))
      filters.status = q.get('status');
    if (Object.hasOwn(TYPE_NAMES, q.get('type') || '')) filters.type = q.get('type');
    const asked = q.get('engine');
    // Ids match case-insensitively: `?engine=CLAUDE` is the same ask as `?engine=claude`.
    const engine = (state.me?.engines || []).find(
      (e) => e.id.toLowerCase() === (asked || '').toLowerCase(),
    );
    if (engine) filters.engine = engine.name;
    // An engine id the workspace doesn't check (an old link, or Xo naming one) says so instead of silently showing
    // all engines. The live region goes in empty and gets its text a beat later, so screen readers announce it.
    else if (asked) {
      const text = h('p');
      engineNote = h(
        'div.notice.notice-soft.engine-note',
        { role: 'status' },
        icon('info', 18),
        text,
      );
      setTimeout(
        () =>
          text.append(
            `The link asked for the engine “${asked.slice(0, 40)}”, which this workspace doesn’t check, so all engines are shown.`,
          ),
        150,
      );
    }
  }
  const defs = data.definitions || state.me.definitions;
  const open = keep ? kept.open : new Set();
  kept = { id: ctx.id, open };
  let autoOpened = keep;
  const verificationRefreshFailed = new Set();
  let justOpened = null,
    lastDone = null,
    lastDoneCount = null;
  // Toast Xo at most once every 2s, so quick Mark done runs never stack clips.
  // U5: the toast Xo uses the app-wide 2s reaction cooldown (xo.js), so it never stacks with another reaction.
  const xoPose = (pose) => (reactionReady() ? pose : undefined);
  // U3: a "Done" chip leaves the row and lands on the Done filter count, which then pops. Skipped (count pop only)
  // when the page is about to scroll, when the filter is off screen or under the top bar, or with reduced motion.
  const bumpDone = () => {
    const c = el.querySelector('.seg[data-key="done"] .count');
    if (!c) return;
    c.classList.remove('bump');
    void c.offsetWidth;
    c.classList.add('bump');
  };
  const flyDone = (from, scrolling) => {
    const seg = el.querySelector('.seg[data-key="done"]');
    if (!seg) return;
    const to = seg.getBoundingClientRect(),
      bar = document.querySelector('.topbar')?.getBoundingClientRect().bottom || 0;
    if (scrolling || reducedMotion() || !from?.width || to.top < bar || to.bottom > innerHeight)
      return bumpDone();
    const chip = h('span.fly-chip', { 'aria-hidden': 'true' }, icon('check', 12), 'Done');
    document.body.append(chip);
    const w = chip.offsetWidth,
      ht = chip.offsetHeight;
    const x0 = from.left + from.width / 2 - w / 2,
      y0 = from.top + from.height / 2 - ht / 2;
    const x1 = to.left + to.width / 2 - w / 2,
      y1 = to.top + to.height / 2 - ht / 2;
    const a = chip.animate(
      [
        { transform: `translate(${x0}px, ${y0}px) scale(.6)`, opacity: 0 },
        { transform: `translate(${x0}px, ${y0 - 10}px) scale(1)`, opacity: 1, offset: 0.3 },
        { transform: `translate(${x1}px, ${y1}px) scale(.7)`, opacity: 0.85 },
      ],
      { duration: 420, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' },
    );
    const end = () => {
      chip.remove();
      bumpDone();
    };
    a.onfinish = end;
    a.oncancel = end;
  };
  // The tab badge counts ranked open fixes only (the website-check diagnostic is not a fix). Redraw the header
  // only when the number changed, so it never goes stale after Mark done.
  const syncBadge = () => {
    const n = rankedTodo(data.fixes);
    if (ctx.detail.fixes.todo === n) return;
    ctx.detail.fixes.todo = n;
    ctx.redrawHeader?.();
  };
  syncBadge();

  const setStatus = async (f, status, btn) =>
    busy(btn, async () => {
      try {
        const wasOpen = open.has(f.id);
        const from =
          btn.closest('.fix')?.querySelector('.done-toggle')?.getBoundingClientRect() || null;
        const res = await api(`/api/app/fixes/${f.id}/status`, {
          method: 'POST',
          data: { status },
        });
        data = res;
        syncBadge();
        // Closing an open fix (done or won't do) opens the next open one in place, so the page keeps its anchor.
        let next = null;
        if (status !== 'todo' && wasOpen) {
          open.delete(f.id);
          const todo = res.fixes.filter((x) => x.status === 'todo' && x.id !== f.id);
          next = todo.find((x) => !isDiagnostic(x)) || todo[0] || null;
          if (next) {
            open.add(next.id);
            justOpened = next.id;
          }
        }
        // flipDraw does the only scroll (instant, same task as the swap); nothing here scrolls again.
        const jumped = flipDraw(next ? next.id : null);
        const reward = status === 'done' && !res.allDone;
        const n = next
          ? [...el.querySelectorAll('.fix')].find((x) => x.dataset.id === String(next.id))
          : null;
        if (n) {
          n.querySelector('.expand')?.focus({ preventScroll: true });
          if (reward) requestAnimationFrame(() => flyDone(from, jumped));
        } else {
          // N7: the toggled row was redrawn or left the list. Keep focus on its control when it is still shown,
          // otherwise on the empty-list heading or the Fixes heading, never on <body>.
          const same = el.querySelector(`.fix[data-id="${CSS.escape(String(f.id))}"] .done-toggle`);
          const target =
            same || el.querySelector('.filtered-empty h3') || el.querySelector('.section-head h2');
          if (target && !res.allDone) {
            if (!same) target.tabIndex = -1;
            target.focus({ preventScroll: true });
          }
          if (reward) requestAnimationFrame(() => flyDone(from, false));
        }
        if (res.allDone) reviewNextScan(ctx, el);
        else if (status === 'done')
          toast('Marked done. Rescan to see what changed.', { pose: xoPose('happy') });
        else if (status === 'wont')
          toast('Moved to won’t do. It stays out of reports.', {
            action: { label: 'Undo', onClick: () => undoWont(f) },
          });
      } catch (err) {
        errorToast(err);
        // 409 (the fix went stale after a rescan elsewhere) or 404 (it is gone): the list on screen is out of date. Fetch the current one.
        if (err.status === 409 || err.status === 404) {
          try {
            data = await api(`/api/app/clients/${ctx.id}/fixes`);
            syncBadge();
          } catch {
            /* the toast already said what happened */
          }
        }
        draw();
      }
    });

  // U10: "Won't do" needs no confirm because it can be undone for 8s from the toast. Undo is one POST; the fix
  // comes back open, rises in (240ms) and takes focus. If the view was left meanwhile, the status still reverts.
  async function undoWont(f) {
    try {
      const res = await api(`/api/app/fixes/${f.id}/status`, {
        method: 'POST',
        data: { status: 'todo' },
      });
      if (!el.isConnected) return toast('Fix reopened.');
      data = res;
      syncBadge();
      open.add(f.id);
      justOpened = f.id;
      flipDraw();
      const row = el.querySelector(`.fix[data-id="${CSS.escape(String(f.id))}"]`);
      if (row) {
        row.classList.add('restored');
        row.querySelector('.expand')?.focus({ preventScroll: true });
        row.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
      }
      toast('Fix reopened.');
    } catch (err) {
      errorToast(err);
    }
  }

  // Mark done (or undo): the check draws in, the row slides out, then the list redraws and the rest glide up.
  const toggle = (f, next, btn) => {
    const row = btn.closest('.fix');
    if (row.classList.contains('pending')) return;
    row.classList.add('pending');
    const still = reducedMotion(),
      leaving = filters.status !== 'all' && !still;
    if (next === 'done') row.querySelector('.done-toggle')?.classList.add('checked', 'drawing');
    setTimeout(
      () => {
        if (leaving) row.classList.add('leaving');
        setTimeout(() => setStatus(f, next, btn), leaving ? 150 : 0);
      },
      next === 'done' && !still ? 240 : 0,
    );
  };

  // R3-6 (phones only, app.css): the segmented control keeps Open / Done / All on one row; "Won't do", "Stale",
  // engine and type move into this one select. Desktop keeps the full segmented control and both selects.
  function moreFilters(work, engines, types) {
    const n = (key) => work.filter((f) => f.status === key).length;
    // D3: the select holds ONE filter. Picking a status clears engine and type; picking an engine or type puts
    // Won't do / Stale back to Open. A combination set on desktop (then resized) is shown as one read-only label.
    const side = filters.status === 'wont' || filters.status === 'stale';
    const parts = [
      side ? (filters.status === 'wont' ? 'Won’t do' : 'Stale') : '',
      filters.engine,
      filters.type ? TYPE_NAMES[filters.type] || filters.type : '',
    ].filter(Boolean);
    const current =
      parts.length > 1
        ? 'combo'
        : side
          ? `status:${filters.status}`
          : filters.engine
            ? `engine:${filters.engine}`
            : filters.type
              ? `type:${filters.type}`
              : '';
    const opt = (value, label) => h('option', { value, selected: current === value }, label);
    return h(
      'select.filter-more',
      {
        'aria-label': 'More filters',
        onchange: (e) => {
          const [kind, ...rest] = e.target.value.split(':'),
            value = rest.join(':');
          if (kind === 'combo') return;
          if (!kind) {
            filters.engine = '';
            filters.type = '';
            if (side) filters.status = 'open';
          } else if (kind === 'status') {
            filters.status = value;
            filters.engine = '';
            filters.type = '';
          } else if (kind === 'engine') {
            filters.engine = value;
            filters.type = '';
            if (side) filters.status = 'open';
          } else if (kind === 'type') {
            filters.type = value;
            filters.engine = '';
            if (side) filters.status = 'open';
          }
          draw();
        },
      },
      opt('', current ? 'Clear filters' : 'More filters'),
      current === 'combo'
        ? h('option', { value: 'combo', selected: true, disabled: true }, parts.join(' · '))
        : null,
      h(
        'optgroup',
        { label: 'Status' },
        opt('status:wont', `Won’t do (${n('wont')})`),
        opt('status:stale', `Stale (${n('stale')})`),
      ),
      engines.length > 1
        ? h(
            'optgroup',
            { label: 'Engine' },
            engines.map((e) => opt(`engine:${e}`, e)),
          )
        : null,
      types.length > 1
        ? h(
            'optgroup',
            { label: 'Type' },
            types.map((t) => opt(`type:${t}`, TYPE_NAMES[t] || t)),
          )
        : null,
    );
  }

  // FLIP: rows that survive a redraw move from their old position instead of jumping.
  // R2-6: scroll anchoring. The page height is held for the collapse (so the browser never clamps the scroll and
  // jumps), and the first surviving row that was on screen keeps its exact place: no blank frame, no jump.
  // R3-1 / N2: ONE scroll correction, instant, in the same task as the DOM swap (before paint), never smooth.
  // With a focus row (the next open fix): its final layout top lands under the top bar when it is not already in the
  // comfortable zone. Without one: anchor only on a row that was really on screen (bar <= top < innerHeight); a row
  // below the viewport moves up with the collapse and used to drag the scroll to ~0.
  // After a jump, FLIP offsets are capped (a short settle in the direction of travel) so no frame shows an empty
  // viewport while a row glides in from offscreen. Returns true when the page was moved.
  let holdTimer = 0;
  const layoutTop = (n) => {
    let y = 0;
    for (let p = n; p; p = p.offsetParent) y += p.offsetTop;
    return y;
  };
  function flipDraw(focusId = null) {
    const tops = new Map(
      [...el.querySelectorAll('.fix')].map((n) => [n.dataset.id, n.getBoundingClientRect().top]),
    );
    const bar = document.querySelector('.topbar')?.getBoundingClientRect().bottom || 0;
    clearTimeout(holdTimer);
    if (holdScroll) {
      removeEventListener('scroll', holdScroll);
      holdScroll = null;
    }
    el.style.minHeight = `${el.offsetHeight}px`;
    draw();
    const y0 = scrollY;
    const target =
      focusId == null ? null : el.querySelector(`.fix[data-id="${CSS.escape(String(focusId))}"]`);
    if (target) {
      const y = layoutTop(target),
        top = y - y0;
      // R14: the next fix usually lands exactly where the done one was; moving the page then hid the header, tabs and
      // filters for nothing. Only scroll when its heading is under the bar or low on the screen.
      if (top < bar + 8 || top > innerHeight * 0.7)
        scrollTo({ top: Math.max(0, y - bar - 16), behavior: 'instant' });
    } else {
      for (const [id, top] of tops) {
        if (top < bar || top >= innerHeight) continue;
        const now = el.querySelector(`.fix[data-id="${CSS.escape(id)}"]`);
        if (!now) continue;
        const d = layoutTop(now) - y0 - top;
        if (Math.abs(d) > 1) scrollTo({ top: Math.max(0, y0 + d), behavior: 'instant' });
        break;
      }
    }
    const jumped = Math.abs(scrollY - y0) > 1;
    holdTimer = setTimeout(releaseHold, 700);
    if (reducedMotion()) return jumped;
    // D1: the cap applies always, jump or not. A row never starts from where it was (often 1000px+ away, offscreen):
    // it starts at most 32px from its final spot and settles in the direction of travel, so whatever is on screen
    // after the swap stays on screen every frame.
    const cap = 32,
      vh = innerHeight;
    for (const n of el.querySelectorAll('.fix')) {
      const now = layoutTop(n) - scrollY;
      let dy = (tops.get(n.dataset.id) ?? NaN) - now;
      if (!dy || Number.isNaN(dy) || Math.abs(dy) < 1) continue;
      if (now > vh || now + n.offsetHeight < 0) continue;
      dy = Math.sign(dy) * Math.min(Math.abs(dy), cap);
      n.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], {
        duration: 240,
        easing: 'cubic-bezier(.22,1,.36,1)',
      });
    }
    return jumped;
  }
  // D2: the held min-height is never dropped in one go when that would make the browser clamp the scroll (near the
  // page end it jolted the page ~54px). Release only the slack below the viewport; keep the rest until the user
  // scrolls up, trimming as they go. The viewport itself never moves.
  let holdScroll = null;
  function releaseHold() {
    if (holdScroll) {
      removeEventListener('scroll', holdScroll);
      holdScroll = null;
    }
    if (!el.style.minHeight) return;
    if (!el.isConnected) {
      el.style.minHeight = '';
      return;
    }
    const held = el.offsetHeight,
      box = el.getBoundingClientRect();
    // Content bottom + padding, without the last margin: never above the real height, so the shrink stays <= slack.
    let natural = 0;
    for (const c of el.children)
      natural = Math.max(natural, c.getBoundingClientRect().bottom - box.top);
    natural += parseFloat(getComputedStyle(el).paddingBottom) || 0;
    const slack = Math.max(0, document.documentElement.scrollHeight - innerHeight - scrollY);
    if (held - slack <= natural) {
      el.style.minHeight = '';
      return;
    }
    el.style.minHeight = `${Math.ceil(held - slack)}px`;
    let raf = 0;
    holdScroll = () => {
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          releaseHold();
        });
    };
    addEventListener('scroll', holdScroll, { passive: true });
  }

  const evidenceList = (answers) =>
    h(
      'ul.evidence-list',
      answers.map((a) =>
        h(
          'li',
          h(
            'button.evidence-row',
            {
              type: 'button',
              onclick: () =>
                openAnswer(
                  a.id,
                  answers.map((x) => x.id),
                ),
            },
            h('span.ev-engine', a.engine),
            h('span.ev-q', `“${a.question}”`),
            labelPill(a.label),
          ),
        ),
      ),
    );

  function websiteComparison(f) {
    const observations = data.websiteObservations || [];
    const find = (id) => observations.find((o) => o.id === id);
    const timestamp = (o) => Number(o?.collected_at) || Date.parse(o?.collected_at) || 0;
    const observation = (o, label, id) =>
      h(
        'div.fix-observation',
        h('strong', label),
        o
          ? [
              h(
                'p.small',
                `${date(timestamp(o), true)} · ${o.outcome}${o.data?.status ? ` · HTTP ${o.data.status}` : ''}`,
              ),
              h('p.small', o.data?.url || o.source_url),
              h('p.muted.small', `Observation ${o.id}`),
              h('p.muted.small', `SHA-256: ${o.data?.sha256 || 'Not available'}`),
              h('p.small', `Page title: ${o.data?.facts?.title || 'Not observed'}`),
              h(
                'p.small',
                `Schema types: ${Array.isArray(o.data?.facts?.schemaTypes) ? o.data.facts.schemaTypes.join(', ') || 'Not observed' : 'Not assessed'} (${o.data?.facts?.schemaStatus || 'unknown'})`,
              ),
            ]
          : h(
              'p.muted.small',
              `Saved observation ${id || 'not available'} is unavailable in this view. Its absence does not prove a website condition.`,
            ),
      );
    const eventView = (event) =>
      h(
        'div.fix-verification-event',
        h(
          'p',
          h('strong', CONDITION_LABELS[event.status] || CONDITION_LABELS.unknown),
          ` · ${CHANGE_LABELS[event.change] || CHANGE_LABELS.unknown}`,
        ),
        h(
          'p.small',
          `${event.condition?.kind === 'schemaType' ? 'Schema type' : 'Page title'}: “${event.condition?.value || ''}”`,
        ),
        h('p.small', event.targetUrl),
        h('p.muted.small', `Recorded ${date(event.checkedAt, true)} · Check ${event.id}`),
        h(
          'div.fix-observation-pair',
          observation(find(event.beforeObservationId), 'Before', event.beforeObservationId),
          observation(find(event.afterObservationId), 'After', event.afterObservationId),
        ),
        h('p.muted.small', event.scope),
        h('p.muted.small', event.visibility),
      );
    const needsRefresh = verificationRefreshFailed.has(f.id);
    const history = needsRefresh ? [] : f.verification?.history || [];
    const latest = needsRefresh ? null : f.verification?.latest;
    const before = find(f.originalObservationId);
    const later = before
      ? observations
          .filter((o) => timestamp(o) > timestamp(before))
          .sort((a, b) => timestamp(b) - timestamp(a))
      : [];
    const panel = h(
      'section.fix-verification',
      { 'aria-label': 'Saved website condition comparison' },
      h(
        'p.muted.small',
        'Compare saved static page observations. This does not change the agency’s done status or establish an effect on AI answers.',
      ),
      needsRefresh
        ? h(
            'p.field-error',
            { tabindex: '-1', dataset: { verificationResult: f.id } },
            'A comparison was saved, but the latest history could not be refreshed. Reload before relying on this view.',
          )
        : latest
          ? h(
              'div.fix-verification-latest',
              h(
                'h5',
                { tabindex: '-1', dataset: { verificationResult: f.id } },
                'Latest saved comparison',
              ),
              eventView(latest),
            )
          : h(
              'p.muted.small',
              'No saved condition comparison. Marking done alone does not verify implementation.',
            ),
      history.length
        ? h(
            'details.fix-verification-history',
            h('summary', `Review comparison history (${history.length})`),
            h(
              'p.muted.small',
              'Each check is a saved record. Earlier checks and historical reports remain unchanged; an older pass does not replace a later unknown result.',
            ),
            history.map((event) => h('div.fix-history-item', eventView(event))),
          )
        : null,
    );
    if (!f.canVerify || !before) {
      panel.append(
        h(
          'p.muted.small',
          'This fix has no supported original website observation. Historical or sample fixes cannot be compared here.',
        ),
      );
      return panel;
    }
    if (state.me.user?.workspaceRole !== 'owner') {
      panel.append(
        h('p.muted.small', 'The workspace owner can review and save a condition comparison.'),
      );
      return panel;
    }
    if (!later.length) {
      panel.append(
        h(
          'p.muted.small',
          'No later saved observation is available. A later scan with website inspection enabled can collect one through the bounded scan flow. This control never fetches the website.',
        ),
      );
      return panel;
    }
    const prefix = `condition-${f.id}`;
    const after = h(
      'select',
      { id: `${prefix}-after`, required: true },
      later.map((o) => h('option', { value: o.id }, `${date(timestamp(o), true)} · ${o.outcome}`)),
    );
    const target = h('input', {
      id: `${prefix}-url`,
      type: 'url',
      required: true,
      value: before.data?.url || before.source_url || '',
      maxlength: 2048,
    });
    const kind = h(
      'select',
      { id: `${prefix}-kind` },
      h('option', { value: 'title' }, 'Exact page title'),
      h('option', { value: 'schemaType' }, 'Schema type'),
    );
    const value = h('input', {
      id: `${prefix}-value`,
      type: 'text',
      required: true,
      maxlength: 200,
      autocomplete: 'off',
    });
    const reviewed = h('input', { type: 'checkbox', required: true });
    const previews = h('div.fix-observation-pair');
    const preview = () =>
      clear(
        previews,
        observation(before, 'Original observation', before.id),
        observation(find(after.value), 'Selected later observation', after.value),
      );
    after.addEventListener('change', () => {
      reviewed.checked = false;
      preview();
    });
    kind.addEventListener('change', () => {
      reviewed.checked = false;
    });
    target.addEventListener('input', () => {
      reviewed.checked = false;
    });
    value.addEventListener('input', () => {
      reviewed.checked = false;
    });
    preview();
    const error = h('p.field-error', { hidden: true, role: 'alert', tabindex: '-1' });
    const save = button('Save condition comparison', { type: 'submit', size: 'sm' });
    const form = h(
      'form.fix-verification-form',
      {
        onsubmit: async (e) => {
          e.preventDefault();
          if (!form.reportValidity() || save.disabled) return;
          const payload = {
            beforeObservationId: before.id,
            afterObservationId: after.value,
            targetUrl: target.value.trim(),
            condition: { kind: kind.value, value: value.value.trim() },
            reviewed: reviewed.checked,
          };
          error.hidden = true;
          await busy(save, async () => {
            let recorded = false;
            try {
              await api(`/api/app/fixes/${f.id}/verify`, { method: 'POST', data: payload });
              recorded = true;
              // An exact replay can return an older event. Only the server's ordered history establishes the latest result.
              data = await api(`/api/app/clients/${ctx.id}/fixes`);
              verificationRefreshFailed.delete(f.id);
              draw();
              el.querySelector(`[data-verification-result="${f.id}"]`)?.focus();
              toast('Condition comparison saved. Agency status is unchanged.');
            } catch (err) {
              if (recorded) {
                verificationRefreshFailed.add(f.id);
                draw();
                el.querySelector(`[data-verification-result="${f.id}"]`)?.focus();
              } else {
                error.textContent = err.message || 'The comparison could not be saved. Try again.';
                error.hidden = false;
                error.focus();
              }
            }
          });
        },
      },
      h(
        'p.muted.small',
        'The original observation is fixed to this recommendation. Choose later evidence and one exact condition you have reviewed. Blocked, stale or unsupported evidence produces an unknown result.',
      ),
      h(
        'div.field',
        h('label.field-label', { for: `${prefix}-after` }, 'Later saved observation'),
        after,
      ),
      previews,
      h(
        'div.field',
        h('label.field-label', { for: `${prefix}-url` }, 'Exact final page URL'),
        target,
        h(
          'span.field-note',
          'Both observations must cover this same final page. A redirect to a different page cannot prove the condition.',
        ),
      ),
      h(
        'div.field-row',
        h(
          'div.field',
          h('label.field-label', { for: `${prefix}-kind` }, 'Condition to compare'),
          kind,
        ),
        h(
          'div.field',
          h('label.field-label', { for: `${prefix}-value` }, 'Expected exact value'),
          value,
        ),
      ),
      h(
        'label.check',
        reviewed,
        h('span', 'I reviewed the selected observations, page URL and exact condition.'),
      ),
      error,
      h('div.row', save),
    );
    panel.append(
      h('details.fix-verification-compose', h('summary', 'Compare saved observations'), form),
    );
    return panel;
  }

  function card(f, i) {
    const isOpen = open.has(f.id);
    const doneBtn = h(
      `button.done-toggle${f.status === 'done' ? '.checked' : ''}`,
      {
        type: 'button',
        disabled: f.status === 'stale',
        dataset: i === 0 ? { tour: 'fix-done' } : {},
        'aria-pressed': String(f.status === 'done'),
        'aria-label':
          f.status === 'done'
            ? `Mark “${fixTitle(f)}” as not done`
            : `Mark “${fixTitle(f)}” as done`,
        onclick: (e) => toggle(f, f.status === 'done' ? 'todo' : 'done', e.currentTarget),
      },
      icon('check', 16),
    );
    if (f.status !== 'stale') withTip(doneBtn, f.status === 'done' ? 'Mark not done' : 'Mark done');
    const details = isOpen
      ? h(
          'div.fix-body',
          h('div.fix-why', h('h4', 'Why'), h('p', fixWhy(f))),
          f.evidenceAnswers.length
            ? h('div', h('h4', 'Original answer evidence'), evidenceList(f.evidenceAnswers))
            : null,
          f.status === 'done'
            ? h(
                'div',
                h('h4', 'Latest AI-answer observation'),
                f.postDoneScan && f.latestAnswers?.length
                  ? evidenceList(f.latestAnswers)
                  : h('p.muted', 'No comparable answer has returned since this was marked done.'),
                h(
                  'p.muted.small',
                  'Answer changes do not verify that the website change was implemented or caused the result.',
                ),
              )
            : null,
          h(
            'div.code-block',
            h(
              'div.code-head',
              h(
                'span.code-lang',
                {
                  jsonld: 'HTML (JSON-LD)',
                  html: 'HTML',
                  markdown: 'Page outline',
                  text: 'Checklist',
                }[f.lang] || f.lang,
              ),
              h(
                'button.btn.btn-ghost.btn-sm.copy-btn',
                {
                  type: 'button',
                  onclick: (e) => copyText(f.code, 'Code copied', e.currentTarget),
                },
                h('span.copy-icon', icon('copy')),
                h('span.copied-icon', icon('check')),
                h('span.copy-label', 'Copy'),
                h('span.copied-label', 'Copied'),
              ),
            ),
            h(
              'pre',
              h(
                'code',
                h(
                  'span.gutter',
                  { 'aria-hidden': 'true' },
                  f.code.split('\n').map((_, n) => h('span', String(n + 1))),
                ),
                h('span.code-text', highlight(f.code, f.lang)),
              ),
            ),
          ),
          h('div', h('h4', 'How to verify'), h('p', f.verify)),
          // The website-evidence caveats live in one disclosure; it opens by itself when a saved comparison exists.
          h(
            'details.fix-checks',
            { open: !!(f.verification?.latest || verificationRefreshFailed.has(f.id)) },
            h('summary', 'How we checked this'),
            websiteComparison(f),
          ),
          h(
            'div.row.fix-actions',
            f.status === 'todo'
              ? button(
                  'Mark done',
                  { size: 'sm', onclick: (e) => toggle(f, 'done', e.currentTarget) },
                  'check',
                )
              : null,
            button(
              'Copy as ticket',
              {
                variant: 'secondary',
                size: 'sm',
                onclick: (e) =>
                  copyText(
                    ticketMarkdown(f, ctx.detail),
                    'Ticket copied. Paste it into Jira, Linear or Trello.',
                    e.currentTarget,
                  ),
              },
              'ticket',
            ),
            // U03: hand this fix to Xo in one click. The request is sent at once (askXo send:true); the draft comes back
            // as a card waiting for approval, so nothing ships from this button. Never on a diagnostic (not a fix).
            f.status === 'todo' && !isDiagnostic(f) && xoAvailable()
              ? button(
                  'Draft with Xo',
                  {
                    variant: 'secondary',
                    size: 'sm',
                    onclick: (e) =>
                      askXo(
                        `Draft the fix “${fixTitle(f)}” for ${ctx.detail.name}, ready for me to review.`,
                        e.currentTarget,
                        { send: true },
                      ),
                  },
                  'message',
                )
              : null,
            f.status === 'wont'
              ? button(
                  'Reopen',
                  {
                    variant: 'ghost',
                    size: 'sm',
                    onclick: (e) => setStatus(f, 'todo', e.currentTarget),
                  },
                  'undo',
                )
              : f.status === 'todo'
                ? button('Won’t do', {
                    variant: 'ghost',
                    size: 'sm',
                    onclick: (e) => setStatus(f, 'wont', e.currentTarget),
                  })
                : null,
          ),
        )
      : null;
    return h(
      `article.fix.fix-${f.status}`,
      {
        dataset: { id: f.id, ...(i === 0 ? { tour: 'fix' } : {}) },
        class: [isOpen ? 'open' : '', justOpened === f.id ? 'just-opened' : ''].join(' '),
      },
      h(
        'div.fix-head',
        doneBtn,
        h(
          'div.fix-main',
          h('h3', fixTitle(f)),
          h(
            'div.fix-meta',
            badge('impact', f.impact, defs.impact),
            badge('evidence', f.evidence, defs.evidence),
          ),
          h(
            'p.fix-sub',
            [TYPE_NAMES[f.type] || f.type, f.engines.join(', ')].filter(Boolean).join(' · ') +
              '\u00a0· ',
            h(
              'a.ext',
              { href: f.url, target: '_blank', rel: 'noopener noreferrer', title: f.url },
              h('span.ext-text', f.url.replace(/^https?:\/\//, '')),
              icon('external', 13),
            ),
            f.status === 'done'
              ? h(
                  'span',
                  ' · ',
                  h('span.fix-done-tag', icon('check', 13), `Done ${date(f.doneAt)}`),
                  `${f.postDoneScan ? ` · latest scan: ${f.nowMentioned} of ${plural(f.latestReturned, 'returned target answer')} mention the client` : ' · awaiting a rescan'}`,
                )
              : f.status === 'wont'
                ? h('span', ' · Won’t do')
                : f.status === 'stale'
                  ? h('span', ' · No longer supported by the latest scan')
                  : f.gain
                    ? h('span', ` · Linked to ${plural(f.gain, 'missed answer')}`)
                    : null,
          ),
          csvState.get(f.id)?.state === 'sent'
            ? h(
                'p.handoff-tag',
                icon('download', 13),
                `In a CSV export${csvState.get(f.id).lastAt ? ` · ${date(csvState.get(f.id).lastAt)}` : ''}`,
              )
            : csvState.get(f.id)?.state === 'changed'
              ? h('p.handoff-tag.changed', icon('alert', 13), 'Changed since the last CSV export')
              : null,
        ),
        h(
          'button.icon-btn.expand',
          {
            type: 'button',
            'aria-expanded': String(isOpen),
            'aria-label': isOpen ? 'Hide details' : 'Show details',
            onclick: () => {
              isOpen ? open.delete(f.id) : open.add(f.id);
              justOpened = isOpen ? null : f.id;
              draw();
            },
          },
          icon('chevronRight'),
        ),
      ),
      details,
    );
  }

  // No Xo inside the data view: an icon, one line and a way back.
  function filteredEmpty() {
    const plain = filters.status === 'open' && !filters.engine && !filters.type;
    const go = (status) => () => {
      filters.status = status;
      filters.engine = '';
      filters.type = '';
      draw();
    };
    return h(
      'div.filtered-empty',
      h('span.fe-icon', icon(plain ? 'check' : 'search', 20)),
      h('h3', plain ? 'No open fixes' : 'No fixes match these filters'),
      h(
        'p',
        plain ? 'Everything here is done or set aside.' : 'Try another status, engine or type.',
      ),
      plain
        ? button('See done fixes', { variant: 'secondary', size: 'sm', onclick: go('done') })
        : button('Clear filters', { variant: 'secondary', size: 'sm', onclick: go('open') }),
    );
  }

  // Download the CSV, then record exactly the fixes in the file as handed off (channel csv, max 100 per call).
  // The IDs come from the file's "Fix ID" column, so "only new" exports never mark fixes that were left out.
  async function exportCsv(btn, onlyNew) {
    await busy(btn, async () => {
      let blob, name;
      try {
        const res = await fetch(
          `/api/app/clients/${ctx.id}/fixes.csv${onlyNew ? '?only=new' : ''}`,
          { credentials: 'same-origin' },
        );
        if (res.status === 401) {
          location.assign('/login?next=' + encodeURIComponent(location.pathname + location.hash));
          return;
        }
        if (!res.ok) throw new Error('The CSV could not be created. Try again.');
        blob = await res.blob();
        name =
          /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] ||
          `${ctx.detail.name} fixes.csv`;
      } catch (err) {
        errorToast(err);
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: name, hidden: true });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      const ids = csvFixIds(await blob.text());
      if (!ids.length) {
        toast('The CSV has no fixes in it, so nothing was marked as handed off.');
        return;
      }
      try {
        for (let i = 0; i < ids.length; i += 100)
          await api(`/api/app/clients/${ctx.id}/handoffs`, {
            method: 'POST',
            data: { fixIds: ids.slice(i, i + 100), channel: 'csv' },
          });
        const now = Date.now();
        ids.forEach((id) =>
          csvState.set(id, {
            state: 'sent',
            count: (csvState.get(id)?.count || 0) + 1,
            lastAt: now,
          }),
        );
        toast(
          `CSV downloaded with ${plural(ids.length, 'fix', 'fixes')}, now tagged “In a CSV export”.`,
        );
      } catch {
        toast('CSV downloaded, but the export was not recorded. Export again to record it.', {
          tone: 'error',
        });
        return;
      }
      draw();
      el.querySelector('[data-export]')?.focus({ preventScroll: true });
    });
  }

  // "We couldn’t check the website" is a notice, not a fix: no card, no Mark done, never counted.
  const websiteNotices = () =>
    (data.notices || []).map((n) =>
      h('div.notice.notice-soft', icon('info'), h('p', h('strong', fixTitle(n)), ' ', fixWhy(n))),
    );

  function draw() {
    const all = data.fixes;
    if (!all.length) {
      return clear(
        el,
        ...websiteNotices(),
        emptyState({
          pose: 'happy',
          title: ctx.detail.latest ? 'No fixes this week' : 'Fixes appear after the first scan',
          text: ctx.detail.latest
            ? `${ctx.detail.name} is mentioned in ${ctx.detail.latest.mentioned} of ${ctx.detail.latest.ok} answers.`
            : 'Run a scan and the misses turn into ranked fixes.',
          actions: [
            ctx.detail.latest
              ? h('a.btn', { href: `#/clients/${ctx.id}/answers` }, 'See answers')
              : button(
                  'Run first scan',
                  { onclick: (e) => ctx.startScan(e.currentTarget) },
                  'play',
                ),
          ],
        }),
      );
    }
    // U09: only the website-check diagnostic, no ranked work. No filters, progress or action bar to "complete" a
    // notice: the empty state says so, and the diagnostic reads as a quiet note under it.
    if (all.every(isDiagnostic)) {
      const notes = all.filter((f) => f.status === 'todo');
      return clear(
        el,
        h(
          'div.section-head',
          h(
            'div',
            h('h2', 'Fixes'),
            h('p.muted', 'Ranked by current missed answers and evidence.'),
          ),
        ),
        strip,
        h(
          'div.filtered-empty',
          h('span.fe-icon', icon('list', 20)),
          h('h3', 'No ranked fixes yet'),
          h(
            'p',
            ctx.detail.latest
              ? `${ctx.detail.name} is mentioned in ${ctx.detail.latest.mentioned} of ${ctx.detail.latest.ok} answers. The answers show what each engine said.`
              : 'Run a scan and the misses turn into ranked fixes.',
          ),
          ctx.detail.latest
            ? h(
                'a.btn.btn-secondary.btn-sm',
                { href: `#/clients/${ctx.id}/answers` },
                'See answers',
              )
            : button(
                'Run first scan',
                { size: 'sm', onclick: (e) => ctx.startScan(e.currentTarget) },
                'play',
              ),
        ),
        notes.map((f) =>
          h(
            'div.notice.notice-soft',
            { role: 'note' },
            icon('info', 18),
            h('p', h('strong', fixTitle(f)), h('br'), fixWhy(f)),
          ),
        ),
      );
    }
    const firstTodo =
      all.find((f) => f.status === 'todo' && !isDiagnostic(f)) ||
      all.find((f) => f.status === 'todo');
    // D7: the first open fix opens itself once per visit; after the user hides it, it stays hidden.
    if (!open.size && firstTodo && !autoOpened) {
      open.add(firstTodo.id);
      autoOpened = true;
    }
    const shown = all.filter(
      (f) =>
        (filters.status === 'all' ||
          (filters.status === 'open' ? f.status === 'todo' : f.status === filters.status)) &&
        (!filters.engine || f.engines.includes(filters.engine)) &&
        (!filters.type || f.type === filters.type),
    );
    // Counts and progress cover fixes only; the server keeps the website-check notice out of `fixes`.
    const work = all;
    const done = work.filter((f) => f.status === 'done').length,
      live = work.filter((f) => f.status !== 'wont' && f.status !== 'stale').length;
    const seg = (
      key,
      label,
      n = key === 'all'
        ? work.length
        : work.filter((f) => (key === 'open' ? f.status === 'todo' : f.status === key)).length,
    ) =>
      h(
        'button.seg',
        {
          type: 'button',
          dataset: { key },
          'aria-pressed': String(filters.status === key),
          onclick: () => {
            filters.status = key;
            draw();
          },
        },
        label,
        n ? h('span.count', String(n)) : null,
      );
    // U3: up to 10 live fixes show as pips; the pip that was just earned fills green (scaleX, 240ms ease-out).
    const progressBar =
      live && live <= 10
        ? h(
            'div.fix-pips',
            { 'aria-hidden': 'true', style: { '--n': live } },
            Array.from({ length: live }, (_, i) =>
              h('span', {
                class:
                  i < done ? (lastDoneCount !== null && i >= lastDoneCount ? 'on fill' : 'on') : '',
              }),
            ),
          )
        : meter(live ? done / live : 0, 'meter-green', lastDone);
    // A filter set from the link stays selectable even when no fix names that engine or type (it shows the empty state).
    if (filters.engine) engineNote = null; // picking an engine answers the notice
    const engines = [
        ...new Set([...all.flatMap((f) => f.engines), ...(filters.engine ? [filters.engine] : [])]),
      ],
      types = [...new Set([...all.map((f) => f.type), ...(filters.type ? [filters.type] : [])])];
    clear(
      el,
      h(
        'div.section-head',
        h(
          'div',
          h('h2', 'Fixes'),
          h(
            'p.muted',
            'Ranked by current missed answers and evidence. Open a fix to review its reasoning.',
          ),
        ),
        h(
          'button.btn.btn-secondary',
          {
            type: 'button',
            dataset: { export: '' },
            onclick: (e) => exportCsv(e.currentTarget, false),
          },
          icon('download'),
          h('span', 'Export CSV'),
        ),
      ),
      strip,
      ...websiteNotices(),
      engineNote,
      (() => {
        // Once some fixes are in a CSV export, offer the smaller file: only fixes that are new or changed since then.
        const sent = all.filter((f) => csvState.get(f.id)?.state === 'sent').length,
          fresh = all.filter(
            (f) => csvState.has(f.id) && csvState.get(f.id).state !== 'sent',
          ).length;
        if (!sent) return null;
        return h(
          'p.csv-note',
          h('span', `${plural(sent, 'fix is', 'fixes are')} already in a CSV export.`),
          fresh
            ? h(
                'button.btn.btn-ghost.btn-sm',
                { type: 'button', onclick: (e) => exportCsv(e.currentTarget, true) },
                icon('download', 16),
                h('span', `Export only the ${fresh} new or changed`),
              )
            : h('span', 'Nothing new since the last export.'),
        );
      })(),
      h(
        'div.card.fix-toolbar',
        h(
          'div.fix-progress',
          h(
            'div.fix-progress-head',
            h(
              'strong',
              live ? `${done} of ${plural(live, 'fix', 'fixes')} done` : 'No ranked fixes yet',
            ),
            data.estimate
              ? hint(
                  work.some((f) => f.status === 'todo')
                    ? `Now ${data.estimate.current} of ${data.estimate.total} answers name the client. ${data.estimate.projected - data.estimate.current} currently missed answers are linked to open fixes; results are unverified.`
                    : `Now ${data.estimate.current} of ${data.estimate.total} answers name the client. Rescan to see what changed.`,
                )
              : null,
          ),
          progressBar,
        ),
        h(
          'div.filters',
          segScroll(
            h(
              'div.segmented',
              { role: 'group', 'aria-label': 'Status' },
              seg('open', 'Open'),
              seg('done', 'Done'),
              seg('wont', 'Won’t do'),
              seg('stale', 'Stale'),
              seg('all', 'All'),
            ),
          ),
          h(
            'select',
            {
              'aria-label': 'Engine',
              onchange: (e) => {
                filters.engine = e.target.value;
                draw();
              },
            },
            h('option', { value: '' }, 'All engines'),
            engines.map((e) => h('option', { value: e, selected: filters.engine === e }, e)),
          ),
          h(
            'select',
            {
              'aria-label': 'Type',
              onchange: (e) => {
                filters.type = e.target.value;
                draw();
              },
            },
            h('option', { value: '' }, 'All types'),
            types.map((t) =>
              h('option', { value: t, selected: filters.type === t }, TYPE_NAMES[t] || t),
            ),
          ),
          moreFilters(work, engines, types),
        ),
      ),
      shown.length ? h('div.fix-list', shown.map(card)) : filteredEmpty(),
    );
    justOpened = null;
    lastDone = live ? done / live : 0;
    lastDoneCount = done;
  }
  draw();
}
