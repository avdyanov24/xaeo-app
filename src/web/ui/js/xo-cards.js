// Xo action cards. The server builds the card JSON from live DB state (xo/cards.mjs) and
// `actions` is only a hint: every button posts to a route that re-checks role and state. Kinds: scan (Run scan /
// Not now) and artifact (M2.2: draft -> pending -> approved -> applied, side exit rejected). Outcome cards: M3.2.
// A card whose cardId is already on screen is replaced in place (replaceCard). Artifact cards are also kept in sync
// by artifactId everywhere they show (chat, #/approvals, the artifact drawer), because the dashboard and the chat
// can hold different card rows for the same artifact. Every change is announced as `xaeo:artifact` for the badges.
// Untrusted text (titles, summaries, code, URLs) only ever reaches the page as text nodes via h().
import {
  api,
  h,
  clear,
  icon,
  plural,
  busy,
  friendlyError,
  toast,
  highlight,
  drawer,
  date,
} from './lib.js';
import { go, state } from './main.js';

const BUTTONS = { run_scan: 'Run scan', dismiss: 'Not now' };
const COARSE = matchMedia('(pointer: coarse)');
const shown = new WeakMap(); // card element -> { card, opts }

const KIND = {
  fix: ['zap', 'Fix'],
  jsonld: ['code', 'JSON‑LD'],
  llms_txt: ['list', 'llms.txt'],
  page: ['file', 'Page draft'],
  outreach: ['message', 'Outreach'],
};
const STATE = {
  draft: ['pencil', 'Draft'],
  pending: ['clock', 'Waiting for approval'],
  approved: ['check', 'Approved'],
  applied: ['check', 'Exported'],
  rejected: ['x', 'Rejected'],
  verified: ['check', 'Verified'],
};
const RISK = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' };
const LANG = { html: 'HTML', json: 'JSON', markdown: 'Markdown', text: 'Text' };
// Preview length: 12 lines, 6 on phones (R9: the draft card stays near one phone screen; "Show all" opens the rest).
const PREVIEW = matchMedia('(max-width: 559px)');
const previewLines = () => (PREVIEW.matches ? 6 : 12);
const HAS_HOLE = /FILL_IN_[A-Z0-9_]+/;
const expanded = new Set(); // artifactIds whose code preview is open (survives a card swap)
const fullFile = new Set(); // llms.txt cards showing the whole file instead of the diff

// A scan started anywhere else in the app (lib.js scanStarted: client header, clients list) closes this client's open
// scan cards on the server (closeScanCards); the cards on screen follow at once, so none keeps offering "Run scan".
addEventListener('xaeo:scan-started', (e) => {
  document
    .querySelectorAll(
      `.xo-card[data-state="open"][data-client-id="${CSS.escape(String(e.detail?.clientId || ''))}"]`,
    )
    .forEach((el) => {
      const card = shown.get(el)?.card;
      if (card) replaceCard(document, { ...card, state: 'done', actions: [] });
    });
});

// renderCard(card, opts) -> element, or null for card kinds this build does not show yet.
// opts: { showClient } names the client in the meta line (cross-client lists); { inDrawer } is the drawer's copy.
export function renderCard(card, opts = {}) {
  if (card?.kind === 'artifact' && card.artifact) return renderArtifact(card, opts);
  if (card?.kind === 'outcome' && card.outcome) return renderOutcome(card, opts);
  if (card?.kind !== 'scan' || !card.scan) return null;
  const { scan } = card;
  const engines = scan.engines.map((e) => e.name);
  const meta = [
    plural(scan.questions, 'buyer question'),
    engines.length ? engines.join(', ') : 'no engine available',
  ].join(' · ');
  const status =
    card.state === 'done'
      ? [
          icon('check', 16),
          'Scan started.',
          h('a', { href: `#/clients/${card.clientId}/overview` }, 'See progress'),
        ]
      : card.state === 'dismissed'
        ? ['Not now. Ask Xo again when you want a scan.']
        : scan.running
          ? [icon('clock', 16), 'A scan is already running for this client.']
          : scan.dailyBudgetState === 'budget-exhausted'
            ? [icon('info', 16), 'Today’s scan budget is used up.']
            : !engines.length
              ? [icon('info', 16), 'Connect an engine on the Engines page first.']
              : null;
  const actions = card.actions
    .filter((a) => BUTTONS[a])
    .map((a) =>
      a === 'run_scan'
        ? h(
            'button.btn.btn-sm',
            { type: 'button', onclick: (e) => runScan(e.currentTarget, card) },
            icon('play', 16),
            h('span', BUTTONS[a]),
          )
        : h(
            'button.btn.btn-ghost.btn-sm',
            { type: 'button', onclick: (e) => dismiss(e.currentTarget, card) },
            h('span', BUTTONS[a]),
          ),
    );
  const el = h(
    'article.xo-card',
    {
      dataset: { cardId: card.cardId, clientId: card.clientId, state: card.state },
      'aria-label': `Scan ${card.clientName || 'this client'}`,
    },
    h(
      'div.xo-card-head',
      h('span.xo-card-icon', icon('refresh', 18)),
      h(
        'div.xo-card-copy',
        h('h3', `Scan ${card.clientName || 'this client'}`),
        h('p.xo-card-meta', meta),
      ),
    ),
    status ? h('p.xo-card-status', status) : null,
    actions.length ? h('div.row.xo-card-actions', actions) : null,
  );
  shown.set(el, { card, opts });
  return el;
}

// Swap a card already on screen for its new state; returns false when it is not shown in `root`.
// `focus`: the action that led here was pressed inside this card (its button is disabled while busy, so by now the
// browser may already have dropped focus to <body>). Artifact cards update every copy on screen (syncCard).
export function replaceCard(root, card, { focus = false } = {}) {
  const old = root.querySelector(`[data-card-id="${CSS.escape(card.cardId)}"]`);
  if (card?.kind === 'artifact') {
    syncCard(card, { focusEl: focus ? old : null });
    return !!old;
  }
  const next = old && renderCard(card, shown.get(old)?.opts);
  if (!next) return false;
  swap(old, next, focus);
  return true;
}

function swap(old, next, focus) {
  next.classList.add('swap');
  const a = document.activeElement;
  const focused = old.contains(a) || (focus && (!a || a === document.body));
  // The focused control keeps its place when it still exists (same action, same card); else the card's next action.
  const same =
    focused && a?.dataset?.act
      ? next.querySelector(`[data-act="${CSS.escape(a.dataset.act)}"]`)
      : null;
  old.replaceWith(next);
  // Focus never drops to <body>: it moves to the card's next action, else back to the Xo input (on touch, to the
  // card itself, so the phone keyboard does not pop up).
  if (focused) {
    const target =
      same ||
      next.querySelector('.xo-card-actions button, .xo-card-actions a') ||
      next.querySelector('button, a') ||
      (!COARSE.matches && document.querySelector('.xo-input:not([hidden])'));
    if (target && target.offsetParent) target.focus({ preventScroll: true });
    else {
      next.tabIndex = -1;
      next.focus({ preventScroll: true });
    }
  }
}

// syncCard(card): every element showing this artifact re-renders from the new card (each keeps its own cardId and
// options). An older card than the one on screen is ignored, so a slow response never rolls the state back.
export function syncCard(card, { focusEl = null } = {}) {
  if (card?.kind !== 'artifact' || !card.artifact) return;
  const id = card.artifact.artifactId;
  for (const el of document.querySelectorAll(`.xo-card[data-artifact-id="${CSS.escape(id)}"]`)) {
    const prev = shown.get(el);
    const was = prev?.card;
    if (
      was &&
      (was.artifact.version > card.artifact.version ||
        (was.artifact.version === card.artifact.version && was.updatedAt > card.updatedAt))
    )
      continue;
    swap(
      el,
      renderCard({ ...card, cardId: was?.cardId || card.cardId }, prev?.opts),
      el === focusEl,
    );
  }
  dispatchEvent(new CustomEvent('xaeo:artifact', { detail: { card } }));
}

const focusIn = (btn) => btn.contains(document.activeElement);

async function runScan(btn, card) {
  const focus = focusIn(btn);
  await busy(btn, async () => {
    try {
      await api(`/api/app/clients/${card.clientId}/scans`, { method: 'POST' });
    } catch (err) {
      // 409: a scan started elsewhere (dashboard, another tab) already closed this card on the server; show that
      // (the same "Scan started · See progress" a reload shows) instead of offering Run scan again.
      if (err.status === 409 && /already running/i.test(err.message || ''))
        return void replaceCard(document, { ...card, state: 'done', actions: [] }, { focus });
      toast(err.kind === 'request' ? friendlyError(err) : 'The scan didn’t start. Try again.', {
        tone: 'error',
      });
      return;
    }
    // The server marked the card done when the scan started; show that state now, then open the progress.
    replaceCard(document, { ...card, state: 'done', actions: [] }, { focus });
    go(`#/clients/${card.clientId}/overview`);
  });
}

async function dismiss(btn, card) {
  const focus = focusIn(btn);
  await busy(btn, async () => {
    try {
      const res = await api(`/api/app/xo/cards/${card.cardId}/dismiss`, { method: 'POST' });
      replaceCard(document, res.card, { focus });
    } catch (err) {
      // 409: someone started the scan or dismissed it already; the card stops offering buttons.
      if (err.status === 409) replaceCard(document, { ...card, actions: [] }, { focus });
      toast(friendlyError(err), { tone: 'error' });
    }
  });
}

// ---- artifact cards ----

// "https://northsideplumbing.co.uk/emergency/" -> "northsideplumbing.co.uk/emergency"
const shortUrl = (url) => {
  try {
    const u = new URL(url);
    return (u.host + u.pathname).replace(/\/$/, '');
  } catch {
    return String(url).slice(0, 80);
  }
};
// FILL_IN_PHONE_NUMBER -> "Phone number" when the server sent no hint.
const humanize = (name) => {
  const t = name
    .replace(/^FILL_IN_/, '')
    .replace(/_\d+$/, '')
    .replace(/_/g, ' ')
    .toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const inputType = (name) =>
  /PHONE|TEL/.test(name)
    ? { type: 'tel', inputmode: 'tel', autocomplete: 'off' }
    : /EMAIL/.test(name)
      ? { type: 'email', autocomplete: 'off' }
      : /URL|LINK|WEBSITE/.test(name)
        ? { type: 'url', inputmode: 'url', autocomplete: 'off' }
        : { type: 'text', autocomplete: 'off' };
// F1-6: light, forgiving checks where the field type is clear from its name; free text only needs a value.
// Returns the helper line for an implausible value, or '' when it is fine.
const FIELD_CHECK = {
  tel: (v) =>
    /^[\d+\s\-().]+$/.test(v) && (v.match(/\d/g) || []).length >= 7
      ? ''
      : 'Use a phone number with at least 7 digits. Spaces, +, - and brackets are fine.',
  email: (v) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? '' : 'Use an email address like name@example.com.',
  url: (v) => {
    try {
      const u = new URL(v);
      return /^https?:$/.test(u.protocol) && u.hostname.includes('.')
        ? ''
        : 'Use a web address that starts with https://.';
    } catch {
      return 'Use a web address that starts with https://.';
    }
  },
};
const fieldProblem = (input) => {
  const v = input.value.trim();
  return v && FIELD_CHECK[input.type] ? FIELD_CHECK[input.type](v) : '';
};

export const riskPill = (risk) =>
  h(
    `span.risk.risk-${RISK[risk] ? risk : 'medium'}`,
    risk === 'high' ? icon('alert', 12) : null,
    RISK[risk] || RISK.medium,
  );
export const stateChip = (st) => {
  const [glyph, label] = STATE[st] || STATE.draft;
  return h('span.xo-state', { dataset: { state: st } }, icon(glyph, 14), label);
};
export const kindIcon = (kind) => (KIND[kind] || KIND.page)[0];
export const kindLabel = (kind) => (KIND[kind] || KIND.page)[1];

// Outcome card (verify_fix): fixed labels per attribution level, before/after answer labels per engine, and the
// caveat line on every card (spec §6.2). All text from the server's fixed copy; rendered as text nodes only.
const OUTCOME = {
  cited_shipped_page: ['check', 'Cited after the change', 'verified'],
  changed_after_verified_ship: ['trending', 'Improved after the change', 'verified'],
  no_change: ['info', 'No change attributed', 'draft'],
  not_comparable: ['info', 'Not comparable', 'neutral'],
  pending: ['clock', 'Waiting for data', 'pending'],
};
const OUTCOME_ROWS = 6;
// Improved answers (before -> after went up: not named -> named, named -> cited) list first, so the 6 shown rows
// never hide them under "and N more". The sort is stable: the server's order holds within each group.
const RANK = { Cited: 2, Mentioned: 1 };
const improved = (c) => (RANK[c.after] || 0) > (RANK[c.before] || 0);
// Display only: a target path of "/" reads as the home page ("LocalBusiness schema for the home page").
export const displayTitle = (t) => String(t || '').replace(/ for \/$/, ' for the home page');
function renderOutcome(card, opts) {
  const o = card.outcome;
  const [glyph, label, tone] = OUTCOME[o.attribution] || OUTCOME.pending;
  const meta = [
    opts.showClient && card.clientName ? card.clientName : null,
    o.targetUrl ? shortUrl(o.targetUrl) : kindLabel(o.kind),
    o.checkedAt ? `Checked ${date(o.checkedAt)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  // Cells grouped by question, so a question's text shows once above its engines.
  const groups = [];
  for (const c of [...o.cells].sort((a, b) => improved(b) - improved(a)).slice(0, OUTCOME_ROWS)) {
    let g = groups.find((x) => x.questionId === c.questionId);
    if (!g) groups.push((g = { questionId: c.questionId, text: c.questionText, rows: [] }));
    g.rows.push(c);
  }
  const rest = o.cells.length - OUTCOME_ROWS;
  const cells = groups.length
    ? h(
        'div.xo-out-cells',
        groups.map((g) =>
          h(
            'div.xo-out-group',
            g.text ? h('p.xo-out-question', g.text) : null,
            h(
              'ul',
              g.rows.map((c) =>
                h(
                  'li',
                  h('span.xo-out-engine', c.engineName),
                  h(
                    'span.xo-out-labels',
                    h('span', c.before || 'No answer'),
                    icon('arrowRight', 14),
                    h('strong', c.after || 'Not measured yet'),
                  ),
                ),
              ),
            ),
          ),
        ),
        rest > 0 ? h('p.xo-card-meta', `and ${plural(rest, 'more answer')}`) : null,
      )
    : null;
  const el = h(
    'article.xo-card.xo-out',
    {
      dataset: {
        cardId: card.cardId,
        clientId: card.clientId,
        state: card.state,
        artifactId: o.artifactId,
        attribution: o.attribution,
      },
      'aria-label': `Result: ${displayTitle(o.title)}`,
    },
    h(
      'div.xo-card-head',
      h('span.xo-card-icon', icon('trending', 18)),
      h('div.xo-card-copy', h('h3', displayTitle(o.title)), h('p.xo-card-meta', meta)),
    ),
    h('div.xo-art-state', h('span.xo-state', { dataset: { state: tone } }, icon(glyph, 14), label)),
    h('p.xo-card-status', o.attributionText),
    o.siteCondition?.message
      ? h('p.xo-art-note', icon('info', 16), h('span', o.siteCondition.message))
      : null,
    cells,
    h('p.xo-out-caveat', o.caveat),
  );
  shown.set(el, { card, opts });
  return el;
}

function renderArtifact(card, opts) {
  const a = card.artifact;
  const st = card.state;
  const can = new Set(card.actions);
  const meta = [
    opts.showClient && card.clientName ? card.clientName : null,
    kindLabel(a.kind),
    a.targetUrl ? shortUrl(a.targetUrl) : null,
    a.version > 1 ? `Version ${a.version}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const claimNote = a.notes.find((n) => /could not be matched/i.test(n));
  const notes = a.notes.filter((n) => n !== claimNote);
  const fillable = can.has('edit') && a.placeholders.length && ['pending', 'draft'].includes(st);
  // U04: someone who may decide sees Approve from the start. It stays disabled until every value is filled in, then
  // one click saves the values (a new version) and approves that version. Only when the placeholders are the sole
  // reason Approve is missing; other blockers (white label, JSON-LD errors) still say what to fix first.
  const oneClick =
    fillable &&
    st === 'pending' &&
    can.has('reject') &&
    a.whiteLabelOk !== false &&
    (!a.approveBlockedBy || /placeholder/i.test(a.approveBlockedBy));
  const fill = fillable ? fillForm(card, { oneClick }) : null;
  // Approve is missing for a reason the server names; the inline form already says "fill these in", so its
  // placeholder reason is not repeated above it.
  const blocker =
    a.approveBlockedBy && !(fillable && /placeholder/i.test(a.approveBlockedBy))
      ? a.approveBlockedBy
      : null;
  const ownerOnly = st === 'pending' && !can.has('reject') && !can.has('approve');
  const status =
    st === 'approved'
      ? 'Approved. Copy or download it to ship it.'
      : st === 'applied'
        ? 'Ready to copy or download. The client’s site changes only when someone adds it there.'
        : st === 'rejected'
          ? 'Rejected. Nothing ships. Edit it to make a new draft, or ask Xo for another.'
          : st === 'draft'
            ? 'Draft. Xo asks for approval when it’s ready.'
            : null;

  const btn = (act, label, glyph, cls, onclick) =>
    h(
      `button.btn.btn-sm${cls}`,
      { type: 'button', dataset: { act }, onclick: (e) => onclick(e.currentTarget) },
      icon(glyph, 16),
      h('span', label),
    );
  const shipped = ['approved', 'applied'].includes(st);
  const actions = [
    can.has('approve')
      ? btn('approve', 'Approve', 'check', '', (b) => decide(b, card, 'approve'))
      : fill?.approve || null,
    can.has('copy')
      ? btn('copy', 'Copy code', 'copy', shipped ? '' : '.btn-secondary', (b) =>
          copyArtifact(b, card),
        )
      : null,
    can.has('download')
      ? btn('download', 'Download', 'download', '.btn-secondary', (b) => downloadArtifact(b, card))
      : null,
    can.has('edit')
      ? btn('edit', 'Edit', 'pencil', '.btn-secondary', (b) =>
          opts.inDrawer ? opts.onEdit?.(b) : openArtifact(card, { edit: true, from: b }),
        )
      : null,
    can.has('reject')
      ? btn('reject', 'Reject', 'x', '.btn-ghost', (b) => decide(b, card, 'reject'))
      : null,
  ].filter(Boolean);
  // U11: an approved draft offers the way back to its client's fixes (the next job), not a dead end.
  const back =
    shipped && card.clientId
      ? h(
          'a.xo-art-more',
          {
            href: `#/clients/${encodeURIComponent(card.clientId)}/fixes`,
            dataset: { act: 'back' },
          },
          icon('arrowLeft', 16),
          h('span', card.clientName ? `Back to ${card.clientName} fixes` : 'Back to fixes'),
        )
      : null;
  const history = opts.inDrawer
    ? null
    : h(
        'button.xo-art-more',
        {
          type: 'button',
          dataset: { act: 'history' },
          onclick: (e) => openArtifact(card, { from: e.currentTarget }),
        },
        icon('clock', 16),
        h('span', 'History'),
      );

  const el = h(
    'article.xo-card.xo-art',
    {
      dataset: {
        cardId: card.cardId,
        clientId: card.clientId,
        state: st,
        artifactId: a.artifactId,
        risk: a.risk,
      },
      'aria-label': `${kindLabel(a.kind)}: ${displayTitle(a.title)}`,
    },
    h(
      'div.xo-card-head',
      h('span.xo-card-icon', icon(kindIcon(a.kind), 18)),
      h('div.xo-card-copy', h('h3', displayTitle(a.title)), h('p.xo-card-meta', meta)),
    ),
    // The risk pill belongs to the decision: it shows while a draft waits and leaves once it is approved (an edited
    // version can carry a different risk, which read as the risk silently changing on approve).
    h('div.xo-art-state', stateChip(st), shipped ? null : riskPill(a.risk)),
    a.summary && ['pending', 'draft'].includes(st) ? h('p.xo-art-summary', a.summary) : null,
    status ? h('p.xo-card-status', status) : null,
    // A plain block wrapper: the link's own auto margin (it shares the History style) has no effect here, so it sits
    // under the status line, left-aligned, instead of floating right on a line of its own.
    back ? h('div.xo-art-back', back) : null,
    notes.map((n) => h('p.xo-art-note', icon('info', 16), h('span', n))),
    a.unsupportedClaims.length
      ? h(
          'div.xo-art-claims',
          { role: 'note' },
          icon('alert', 16),
          h(
            'div',
            h(
              'p',
              claimNote ||
                'Some facts could not be matched to the website or client record and became placeholders.',
            ),
            h(
              'ul',
              a.unsupportedClaims.slice(0, 8).map((c) => h('li', c)),
            ),
          ),
        )
      : null,
    codeView(a, { full: opts.inDrawer }),
    fill?.form || null,
    blocker ? h('p.xo-art-blocked', icon('lock', 16), h('span', blocker)) : null,
    ownerOnly
      ? h(
          'p.xo-art-blocked',
          icon('lock', 16),
          h('span', 'Only the workspace owner can approve this one.'),
        )
      : null,
    // The foot is a size container: in a narrow card (400px dock, phone) the row becomes an even two-column grid.
    actions.length || history
      ? h('div.xo-art-foot', h('div.xo-card-actions.xo-art-actions', actions, history))
      : null,
  );
  shown.set(el, { card, opts });
  return el;
}

// Code preview: the first 12 lines with a "Show all" toggle (the drawer shows everything); llms.txt shows its diff.
// FILL_IN_ placeholders are marked in the code so the fields below are easy to match up.
function codeView(a, { full = false } = {}) {
  const diff = a.kind === 'llms_txt' && a.diff && !fullFile.has(a.artifactId);
  const text = diff ? a.diff : a.code;
  const lines = String(text).split('\n');
  const max = previewLines();
  const open = full || expanded.has(a.artifactId) || lines.length <= max + 2;
  const shownLines = open ? lines : lines.slice(0, max);
  const pre = h(
    'pre',
    {
      tabindex: '0',
      'aria-label': `${diff ? 'Changes' : 'Code'}, ${plural(lines.length, 'line')}`,
    },
    h(
      'code',
      h(
        'span.gutter',
        { 'aria-hidden': 'true' },
        shownLines.map((_, n) => h('span', String(n + 1))),
      ),
      h('span.code-text', diff ? diffLines(shownLines) : marked(shownLines.join('\n'), a.lang)),
    ),
  );
  const toggle = (label, on) =>
    h(
      'button.btn.btn-ghost.btn-sm.code-toggle',
      {
        type: 'button',
        onclick: (e) => {
          on();
          rerender(e.currentTarget);
        },
      },
      h('span', label),
    );
  const rerender = (from) => {
    const el = from.closest('.xo-card');
    const s = shown.get(el);
    if (s) swapQuiet(el, renderCard(s.card, s.opts), from);
  };
  return h(
    'div.code-block.xo-code',
    { dataset: { open: String(open) } },
    h(
      'div.code-head',
      h('span.code-lang', diff ? 'Changes to llms.txt' : LANG[a.lang] || a.lang),
      a.kind === 'llms_txt' && a.diff
        ? toggle(diff ? 'Show the whole file' : 'Show the changes', () => {
            if (diff) fullFile.add(a.artifactId);
            else fullFile.delete(a.artifactId);
          })
        : null,
    ),
    pre,
    !open
      ? h(
          'button.code-more',
          {
            type: 'button',
            'aria-expanded': 'false',
            onclick: (e) => {
              expanded.add(a.artifactId);
              rerender(e.currentTarget);
            },
          },
          icon('chevronDown', 16),
          h('span', `Show all ${lines.length} lines`),
        )
      : null,
  );
}
// A local re-render (preview toggle): no swap animation, focus stays on the same control or the code.
function swapQuiet(old, next, from) {
  const had = old.contains(document.activeElement);
  const label = from?.textContent;
  old.replaceWith(next);
  if (had)
    (next.querySelector('.xo-code pre') && label?.startsWith('Show all')
      ? next.querySelector('.xo-code pre')
      : [...next.querySelectorAll('.code-toggle')][0] || next.querySelector('.xo-code pre')
    )?.focus({ preventScroll: true });
}
function marked(code, lang) {
  const frag = highlight(code, lang === 'json' ? 'html' : lang);
  // Wrap each FILL_IN_ name in a hole span (text nodes only; highlight() never builds HTML from strings).
  const walker = document.createTreeWalker(frag, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode())
    if (HAS_HOLE.test(walker.currentNode.nodeValue)) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const parts = node.nodeValue.split(/(FILL_IN_[A-Z0-9_]+)/);
    node.replaceWith(
      ...parts
        .filter(Boolean)
        .map((p) => (/^FILL_IN_/.test(p) ? h('span.code-hole', p) : document.createTextNode(p))),
    );
  }
  return frag;
}
const diffLines = (lines) =>
  lines.map((line, i) => {
    const cls = /^\+(?!\+\+)/.test(line)
      ? 'add'
      : /^-(?!--)/.test(line)
        ? 'del'
        : /^@@/.test(line)
          ? 'hunk'
          : /^(\+\+\+|---)/.test(line)
            ? 'file'
            : 'ctx';
    return [h(`span.diff-${cls}`, line || ' '), i < lines.length - 1 ? '\n' : null];
  });

// Field labels for FILL_IN_ names: the server's hint, else the name in plain words. The raw token is not shown under
// the label (U04: it read like a developer tool); the code preview still marks each hole. Two names that read the
// same get a number, so every field stays distinct.
function fillLabels(a) {
  const labels = a.placeholders.map((name) => a.placeholderHints?.[name] || humanize(name));
  return labels.map((l, i) =>
    labels.indexOf(l) !== labels.lastIndexOf(l)
      ? `${l} ${labels.slice(0, i + 1).filter((x) => x === l).length}`
      : l,
  );
}
let fillSeq = 0; // the same artifact can show in the chat, Approvals and the drawer at once: ids stay unique per copy
// Values typed but not yet saved, per artifact version (`id:version` -> { name: value }), in memory only. One draft has
// one set of values: typing in the chat card fills the same draft's Approvals row live (and the reverse), and a copy
// rendered later (opening Approvals after typing in chat) starts from them. Saving makes a new version, so they go.
const typed = new Map();

// Inline placeholder form: one field per FILL_IN_ name. Returns { form, approve }.
// oneClick (someone who may decide, placeholders the only blocker): `approve` is the card's Approve button, linked
// to this form. It is disabled (and described by the form's head line) until every field is filled and valid; one
// click then posts the edit with { fill } and approves the new version, in that order. The approval gate is
// unchanged: the server still checks the version, the hash and the role on each call.
// Otherwise (a draft, or a member who cannot decide): "Save these values" makes the new version, as before.
function fillForm(card, { oneClick = false } = {}) {
  const a = card.artifact;
  const id = `xo-fill-${++fillSeq}`;
  const labels = fillLabels(a);
  const n = a.placeholders.length;
  // A helper line shows once a typed field is left (or Approve is tried) with an implausible value, and updates live
  // after that. Quiet slate text, never red.
  const shown = new Set();
  const key = `${a.artifactId}:${a.version}`;
  const share = (input) => {
    typed.set(key, { ...typed.get(key), [input.name]: input.value });
    for (const f of document.querySelectorAll(`form.xo-fill[data-fill-key="${CSS.escape(key)}"]`))
      if (f !== form)
        f.dispatchEvent(
          new CustomEvent('xo-fill-share', { detail: { name: input.name, value: input.value } }),
        );
  };
  const inputs = a.placeholders.map((name, i) =>
    h('input', {
      id: `${id}-${i}`,
      name,
      maxlength: 1000,
      required: oneClick,
      ...inputType(name),
      value: typed.get(key)?.[name] || '',
      oninput: (e) => {
        share(e.currentTarget);
        sync();
      },
      onblur: (e) => {
        if (e.currentTarget.value.trim()) {
          shown.add(e.currentTarget);
          sync();
        }
      },
    }),
  );
  const helps = inputs.map((input) =>
    h('p.field-note.xo-fill-help', { id: `${input.id}-help`, hidden: true }),
  );
  const fields = inputs.map((input, i) =>
    h('div.field', h('label.field-label', { for: input.id }, labels[i]), input, helps[i]),
  );
  const values = () =>
    Object.fromEntries(inputs.filter((i) => i.value.trim()).map((i) => [i.name, i.value.trim()]));
  const valid = (i) => !!i.value.trim() && !fieldProblem(i);
  const complete = () => inputs.every(valid);
  const showHelps = () =>
    inputs.forEach((input, i) => {
      const text = shown.has(input) ? fieldProblem(input) : '';
      if (helps[i].textContent !== text) helps[i].textContent = text;
      helps[i].hidden = !text;
      if (text) input.setAttribute('aria-describedby', helps[i].id);
      else input.removeAttribute('aria-describedby');
    });
  const error = h('p.field-error', { role: 'alert', hidden: true });
  const fail = (err) => {
    clear(error, icon('alert', 16), h('span', friendlyError(err)));
    error.hidden = false;
  };
  const head = h('p.xo-fill-head', { id: `${id}-why` });
  const todo =
    card.state === 'pending'
      ? `Fill in ${n === 1 ? 'this value' : `these ${n} values`} to approve`
      : 'Fill in before it goes for approval';
  // Every field filled but one implausible: the head names that field instead of asking to fill everything in.
  const headText = (ready) => {
    if (ready)
      return `All set. Approve saves ${n === 1 ? 'this value' : 'these values'} and approves the draft.`;
    const odd = inputs.findIndex((i) => i.value.trim() && fieldProblem(i));
    return odd >= 0 && inputs.every((i) => i.value.trim())
      ? `Check ${labels[odd].charAt(0).toLowerCase() + labels[odd].slice(1)} to approve`
      : todo;
  };
  const setHead = (ready) =>
    clear(head, icon(ready ? 'check' : 'lock', 16), h('span', headText(ready)));
  const approve = oneClick
    ? h(
        'button.btn.btn-sm',
        {
          type: 'submit',
          form: id,
          disabled: true,
          'aria-describedby': `${id}-why`,
          dataset: { act: 'approve' },
        },
        icon('check', 16),
        h('span', 'Approve'),
      )
    : null;
  const save = oneClick
    ? null
    : h(
        'button.btn.btn-sm',
        { type: 'submit', disabled: true, dataset: { act: 'fill' } },
        icon('check', 16),
        h('span', n === 1 ? 'Save this value' : 'Save these values'),
      );
  let ready = null,
    headSaid = '';
  function sync() {
    showHelps();
    if (save) {
      save.disabled = !inputs.some((i) => i.value.trim());
      return;
    }
    const now = complete();
    approve.disabled = !now;
    const said = headText(now);
    if (now !== ready || said !== headSaid) {
      ready = now;
      headSaid = said;
      setHead(now);
    }
  }
  const edit = () =>
    api(`/api/app/xo/artifacts/${a.artifactId}/edit`, {
      method: 'POST',
      data: { version: a.version, fill: values() },
    });
  const editFailed = (err) => {
    if (err.code === 'stale_approval' || err.status === 404) {
      toast(friendlyError(err), { tone: 'error' });
      reloadCard(a.artifactId, form.closest('.xo-card'));
      return;
    }
    fail(err);
  };

  async function saveOnly() {
    if (!Object.keys(values()).length) return;
    await busy(save, async () => {
      try {
        const res = await edit();
        typed.delete(key);
        const left = res.card?.artifact?.placeholders?.length || 0;
        syncCard(res.card, { focusEl: form.closest('.xo-card') });
        toast(
          left
            ? `Saved. ${plural(left, 'placeholder')} left.`
            : res.card?.state === 'pending'
              ? 'Saved as a new version. It’s ready to approve.'
              : 'Saved as a new version.',
        );
      } catch (err) {
        editFailed(err);
      }
    });
  }

  async function saveAndApprove() {
    if (!complete()) {
      // Enter in a field, or a value the browser rejects (an email without @): go to the first field that needs work.
      const miss = inputs.find((i) => !valid(i));
      if (miss?.value.trim()) {
        shown.add(miss);
        sync();
      }
      miss?.focus();
      return;
    }
    const el = form.closest('.xo-card');
    await busy(approve, async () => {
      let saved;
      try {
        saved = await edit();
      } catch (err) {
        return editFailed(err);
      }
      typed.delete(key);
      const next = saved.card;
      // The saved version still cannot be approved (say the JSON-LD is now invalid): show it and its reason.
      if (!next?.actions?.includes('approve')) {
        syncCard(next, { focusEl: el });
        return toast(next?.artifact?.approveBlockedBy || 'Saved as a new version.', {
          mark: 'lock',
        });
      }
      try {
        const res = await api(`/api/app/xo/approvals/${next.artifact.approvalId}/decide`, {
          method: 'POST',
          data: { decision: 'approve', contentHash: next.artifact.contentHash },
        });
        syncCard(res.card, { focusEl: el });
        toast('Approved.');
      } catch (err) {
        // The values are saved; the new version waits with its own Approve button.
        syncCard(next, { focusEl: el });
        toast(friendlyError(err), { tone: 'error' });
        if ([403, 404, 409].includes(err.status)) reloadCard(a.artifactId, el);
      }
    });
    if (approve.isConnected) sync();
  }

  const form = h(
    'form.xo-fill',
    {
      id,
      novalidate: true,
      dataset: { fillKey: key },
      onsubmit: (e) => {
        e.preventDefault();
        error.hidden = true;
        return oneClick ? saveAndApprove() : saveOnly();
      },
    },
    head,
    h('div.xo-fill-fields', fields),
    error,
    save ? h('div.xo-fill-actions', save) : null,
  );
  setHead(false);
  ready = false;
  headSaid = todo;
  form.addEventListener('xo-fill-share', (e) => {
    const input = inputs.find((i) => i.name === e.detail.name);
    if (input && input.value !== e.detail.value) {
      input.value = e.detail.value;
      sync();
    }
  });
  if (inputs.some((i) => i.value)) sync();
  return { form, approve };
}

async function reloadCard(artifactId, el = null) {
  try {
    const d = await api(`/api/app/xo/artifacts/${artifactId}`);
    if (d.card) syncCard(d.card, { focusEl: el });
  } catch {
    /* the toast already said it */
  }
}

// Approve / Reject: the hash the card shows is the one reviewed. 403/409 means the card is out of date: say why and
// show the current state.
async function decide(btn, card, decision) {
  const el = btn.closest('.xo-card');
  await busy(btn, async () => {
    try {
      const res = await api(`/api/app/xo/approvals/${card.artifact.approvalId}/decide`, {
        method: 'POST',
        data: { decision, contentHash: card.artifact.contentHash },
      });
      syncCard(res.card, { focusEl: el });
      toast(
        decision === 'approve' ? 'Approved.' : 'Rejected. Nothing from this draft will ship.',
        decision === 'approve' ? {} : { mark: 'x' },
      );
    } catch (err) {
      toast(friendlyError(err), { tone: 'error' });
      if ([403, 404, 409].includes(err.status)) reloadCard(card.artifact.artifactId, el);
    }
  });
}

// Copy / Download apply first (idempotent: a repeat returns the first export), then copy or download.
const apply = (card) =>
  api(`/api/app/xo/artifacts/${card.artifact.artifactId}/apply`, {
    method: 'POST',
    data: { approvalId: card.artifact.approvalId },
  });
async function applied(err, card, el) {
  toast(friendlyError(err), { tone: 'error' });
  if (err.status === 409 || err.status === 404) reloadCard(card.artifact.artifactId, el);
}
async function copyArtifact(btn, card) {
  const el = btn.closest('.xo-card');
  await busy(btn, async () => {
    let res = null,
      failed = null;
    // Safari keeps the click's permission only for a clipboard write started inside it, so the write starts now
    // with a promise for the text; elsewhere the text is written once the export is confirmed.
    const text = apply(card).then(
      (r) => {
        res = r;
        return r.card?.artifact?.code ?? card.artifact.code;
      },
      (err) => {
        failed = err;
        throw err;
      },
    );
    try {
      if (window.ClipboardItem && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': text.then((t) => new Blob([t], { type: 'text/plain' })),
          }),
        ]);
      } else await navigator.clipboard.writeText(await text);
    } catch {
      if (failed || !res) return applied(failed || new Error(''), card, el);
      syncCard(res.card, { focusEl: el });
      return toast(
        'Exported, but copying didn’t work here. Use Download, or open History and copy the code by hand.',
        { tone: 'error' },
      );
    }
    syncCard(res.card, { focusEl: el });
    toast('Code copied. Paste it into the client’s site.');
  });
}
async function downloadArtifact(btn, card) {
  const el = btn.closest('.xo-card');
  await busy(btn, async () => {
    let res;
    try {
      res = await apply(card);
    } catch (err) {
      return applied(err, card, el);
    }
    const path = res.downloadPath || res.card?.artifact?.downloadPath;
    if (!path || !path.startsWith('/api/app/'))
      return toast('The file isn’t ready yet. Try again in a moment.', { tone: 'error' });
    // The server sends it as an attachment, so this never leaves the page.
    const link = h('a', { href: path, download: '', hidden: true });
    document.body.append(link);
    link.click();
    link.remove();
    syncCard(res.card, { focusEl: el });
    toast('Download started.');
  });
}

// ---- artifact drawer: the full card, the editor and the audit timeline ----

const ACTOR = (e) =>
  e.actorType === 'xo'
    ? 'Xo'
    : e.actorType === 'policy'
      ? 'Your trust policy'
      : e.actorType === 'system'
        ? null
        : e.actorName && e.actorName === state.me?.user?.username
          ? 'You'
          : e.actorName || 'A former member';
const v = (e) => (e.version ? ` version ${e.version}` : '');
const EVENTS = {
  artifact_created: (e) => [`${ACTOR(e) || 'Xo'} drafted${v(e)}`, 'start'],
  artifact_edited: (e) => [`${ACTOR(e) || 'Someone'} saved${v(e)}`, 'edit'],
  approval_requested: (e) => [
    ACTOR(e) ? `${ACTOR(e)} asked for approval of${v(e)}` : `Sent${v(e)} for approval again`,
    'ask',
  ],
  approval_stale: (e) => [`The approval for${v(e)} no longer applies: it was edited`, 'off'],
  approval_superseded: (e) => [`The approval request for${v(e)} moved to another channel`, 'off'],
  approved: (e) => [`${ACTOR(e)} approved${v(e)}`, 'key'],
  auto_approved: (e) => [`Approved by your trust policy${v(e)}`, 'key'],
  rejected: (e) => [`${ACTOR(e)} rejected${v(e)}`, 'off'],
  applied: (e) => [`${ACTOR(e) || 'Someone'} exported${v(e)}`, 'key'],
  apply_duplicate: (e) => [
    `${ACTOR(e) || 'Someone'} exported${v(e)} again (the same file)`,
    'quiet',
  ],
  apply_failed: (e) => [`The export of${v(e)} didn’t work`, 'off'],
  verified: (e) => [
    `${v(e).trim() ? `Version ${e.version}` : 'It'} was verified on the site`,
    'key',
  ],
};
function timeline(audit) {
  const items = audit
    .map((e) => EVENTS[e.action]?.(e) && [e, ...EVENTS[e.action](e)])
    .filter(Boolean);
  if (!items.length) return h('p.muted.small', 'Nothing has happened to this draft yet.');
  return h(
    'ol.xo-timeline',
    items
      .reverse()
      .map(([e, text, tone], i) =>
        h(
          'li',
          { dataset: { tone }, style: { '--i': Math.min(i, 8) } },
          h('span.tl-dot', { 'aria-hidden': 'true' }),
          h('span.tl-text', text),
          h('time.tl-time', { datetime: new Date(e.at).toISOString() }, date(e.at, true)),
        ),
      ),
  );
}

// openArtifact(card, { edit }): one drawer per artifact. It holds a synced copy of the card, so a decision made in
// the chat or the list shows here at once, and the timeline reloads after every change.
export function openArtifact(card, { edit = false } = {}) {
  const id = card.artifact.artifactId;
  const slot = h('div.xo-drawer-card');
  const editor = h('div.xo-editor-slot');
  const hist = h(
    'section.drawer-section.xo-history-sec',
    h('h3', 'History'),
    h('p.muted.small', 'Loading the history…'),
  );
  const opener = () =>
    document.querySelector(
      `#view .xo-card[data-artifact-id="${CSS.escape(id)}"] [data-act="history"], .xo-panel .xo-card[data-artifact-id="${CSS.escape(id)}"] [data-act="history"]`,
    );
  const d = drawer(displayTitle(card.artifact.title), [slot, editor, hist], {
    returnFocus: opener,
  });
  d.panel.classList.add('drawer-artifact');
  let current = card,
    editing = false,
    token = 0;
  const showCard = (c) => {
    current = c;
    d.setTitle(displayTitle(c.artifact.title));
    clear(slot, renderCard(c, { inDrawer: true, onEdit: () => openEditor() }));
    slot.hidden = editing;
  };
  const load = async () => {
    const my = ++token;
    try {
      const res = await api(`/api/app/xo/artifacts/${id}`);
      if (my !== token || !d.panel.isConnected) return;
      if (res.card && !editing) showCard(res.card);
      clear(
        hist,
        h('h3', 'History'),
        res.versions.length > 1
          ? h(
              'p.muted.small',
              `${plural(res.versions.length, 'version')}. Every edit makes a new one; approvals belong to one version.`,
            )
          : null,
        timeline(res.audit),
      );
    } catch (err) {
      if (my === token)
        clear(
          hist,
          h('h3', 'History'),
          h(
            'div.drawer-error',
            { role: 'alert' },
            h('p', `We couldn’t load the history. ${friendlyError(err)}`),
            h(
              'button.btn.btn-secondary.btn-sm',
              { type: 'button', onclick: load },
              icon('refresh', 16),
              h('span', 'Try again'),
            ),
          ),
        );
    }
  };
  function openEditor() {
    editing = true;
    slot.hidden = true;
    clear(
      editor,
      editorForm(current, {
        done: (res) => {
          editing = false;
          clear(editor);
          if (res?.card) {
            syncCard(res.card);
            showCard(res.card);
          } else slot.hidden = false;
          focusFirst();
          load();
        },
        cancel: () => {
          editing = false;
          clear(editor);
          slot.hidden = false;
          slot.querySelector('[data-act="edit"]')?.focus({ preventScroll: true });
        },
      }),
    );
  }
  const focusFirst = () =>
    (
      slot.querySelector('.xo-card-actions button') ||
      d.panel.querySelector('.drawer-head .icon-btn')
    )?.focus({ preventScroll: true });
  // Changes from anywhere else (chat, list, another drawer action) reload the timeline.
  const onChange = (e) => {
    if (!d.panel.isConnected) return removeEventListener('xaeo:artifact', onChange);
    if (e.detail?.card?.artifact?.artifactId !== id) return;
    clearTimeout(onChange.t);
    onChange.t = setTimeout(load, 120);
  };
  addEventListener('xaeo:artifact', onChange);
  showCard(card);
  if (edit) openEditor();
  load();
  return d;
}

// The editor: placeholder fields (when any), the title and the full code. Saving makes version+1; an approval on
// the old version no longer applies and the new one goes back up for approval.
function editorForm(card, { done, cancel }) {
  const a = card.artifact;
  const uid = `e-${a.artifactId.slice(0, 8)}-${a.version}`;
  const labels = fillLabels(a);
  const holes = a.placeholders.map((name, i) =>
    h(
      'div.field',
      h('label.field-label', { for: `${uid}-p${i}` }, labels[i]),
      h('input', { id: `${uid}-p${i}`, name, maxlength: 1000, ...inputType(name) }),
    ),
  );
  const title = h('input', {
    id: `${uid}-t`,
    value: a.title,
    maxlength: 120,
    required: true,
    autocomplete: 'off',
  });
  const code = h('textarea.xo-code-input', {
    id: `${uid}-c`,
    rows: Math.min(18, Math.max(8, a.code.split('\n').length + 1)),
    spellcheck: false,
    autocapitalize: 'off',
    autocomplete: 'off',
    'aria-describedby': `${uid}-n`,
  });
  code.value = a.code;
  const error = h('p.field-error', { role: 'alert', hidden: true });
  const note = ['pending', 'approved', 'applied'].includes(card.state)
    ? `Saving makes version ${a.version + 1}. ${card.state === 'pending' ? 'It replaces the version waiting for approval and goes up for approval again.' : `Its approval belongs to version ${a.version}, so version ${a.version + 1} goes back for approval.`}`
    : `Saving makes version ${a.version + 1}.`;
  const save = h(
    'button.btn',
    { type: 'submit' },
    icon('check', 18),
    h('span', 'Save new version'),
  );
  const form = h(
    'form.xo-editor',
    {
      onsubmit: async (e) => {
        e.preventDefault();
        const data = { version: a.version };
        if (title.value.trim() !== a.title) data.title = title.value.trim();
        if (code.value.trim() !== a.code.trim()) data.code = code.value;
        const fill = Object.fromEntries(
          holes
            .map((f) => f.querySelector('input'))
            .filter((i) => i.value.trim())
            .map((i) => [i.name, i.value.trim()]),
        );
        if (Object.keys(fill).length) data.fill = fill;
        if (Object.keys(data).length === 1) {
          clear(
            error,
            icon('info', 16),
            h('span', 'Nothing changed yet. Edit the code or fill a value, then save.'),
          );
          error.hidden = false;
          return;
        }
        error.hidden = true;
        await busy(save, async () => {
          try {
            const res = await api(`/api/app/xo/artifacts/${a.artifactId}/edit`, {
              method: 'POST',
              data,
            });
            toast(
              res.staleApprovalIds?.length
                ? `Saved version ${res.artifact.version}. The earlier approval no longer applies; it’s waiting for approval again.`
                : `Saved version ${res.artifact.version}.`,
            );
            done(res);
          } catch (err) {
            clear(error, icon('alert', 16), h('span', friendlyError(err)));
            error.hidden = false;
            if (err.code === 'stale_approval') reloadCard(a.artifactId);
          }
        });
      },
    },
    h(
      'div.xo-editor-head',
      h('h3', `Edit ${kindLabel(a.kind) === 'Fix' ? 'the fix' : kindLabel(a.kind)}`),
      h('p.muted.small', { id: `${uid}-n` }, note),
    ),
    holes.length
      ? h(
          'fieldset.xo-editor-holes',
          h('legend', `Fill in ${holes.length === 1 ? '1 value' : `${holes.length} values`}`),
          holes,
        )
      : null,
    h('div.field', h('label.field-label', { for: `${uid}-t` }, 'Title'), title),
    h(
      'div.field',
      h('label.field-label', { for: `${uid}-c` }, LANG[a.lang] ? `Code (${LANG[a.lang]})` : 'Code'),
      code,
    ),
    error,
    h(
      'div.form-actions',
      h('button.btn.btn-ghost', { type: 'button', onclick: cancel }, h('span', 'Cancel')),
      save,
    ),
  );
  requestAnimationFrame(() =>
    (holes[0]?.querySelector('input') || code).focus({ preventScroll: true }),
  );
  return form;
}
