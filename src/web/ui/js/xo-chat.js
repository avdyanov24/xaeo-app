// Xo chat panel. Desktop (>=1192px, so the canvas beside the rail stays 720px+): a 400px panel docked right that narrows the app.
// Tablet and phone: a bottom sheet (full height on phones) over a scrim. Opened from the top bar "Ask Xo", the phone
// bottom bar, the palette and the X shortcut; shown only when the server has Xo on (me.xo). The dashboard never
// depends on it: closed, failing or switched off, every view works as before.
// Streaming: POST /api/app/xo/turn returns SSE (§4.2). Text is rendered with text nodes only (tiny formatter for
// **bold**, lists and `code`); numbers the server could not ground arrive as their own delta with unverified:true.
// Motion: panel 240ms --ease-out in, 150ms --ease-in out (sheet 320/200ms); step chips pop, text streams with a caret.
// Every duration comes from the motion tokens, which are 0 under reduced motion.
import {
  h,
  clear,
  icon,
  api,
  csrfToken,
  withTip,
  friendlyError,
  date,
  reducedMotion,
} from './lib.js';
import { get as pref, set as setPref } from './prefs.js';
import { createXo } from './xo.js';
import { go, refreshRoute, parseHash, state } from './main.js';
import { renderCard, replaceCard } from './xo-cards.js';

const DOCK = matchMedia('(min-width: 1192px)');
const COARSE = matchMedia('(pointer: coarse)');
const OPENING = 'Ask me why a client is missing from AI answers, or what to fix first.';
const CHECK_NUMBERS = 'Check the numbers in your last reply against my data.';
const UNVERIFIED_TIP = 'Xo couldn’t match this number to your data';
const MAX_TEXT = 4000;
const TAB_NAMES = {
  overview: 'Overview',
  questions: 'Questions',
  answers: 'Answers',
  fixes: 'Fixes',
  reports: 'Reports',
  settings: 'Settings',
};
const INERT = '.skip, .sidebar, .topbar, .menu-scrim, .engine-bar, #view, .bottom-nav';
const PLACEHOLDER = 'Ask Xo about your clients';
// AI disclosure (build plan §B.2): the full line in the empty state, the short one under the composer at all times.
const DISCLOSURE = 'Xo is an AI assistant. It can be wrong, so check drafts before you ship them.';
const DISCLOSURE_SHORT = 'AI answers can be wrong.';
const NOT_ANSWERED = 'Not answered';
// Same words as lib.js OFFLINE_TEXT (not exported there).
const OFFLINE_TEXT = 'You seem to be offline. Check your connection, then try again.';
// Limit codes the server sends (server/app/xo/limits.mjs LIMIT_CODES): each one closes the composer until it clears.
const LIMIT_CODES = new Set([
  'xo_unavailable',
  'rate_limited',
  'service_budget',
  'monthly_allowance',
  'daily_budget',
]);
// rate_limited normally carries resetAt (429 body, /xo/usage rateLimit.resetAt). Only a response without it (an older
// server) falls back to this pause; a send that is still over the window just gets the 429 again (one request, never automatic).
const RATE_PAUSE_MS = 60_000;
// Access revoked while the panel is open (a 404 from the turn or usage call): same gate as the limits, calm words, no reload needed.
const GONE_CODE = 'xo_off';
const GONE_TEXT = 'Xo isn’t available for this workspace. The dashboard still works.';
const RATE_TEXT = 'You have sent a lot of messages. Wait a few minutes, then try again.';
const PAUSED_POLL_MS = 60_000; // xo_unavailable (paused or breaker) has no reset time: re-read the status while the panel is open
const MAX_WAIT_MS = 30 * 60_000;

let enabled = false,
  ui = null,
  usageReq = null;
const s = {
  open: false,
  conversationId: null,
  closed: false,
  busy: null,
  history: false,
  trigger: null,
  refreshT: 0,
  pinned: true,
  loading: null,
  block: null,
  usage: null,
  usageFailed: false,
  gateT: 0,
  offline: false,
};
const key = (suffix) => `xaeo-xo-${suffix}:${state.me?.workspace?.id || ''}`;
const store = {
  get: (k, where = localStorage) => {
    try {
      return where.getItem(key(k));
    } catch {
      return null;
    }
  },
  set: (k, v, where = localStorage) => {
    try {
      if (v == null) where.removeItem(key(k));
      else where.setItem(key(k), v);
    } catch {
      /* private mode */
    }
  },
};

export const xoAvailable = () => enabled;

export function initXo(me) {
  enabled = !!me?.xo;
  const triggers = document.querySelectorAll('[data-xo-open]');
  triggers.forEach((b) => {
    b.hidden = !enabled;
  });
  // Keyboard path: the second skip link opens the chat (or moves into it when docked) without tabbing the whole app.
  const skip = document.querySelector('[data-xo-skip]');
  if (skip) skip.hidden = !enabled;
  if (!enabled) return;
  skip?.addEventListener('click', (e) => {
    e.preventDefault();
    openXo([...triggers].find((b) => b.offsetParent) || null);
  });
  triggers.forEach((b) => {
    if (!b.classList.contains('bn-item') && !b.hasAttribute('data-no-icon'))
      b.prepend(icon('message', 18));
    b.addEventListener('click', () => toggleXo(b));
  });
  DOCK.addEventListener('change', () => {
    if (s.open) layout();
  });
  // Offline closes the composer (the rest of the dashboard handles itself); coming back re-reads Xo's status.
  s.offline = navigator.onLine === false;
  const net = () => {
    s.offline = navigator.onLine === false;
    renderGate();
    if (!s.offline && s.open) checkUsage();
  };
  addEventListener('online', net);
  addEventListener('offline', net);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && s.open && s.block) checkUsage();
  });
  s.conversationId = store.get('chat');
  // Read the usage once at sign-in, so the meter row is already sized when the panel first opens (no shift as figures land).
  checkUsage();
  // Desktop keeps the panel open across reloads within the session (it is part of the workspace there). A new session
  // (nothing stored yet) opens it when Settings > Xo > "Open Xo when I sign in" is on; closing it stores '0', so a
  // closed panel stays closed for the rest of the session.
  const was = store.get('open', sessionStorage);
  if (DOCK.matches && (was === '1' || (was == null && pref('xoOnStart'))))
    openXo(null, { focus: false });
}

// askXo(text, from, { send }): opens Xo with a request. Default: the request is typed in the composer and the user
// sends it. `send: true` (contextual "Draft with Xo" buttons) sends it at once, which is safe because nothing Xo drafts
// ships without approval. It waits for a restored chat to finish loading (or the reply would be wiped), starts a new
// chat when the stored one is closed, and falls back to the prefill when Xo is still answering another turn.
export async function askXo(text, from = null, { send: now = false } = {}) {
  if (!enabled) return;
  openXo(from);
  if (!ui) return;
  if (now) {
    await s.loading;
    if (s.history) hideHistory();
    if (s.closed) {
      s.conversationId = null;
      store.set('chat', null);
      showEmpty();
    }
    if (!s.busy && !gated()) {
      ui.input.value = '';
      fit();
      ui.send.disabled = true;
      send(text);
      return;
    }
  }
  // While sending is paused the request waits in the composer; nothing sends on its own when it clears.
  ui.input.value = text;
  fit();
  ui.send.disabled = !canSend();
  ui.input.focus({ preventScroll: true });
}

export function toggleXo(from = null) {
  if (s.open) closeXo();
  else openXo(from);
}

export function openXo(from = null, { focus = true } = {}) {
  if (!enabled) return;
  build();
  s.trigger = from;
  if (!s.open) {
    s.open = true;
    // A reopen inside the close animation also clears the scrim's exit, or it stays at opacity 0.
    ui.panel.classList.remove('out');
    ui.scrim.classList.remove('out');
    ui.panel.hidden = false;
    layout();
    if (!ui.started) {
      ui.started = true;
      if (s.conversationId) s.loading = loadConversation(s.conversationId);
      else showEmpty();
    } else if (!s.conversationId && !s.busy) showEmpty();
    // Paused or over a limit shows before anyone types (a GET; the server re-checks every turn anyway).
    checkUsage();
  }
  // Touch: focus moves into the panel without popping the keyboard; a keyboard user lands in the input.
  if (focus)
    (s.history ? ui.history.querySelector('button') : COARSE.matches ? ui.log : ui.input)?.focus({
      preventScroll: true,
    });
}

export function closeXo({ focusBack = true } = {}) {
  if (!s.open || !ui) return;
  s.open = false;
  const hadFocus = ui.panel.contains(document.activeElement);
  setTriggers(false);
  store.set('open', '0', sessionStorage);
  ui.panel.classList.add('out');
  ui.scrim.classList.add('out');
  setInert(false);
  const done = () => {
    if (s.open) return;
    ui.panel.hidden = true;
    ui.scrim.hidden = true;
    ui.scrim.classList.remove('out');
    document.body.classList.remove('xo-docked', 'xo-sheet-open');
  };
  // The exit runs its CSS transition (150ms docked, 200ms sheet; 0 under reduced motion), then the space is released.
  setTimeout(done, reducedMotion() ? 0 : DOCK.matches ? 150 : 200);
  // Focus never drops to <body>: back to the trigger, or (Show me, a suggestion that opens a page) into that page.
  if (hadFocus)
    (focusBack
      ? s.trigger?.isConnected && s.trigger.offsetParent
        ? s.trigger
        : [...document.querySelectorAll('[data-xo-open]:not([hidden])')].find(
            (b) => b.getClientRects().length,
          )
      : document.getElementById('view')
    )?.focus({ preventScroll: true });
}

function layout() {
  const docked = DOCK.matches;
  document.body.classList.toggle('xo-docked', docked);
  document.body.classList.toggle('xo-sheet-open', !docked);
  ui.scrim.hidden = docked;
  setInert(!docked);
  setTriggers(true);
  store.set('open', docked ? '1' : '0', sessionStorage);
}
const setTriggers = (on) =>
  document
    .querySelectorAll('[data-xo-open]')
    .forEach((b) => b.setAttribute('aria-expanded', String(on)));
// The sheet is modal: everything behind it is inert, so Tab stays in the panel and the scrim takes the closing tap.
function setInert(on) {
  document.querySelectorAll(INERT).forEach((n) => {
    n.inert = on;
  });
}

// ---- DOM ----
function build() {
  if (ui) return;
  const avatar = createXo({ mood: 'wave', label: 'Xo' });
  avatar.el.classList.add('xo-avatar');
  const sub = h('p.xo-sub', 'New chat');
  const tool = (name, label, onclick, extra = {}) =>
    withTip(
      h(
        'button.icon-btn',
        { type: 'button', 'aria-label': label, onclick, ...extra },
        icon(name, 20),
      ),
      label,
    );
  const histBtn = tool('clock', 'Chat history', () => (s.history ? hideHistory() : showHistory()), {
    'aria-pressed': 'false',
  });
  const newBtn = tool('plus', 'New chat', () => newChat());
  const closeBtn = tool('x', 'Close Xo', () => closeXo());
  const log = h('div.xo-log', {
    role: 'region',
    'aria-label': 'Conversation with Xo',
    tabindex: '0',
  });
  const history = h('div.xo-history', {
    hidden: true,
    role: 'region',
    'aria-label': 'Chat history',
  });
  const live = h('div.visually-hidden', { 'aria-live': 'polite' });
  const input = h('textarea.xo-input', {
    rows: 1,
    maxlength: MAX_TEXT,
    placeholder: PLACEHOLDER,
    'aria-label': 'Message Xo',
    enterkeyhint: 'send',
    autocomplete: 'off',
  });
  const send = h(
    'button.xo-send',
    { type: 'submit', 'aria-label': 'Send', disabled: true },
    icon('arrowUp', 20),
  );
  const stop = h(
    'button.xo-stop',
    { type: 'button', hidden: true, onclick: () => s.busy?.abort() },
    icon('stop', 18),
    h('span', 'Stop'),
  );
  // Why sending is paused (limit, outage, offline). It sits on the composer it explains; the input points at it with
  // aria-describedby and the change is spoken through the live region.
  const banner = h('div.xo-banner#xo-banner', { hidden: true });
  // The 80% notice (C.7): informational, dismissible for the period, never closes the composer. It is not the gate
  // banner, so the input is never described by it or made read-only.
  const warn = h('div.xo-banner.xo-warn', { hidden: true, role: 'note' });
  const foot = () => h('p.xo-foot', DISCLOSURE_SHORT);
  const form = h(
    'form.xo-compose',
    {
      onsubmit: (e) => {
        e.preventDefault();
        submit();
      },
    },
    warn,
    banner,
    h('div.xo-field', input, send, stop),
    foot(),
  );
  // Usage meter row under the header (C.7), shown only when the plan has a monthly pool.
  const meter = usageMeter();
  const usageRow = h('div.xo-usage', { hidden: true }, meter.el);
  const closedBar = h(
    'div.xo-closed',
    { hidden: true },
    h('p', 'This chat is closed.'),
    h(
      'button.btn.btn-sm',
      { type: 'button', onclick: () => newChat() },
      icon('plus', 16),
      h('span', 'Start a new chat'),
    ),
    foot(),
  );
  const panel = h(
    'section.xo-panel#xo-panel',
    { hidden: true, 'aria-labelledby': 'xo-title' },
    h(
      'header.xo-head',
      avatar.el,
      h('div.xo-who', h('h2.xo-title#xo-title', 'Xo'), sub),
      h('div.xo-tools', histBtn, newBtn, closeBtn),
    ),
    usageRow,
    log,
    history,
    closedBar,
    form,
    live,
  );
  const scrim = h('div.xo-scrim', {
    hidden: true,
    'aria-hidden': 'true',
    onclick: () => closeXo(),
  });
  document.body.append(scrim, panel);
  ui = {
    panel,
    scrim,
    avatar,
    sub,
    histBtn,
    log,
    history,
    live,
    input,
    send,
    stop,
    form,
    closedBar,
    banner,
    warn,
    meter,
    usageRow,
    started: false,
  };
  renderGate();
  // Toasts clear the composer while the sheet is open (app.css reads --xo-compose-h); the bar grows with the input.
  const bar = new ResizeObserver(() =>
    document.documentElement.style.setProperty(
      '--xo-compose-h',
      `${Math.max(form.offsetHeight, closedBar.offsetHeight)}px`,
    ),
  );
  bar.observe(form);
  bar.observe(closedBar);

  // Pinned = the reader is at the end of the chat; a streaming turn that grows (a card re-rendered by a later event)
  // keeps them there. Scrolling up unpins, so nobody is yanked down while reading.
  log.addEventListener(
    'scroll',
    () => {
      s.pinned = nearBottom();
    },
    { passive: true },
  );
  // In-app links inside the chat (a card's "Back to … fixes", "See progress") open their page; the sheet would
  // cover it, so below the dock it closes first. The docked panel stays open beside the page.
  log.addEventListener('click', (e) => {
    if (!DOCK.matches && e.target.closest?.('a[href^="#/"]')) closeXo({ focusBack: false });
  });
  input.addEventListener('input', () => {
    fit();
    send.disabled = !canSend();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  });
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.defaultPrevented)
      return tabOut(e);
    if (
      e.key !== 'Escape' ||
      e.defaultPrevented ||
      document.querySelector('.drawer-wrap, .palette-wrap')
    )
      return;
    e.preventDefault();
    if (s.history) hideHistory({ focusTo: ui.histBtn });
    else closeXo();
  });
}
// Tab past the panel's last stop (the composer) never lands on a dead <body> stop or the page top. The sheet is
// modal (everything behind is inert): Tab wraps to its first control and Shift+Tab from there back to the composer,
// like any dialog; Escape and Close leave it. Docked, the panel sits beside the page: Tab moves on to the sidebar's
// first control (fixed, so nothing scrolls), and Shift+Tab from there comes straight back to the composer.
const tabbable = (root) =>
  [...root.querySelectorAll('a[href], button, input, textarea, select, [tabindex]')].filter(
    (n) =>
      !n.disabled &&
      n.tabIndex >= 0 &&
      n.getClientRects().length &&
      !n.closest('[inert], [hidden]'),
  );
function tabOut(e) {
  const stops = tabbable(ui.panel);
  if (!stops.length) return;
  const first = stops[0],
    last = stops.at(-1),
    at = document.activeElement;
  if (e.shiftKey ? at !== first || DOCK.matches : at !== last) return;
  e.preventDefault();
  if (e.shiftKey) return last.focus();
  if (!DOCK.matches) return first.focus();
  const next = tabbable(document.querySelector('aside.sidebar') || document.body).find(
    (n) => !n.matches('.skip') && !ui.panel.contains(n),
  );
  if (!next) return first.focus();
  next.focus({ preventScroll: true });
  // Only for this one hop: the listener goes when focus leaves (Shift's own keydown must not use it up).
  const back = (ev) => {
    if (ev.key === 'Tab' && ev.shiftKey && s.open) {
      ev.preventDefault();
      tabbable(ui.panel).at(-1)?.focus();
    }
  };
  next.addEventListener('keydown', back);
  next.addEventListener('blur', () => next.removeEventListener('keydown', back), { once: true });
}
// field-sizing grows the textarea where supported; elsewhere it is measured on input (max 6 lines in CSS).
function fit() {
  if (CSS.supports?.('field-sizing', 'content')) return;
  const t = ui.input;
  t.style.height = 'auto';
  t.style.height = `${t.scrollHeight}px`;
}

function setBusy(on) {
  ui.send.hidden = on;
  ui.stop.hidden = !on;
  ui.send.disabled = !canSend();
  ui.log.setAttribute('aria-busy', String(on));
}

// ---- gate: limits, outages and offline (build plan §B.2, §C.7 blocked state, rows 20-23, 34, 36) ----
// One place decides whether a message can go out. Blocked, the composer stays focusable but read-only with
// aria-disabled (focus never drops to <body>, and the reason is read with it); history, cards and the dashboard keep working.
const gated = () => !!(s.block || s.offline);
const canSend = () => !gated() && !!ui?.input.value.trim();
const zone = () => state.me?.workspace?.timezone || 'UTC';
const zoned = (ms, opts) => {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: zone(), ...opts }).format(ms);
  } catch {
    return new Intl.DateTimeFormat('en-GB', opts).format(ms);
  }
};
// An ISO resetAt from the server (429 body, SSE error, /xo/usage rateLimit and blockedResetAt) to epoch ms; absent or bad = null.
// Not to be mixed up with /xo/usage resetAt and dailyResetAt, which are already epoch ms.
const isoMs = (v) => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};
// The §B.2 text for a code when it came from GET /xo/usage (which sends the code and reset times, not the words). Same
// wording and format as server/app/xo/limits.mjs limitMessage; a turn's own error message is always preferred.
// at = the server's reset time for this block (epoch ms) or null.
function limitText(code, at, u = {}) {
  if (code === 'rate_limited') return RATE_TEXT;
  if (code === 'service_budget')
    return 'Xo is unavailable for the rest of today. The dashboard still works.';
  const day = at ?? u.dailyResetAt,
    month = at ?? u.resetAt;
  if (code === 'daily_budget' && day)
    return `Xo has reached today's limit for your workspace. It's back at ${zoned(day, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}. The dashboard still works.`;
  if (code === 'monthly_allowance' && month)
    return `You've used this month's Xo allowance. It resets on ${zoned(month, { day: 'numeric', month: 'short' })}. ${state.me?.user?.workspaceRole === 'owner' ? 'The dashboard still works.' : 'Your workspace owner can change the plan.'}`;
  return 'Xo is unavailable right now. The dashboard still works.';
}
// The banner words. The other limits' words carry their time already; a rate limit gets the second-precise time the
// server gave (the window is 10 minutes, so the minute alone would say "back" up to 59s before the composer reopens).
function blockText(b) {
  if (b.code !== 'rate_limited') return b.message || limitText(b.code, b.at, s.usage || {});
  const base = b.message || RATE_TEXT;
  return b.at
    ? `${base} You can send again at ${zoned(b.at, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })}.`
    : base;
}
// at: the server's reset time (ms). Calls for the same code keep what is already known (the usage read after a 429
// carries no words), and a newer time replaces the old one.
function setBlock(code, { message = null, at = null } = {}) {
  const prev = s.block?.code === code ? s.block : null;
  s.block = {
    code,
    message: message || prev?.message || null,
    at: at ?? prev?.at ?? null,
    since: prev?.since ?? Date.now(),
  };
  planRecheck();
  renderGate();
}
function clearBlock() {
  if (!s.block) return;
  s.block = null;
  clearTimeout(s.gateT);
  s.gateT = 0;
  renderGate();
}
// When a rate limit lifts: the server's time, else (an older server) the fixed pause.
const rateEnd = (b) => b.at ?? b.since + RATE_PAUSE_MS;
// When to look again: the reset time the server gave (+1.5s; a rate limit reopens exactly then), or a slow poll while
// there is none (paused, or the since-date server budget). A reset time that has already passed (clock skew) falls back
// to the poll, so the status is never re-read in a tight loop.
function planRecheck() {
  clearTimeout(s.gateT);
  s.gateT = 0;
  if (!s.block) return;
  const b = s.block,
    u = s.usage || {},
    rate = b.code === 'rate_limited';
  const at = rate
    ? rateEnd(b)
    : (b.at ??
      (b.code === 'monthly_allowance'
        ? u.resetAt
        : b.code === 'daily_budget'
          ? u.dailyResetAt
          : null));
  const wait =
    at && at > Date.now()
      ? Math.min(at - Date.now() + (rate ? 0 : 1500), MAX_WAIT_MS)
      : PAUSED_POLL_MS;
  s.gateT = setTimeout(() => {
    s.gateT = 0;
    if (!s.block) return;
    if (s.block.code === 'rate_limited' && Date.now() >= rateEnd(s.block)) return clearBlock();
    // A hidden tab or closed panel waits: visibilitychange or the next open reads the status.
    if (document.hidden || !s.open) return;
    checkUsage();
  }, wait);
}
// GET /xo/usage (C.7 data source). A limit it reports shows at once (blocked first, then rateLimit); nothing reported clears
// the block. A server without `rateLimit` never reports a rate limit, so one from a 429 is kept for the fixed pause.
// Failures (404 when Xo is off for the workspace, network) change nothing: the bar's "error" state is no banner.
function checkUsage() {
  if (!enabled || s.offline) return null;
  return (usageReq ||= api('/api/app/xo/usage')
    .then((u) => {
      s.usage = u;
      s.usageFailed = false;
      if (u?.blocked && LIMIT_CODES.has(u.blocked))
        setBlock(u.blocked, { at: isoMs(u.blockedResetAt) });
      else if (u?.rateLimit?.limited) setBlock('rate_limited', { at: isoMs(u.rateLimit.resetAt) });
      else if (s.block && (u?.rateLimit || s.block.code !== 'rate_limited')) clearBlock();
      else renderGate();
      return u;
    })
    .catch((err) => {
      s.usageFailed = true;
      if (err?.status === 404) setBlock(GONE_CODE, { message: GONE_TEXT });
      else renderGate();
      if (s.block) planRecheck();
      return null;
    })
    .finally(() => {
      usageReq = null;
    }));
}
// Fresh usage for other views (the plan card): the same request and state as the panel, so both always agree.
export const readUsage = () => checkUsage() || Promise.resolve(null);

// ---- usage meter and the 80% notice (build plan §C.7) ----
// The server sends a whole percent of the month's pool (floor, may pass 100 by one turn's cost) and never an amount:
// the meter shows that percent and the reset date, nothing else. The UI caps it at 100.
const pctOf = (u) => Math.max(0, Math.min(100, Math.floor(Number(u.monthPercent) || 0)));
const resetDate = (u) => zoned(u.resetAt, { day: 'numeric', month: 'short' });
const hasMeter = (u) => !!(u && u.pool && typeof u.monthPercent === 'number' && u.resetAt);
export const usageLine = (u) => `${pctOf(u)}% used, resets on ${resetDate(u)}`;
// One meter for the panel and the plan card: 4px track, cobalt fill, sun at the warning threshold, ink when full.
// The fill is a full-width bar translated inside the clipped track (transform only); its offset is a CSS custom
// property set through the CSSOM, which the CSP allows (no style attribute in markup).
export function usageMeter({ wide = false } = {}) {
  const fill = h('span.xo-meter-fill');
  const bar = h(
    'span.xo-meter-bar',
    {
      role: 'meter',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-label': 'Xo allowance this month',
    },
    fill,
  );
  const text = h('span.xo-meter-text');
  const el = h(`div.xo-meter${wide ? '.xo-meter-wide' : ''}`, text, bar);
  function update(u) {
    if (!hasMeter(u)) return false;
    const n = pctOf(u);
    bar.setAttribute('aria-valuenow', String(n));
    bar.setAttribute('aria-valuetext', `${n}% of this month's Xo allowance used`);
    el.dataset.tone = n >= 100 ? 'full' : u.warn || n >= 80 ? 'warn' : 'ok';
    fill.style.setProperty('--xo-usage', `${n - 100}%`);
    text.textContent = usageLine(u);
    return true;
  }
  return { el, update };
}
// Dismissed for this workspace and this period: one value in `xaeo-prefs` (no new storage key; prefs.js wraps the
// write in try/catch and keeps it in memory in private mode). A new period has a new resetAt, so the notice returns.
const warnKey = (u) => `${state.me?.workspace?.id || ''}:${u.resetAt}`;
const warnDismissed = (u) => pref('xoWarnDismissed') === warnKey(u);
const warnText = (u) =>
  `You've used most of this month's Xo allowance. It resets on ${resetDate(u)}.`;
function renderUsage() {
  if (!ui) return;
  const u = s.usageFailed ? null : s.usage;
  ui.usageRow.hidden = !ui.meter.update(u);
  // The warning shows at the server's threshold (u.warn) below 100%; a block (or offline) owns the composer instead.
  const show =
    hasMeter(u) &&
    u.warn &&
    pctOf(u) < 100 &&
    !u.blocked &&
    !s.block &&
    !s.offline &&
    !warnDismissed(u);
  const w = ui.warn,
    text = show ? warnText(u) : '';
  if (show && w.dataset.text !== text) {
    clearTimeout(w.outT);
    const dismiss = withTip(
      h(
        'button.icon-btn.xo-warn-x',
        {
          type: 'button',
          'aria-label': 'Dismiss this notice',
          onclick: () => {
            setPref('xoWarnDismissed', warnKey(u));
            renderUsage();
            ui.input.focus({ preventScroll: true });
          },
        },
        icon('x', 18),
      ),
      'Dismiss',
    );
    clear(w, icon('info', 18), h('p', text), dismiss);
    w.dataset.text = text;
    w.classList.remove('out');
    w.hidden = false;
    announce(text);
  } else if (!show && !w.hidden && !w.classList.contains('out')) {
    w.classList.add('out');
    delete w.dataset.text;
    w.outT = setTimeout(
      () => {
        w.hidden = true;
        w.classList.remove('out');
      },
      reducedMotion() ? 0 : 150,
    );
  }
}
function renderGate() {
  if (!ui) return;
  const b = s.block;
  const g = s.offline
    ? { kind: 'offline', text: OFFLINE_TEXT, icon: 'alert' }
    : b
      ? {
          kind: b.code,
          text: blockText(b),
          icon: b.code === 'xo_unavailable' || b.code === GONE_CODE ? 'circleDashed' : 'clock',
        }
      : null;
  const banner = ui.banner,
    before = banner.hidden || banner.classList.contains('out') ? '' : banner.dataset.text || '';
  ui.form.classList.toggle('is-gated', !!g);
  ui.input.readOnly = !!g;
  if (g) {
    ui.input.setAttribute('aria-disabled', 'true');
    ui.input.setAttribute('aria-describedby', 'xo-banner');
  } else {
    ui.input.removeAttribute('aria-disabled');
    ui.input.removeAttribute('aria-describedby');
  }
  ui.input.placeholder = s.offline
    ? 'You’re offline'
    : g
      ? 'Sending is paused for now'
      : PLACEHOLDER;
  ui.send.disabled = !canSend();
  // Anything else that sends a message (suggestion chips, Try again, Check these numbers) pauses with the composer.
  ui.panel.querySelectorAll('[data-sends]').forEach((n) => {
    n.disabled = !!g;
  });
  const stick = s.pinned;
  if (g) {
    clearTimeout(banner.outT);
    if (before !== g.text) clear(banner, icon(g.icon, 18), h('div.xo-banner-body', h('p', g.text)));
    banner.dataset.text = g.text;
    banner.dataset.kind = g.kind;
    banner.classList.remove('out');
    banner.hidden = false;
    if (before !== g.text) announce(g.text);
  } else if (!banner.hidden && !banner.classList.contains('out')) {
    // Exit: 150ms ease-in (keyframes, so it also runs when the entry is cut short), then the space goes.
    banner.classList.add('out');
    banner.outT = setTimeout(
      () => {
        banner.hidden = true;
        banner.classList.remove('out');
        delete banner.dataset.kind;
        delete banner.dataset.text;
      },
      reducedMotion() ? 0 : 150,
    );
    announce(banner.dataset.kind === 'offline' ? 'You’re back online.' : 'Xo is available again.');
  }
  renderUsage();
  // The composer grew or shrank: a reader at the end of the chat stays at the end.
  if (stick && ui.log.isConnected) requestAnimationFrame(toBottom);
}
function setClosed(closed) {
  s.closed = closed;
  ui.form.hidden = closed;
  ui.closedBar.hidden = !closed;
}
const nearBottom = () => ui.log.scrollHeight - ui.log.scrollTop - ui.log.clientHeight < 96;
const toBottom = () => {
  ui.log.scrollTop = ui.log.scrollHeight;
  s.pinned = true;
};

// ---- views inside the panel ----
function newChat() {
  if (s.busy) s.busy.abort();
  s.conversationId = null;
  store.set('chat', null);
  hideHistory();
  showEmpty();
  ui.input.focus({ preventScroll: true });
}

function showEmpty() {
  setClosed(false);
  ui.sub.textContent = 'New chat';
  const chips = h('div.xo-chips');
  clear(
    ui.log,
    h('div.xo-empty', h('p.xo-empty-line', OPENING), h('p.xo-disclose', DISCLOSURE), chips),
  );
  const { clientId } = uiState();
  // Suggestions come from real workspace state (server, no numbers). Without them the opening line still works.
  api(`/api/app/xo/suggestions${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ''}`)
    .then(({ suggestions }) => {
      if (!chips.isConnected) return;
      // Chips that send a message pause with the composer; navigation chips keep working.
      clear(
        chips,
        suggestions.slice(0, 3).map((x, i) =>
          h(
            'button.xo-chip',
            {
              type: 'button',
              style: { '--i': i },
              ...(x.message ? { 'data-sends': '', disabled: gated() } : {}),
              onclick: () => {
                if (x.message) send(x.message);
                else if (x.hash) {
                  go(x.hash);
                  if (!DOCK.matches) closeXo({ focusBack: false });
                }
              },
            },
            h('span', x.label),
            icon(x.message ? 'arrowRight' : 'plus', 16),
          ),
        ),
      );
    })
    .catch(() => {});
}

async function showHistory() {
  if (s.busy) return;
  s.history = true;
  ui.histBtn.setAttribute('aria-pressed', 'true');
  // The header says where you are; hideHistory puts the chat's own title back.
  ui.subChat = ui.sub.textContent;
  ui.sub.textContent = 'Chat history';
  ui.log.hidden = true;
  ui.form.hidden = true;
  ui.closedBar.hidden = true;
  ui.history.hidden = false;
  clear(ui.history, h('p.xo-hist-note', 'Loading your chats…'));
  try {
    const { conversations } = await api('/api/app/xo/conversations');
    if (!s.history) return;
    clear(
      ui.history,
      h('h3.xo-hist-head', 'Your chats'),
      conversations.length
        ? h(
            'ul.xo-hist-list',
            conversations.map((c) =>
              h(
                'li',
                h(
                  'button.xo-hist-item',
                  {
                    type: 'button',
                    'aria-current': c.id === s.conversationId ? 'true' : null,
                    onclick: () => {
                      hideHistory({ focusTo: COARSE.matches ? ui.log : ui.input });
                      loadConversation(c.id);
                    },
                  },
                  h('span.xo-hist-title', c.title || 'Untitled chat'),
                  h('span.xo-hist-date', histDate(c.updatedAt)),
                  c.status !== 'open' ? h('span.xo-hist-state', 'Closed') : null,
                ),
              ),
            ),
          )
        : h('p.xo-hist-note', 'No chats yet. Your first question starts one.'),
    );
    ui.history.querySelector('button')?.focus({ preventScroll: true });
  } catch (err) {
    if (s.history)
      clear(
        ui.history,
        h(
          'div.xo-error',
          icon('alert', 18),
          h('span', friendlyError(err)),
          h(
            'button.btn.btn-secondary.btn-sm',
            { type: 'button', onclick: showHistory },
            'Try again',
          ),
        ),
      );
  }
}
// Focus inside the list would drop to <body> when it hides (and the next Esc would go nowhere), so it moves to the
// clock button that opened it, or where the caller sends it (a picked chat lands in the composer).
function hideHistory({ focusTo = null } = {}) {
  if (!s.history) return;
  s.history = false;
  const had = ui.history.contains(document.activeElement);
  ui.histBtn.setAttribute('aria-pressed', 'false');
  if (ui.sub.textContent === 'Chat history') ui.sub.textContent = ui.subChat || 'New chat';
  ui.history.hidden = true;
  ui.log.hidden = false;
  setClosed(s.closed);
  if (had) (focusTo || ui.histBtn).focus({ preventScroll: true });
}

async function loadConversation(id) {
  clear(ui.log, h('p.xo-hist-note', 'Loading the chat…'));
  setClosed(false);
  try {
    const t = await api(`/api/app/xo/conversations/${encodeURIComponent(id)}`);
    s.conversationId = t.conversation.id;
    store.set('chat', s.conversationId);
    ui.sub.textContent = t.conversation.title || 'Chat';
    // A card belongs to the end of its turn, as it streamed (below Xo's text, which is saved after the tool ran):
    // each card goes in just before the next user message, not at its own timestamp.
    const cards = [...t.cards].sort((a, b) => a.createdAt - b.createdAt);
    const items = [];
    let ci = 0;
    const flush = (until) => {
      while (ci < cards.length && cards[ci].createdAt < until)
        items.push(renderCard(cards[ci++].card));
    };
    // "Not answered" comes from the server, per user message: answered === false (the run's outcome was not ok) gets the
    // label and a next step from outcome/errorCode; true and null (old messages, or a turn that ended before the first
    // model call) get nothing, so no conversation is ever guessed from the shape of its transcript.
    t.messages.forEach((m) => {
      if (m.role !== 'user')
        return items.push(h('div.xo-msg.xo-bot', h('div.xo-text', rich(m.text, []))));
      flush(m.createdAt);
      items.push(userBubble(m.text));
      if (m.answered === false) items.push(unansweredTag(nextStep(m)));
    });
    flush(Infinity);
    clear(ui.log, items.filter(Boolean));
    // A restored chat appears at once; only new messages rise in.
    ui.log.classList.add('restored');
    requestAnimationFrame(() => requestAnimationFrame(() => ui.log.classList.remove('restored')));
    if (!ui.log.childElementCount) showEmpty();
    setClosed(t.conversation.status !== 'open');
    // A closed chat hides the composer; focus that was in it moves to the bar's "Start a new chat".
    if (s.closed && s.open && document.activeElement === document.body)
      ui.closedBar.querySelector('button')?.focus({ preventScroll: true });
    requestAnimationFrame(toBottom);
  } catch (err) {
    // A chat that is gone (or belongs to someone else) quietly becomes a new one.
    if (err.status === 404) {
      s.conversationId = null;
      store.set('chat', null);
      return showEmpty();
    }
    clear(
      ui.log,
      h(
        'div.xo-error',
        icon('alert', 18),
        h('span', friendlyError(err)),
        h(
          'button.btn.btn-secondary.btn-sm',
          { type: 'button', onclick: () => loadConversation(id) },
          'Try again',
        ),
      ),
    );
  }
}

// ---- turns ----
function submit() {
  const text = ui.input.value.trim();
  if (!text || s.busy) return;
  // Paused: Enter keeps the draft and says why again (the banner is already on screen).
  if (gated()) return announce(ui.banner.textContent);
  ui.input.value = '';
  fit();
  ui.send.disabled = true;
  send(text);
}

// uiState (§4.1 step 6): read from the same parse as the router; the server validates every value again.
function uiState() {
  const { parts, query } = parseHash();
  const section = parts[0] || 'clients';
  const clientId = section === 'clients' && parts[1] ? parts[1] : null;
  const q = {};
  for (const k of ['engine', 'status', 'type']) if (query.get(k)) q[k] = query.get(k);
  return {
    hash: location.hash.slice(0, 300),
    section,
    clientId,
    tab: clientId ? parts[2] || 'overview' : null,
    query: q,
  };
}

async function send(text, { again = false, bubble = null } = {}) {
  if (s.busy || s.closed || gated()) return;
  if (ui.log.querySelector('.xo-empty')) clear(ui.log);
  ui.log.querySelector('.xo-draft-error')?.remove();
  // A message the server refuses before the stream starts was never accepted: it leaves no bubble and goes back to the composer.
  const fresh = !again || !bubble?.isConnected;
  if (fresh) {
    bubble = userBubble(text);
    ui.log.append(bubble);
  } else setUnanswered(bubble, false);
  const turn = botTurn(bubble);
  ui.log.append(turn.el);
  toBottom();
  const abort = new AbortController();
  s.busy = abort;
  setBusy(true);
  ui.avatar.setMood('thinking');
  let outcome = 'error';
  try {
    const res = await fetch('/api/app/xo/turn', {
      method: 'POST',
      credentials: 'same-origin',
      signal: abort.signal,
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
      body: JSON.stringify({ conversationId: s.conversationId, text, uiState: uiState() }),
    });
    if (res.status === 401) {
      location.assign('/login?next=' + encodeURIComponent(location.pathname + location.hash));
      return;
    }
    if (!res.ok || !(res.headers.get('content-type') || '').includes('text/event-stream')) {
      let body = null;
      try {
        body = await res.json();
      } catch {
        /* not JSON */
      }
      const server = res.status >= 500 && res.status !== 503;
      // xo_busy (429) and a 503 with Retry-After (database or capacity blinking) pass in seconds: offer the same message again.
      const passing =
        body?.code === 'xo_busy' || (res.status === 503 && !!res.headers.get('retry-after'));
      // A stale CSRF token (signed in again in another tab) is a 403 the server words for machines.
      const stale = res.status === 403 && body?.error === 'Invalid session token';
      // A limit before the stream (429 rate_limited, 503 xo_unavailable once Xo is paused): the composer closes with the server's words.
      const gone = res.status === 404;
      const gate = LIMIT_CODES.has(body?.code);
      const retryable = server || passing || res.status === 409;
      // Refused before the model ran, with no Try again of its own: keep the text as a draft, no bubble, no "Not answered".
      if (fresh && (gate || gone || !retryable)) {
        bubble.remove();
        turn.el.remove();
        restoreDraft(text);
        if (gate) setBlock(body.code, { message: body.error || null, at: isoMs(body.resetAt) });
        else if (gone) setBlock(GONE_CODE, { message: GONE_TEXT });
        else
          ui.log.append(
            h(
              'div.xo-error.xo-draft-error',
              { role: 'alert' },
              icon('alert', 18),
              h(
                'span',
                stale
                  ? 'You signed in again in another tab or window, so this page is out of date. Reload it to continue.'
                  : !body?.error
                    ? 'Xo couldn’t answer just now. The dashboard still works; try again in a minute.'
                    : body.error,
              ),
            ),
          );
      } else if (gate) {
        turn.limit();
        setBlock(body.code, { message: body.error || null, at: isoMs(body.resetAt) });
      } else if (gone) {
        turn.limit();
        setBlock(GONE_CODE, { message: GONE_TEXT });
      } else
        turn.fail(
          {
            message: stale
              ? 'You signed in again in another tab or window, so this page is out of date. Reload it to continue.'
              : server || !body?.error
                ? 'Xo couldn’t answer just now. The dashboard still works; try again in a minute.'
                : body.error,
            retry:
              server ||
              passing ||
              (res.status === 409 && /still answering/i.test(body?.error || '')),
            closed: res.status === 409 && /closed/i.test(body?.error || ''),
          },
          text,
        );
    } else outcome = await readStream(res, turn, text);
  } catch (err) {
    if (abort.signal.aborted) {
      turn.stopped();
      outcome = 'stopped';
    } else turn.fail({ message: friendlyError(err), retry: true }, text);
  } finally {
    if (s.busy === abort) s.busy = null;
    setBusy(false);
    // Usage is re-read after every done or error (C.7): a turn that used the last of a budget closes the composer now,
    // not on the next send, and a limit error gets its reset time for the recheck.
    if (outcome !== 'stopped') checkUsage();
    ui.avatar.setMood(outcome === 'done' ? 'rest' : outcome === 'stopped' ? 'rest' : 'curious');
    // Focus returns to the input after a turn (keyboard users), but never pops the phone keyboard on its own.
    const a = document.activeElement;
    if (
      s.open &&
      !s.history &&
      !COARSE.matches &&
      (!a || a === document.body || ui.panel.contains(a)) &&
      !ui.form.hidden
    )
      ui.input.focus({ preventScroll: true });
  }
}

// The text of a refused send goes back into the composer (kept above anything typed since), ready to send when Xo is available.
function restoreDraft(text) {
  const now = ui.input.value.trim();
  ui.input.value = now && now !== text ? `${text}\n${now}` : text;
  fit();
  ui.send.disabled = !canSend();
}

// SSE (§4.2): events split on blank lines; `: ping` comments and unknown events are ignored.
async function readStream(res, turn, text) {
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '',
    terminal = null;
  const handle = (chunk) => {
    let event = 'message',
      data = '';
    for (const line of chunk.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const i = line.indexOf(':'),
        field = i < 0 ? line : line.slice(0, i),
        value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data += value;
    }
    let d;
    try {
      d = data ? JSON.parse(data) : {};
    } catch {
      return;
    }
    if (event === 'start') {
      s.conversationId = d.conversationId;
      store.set('chat', d.conversationId);
      if (ui.sub.textContent === 'New chat') ui.sub.textContent = text.slice(0, 80);
    } else if (event === 'text') turn.text(String(d.delta ?? ''), !!d.unverified);
    else if (event === 'tool') turn.step(d);
    else if (event === 'card') turn.card(d.card);
    else if (event === 'ui') turn.nav(d.hash);
    else if (event === 'refresh') {
      clearTimeout(s.refreshT);
      s.refreshT = setTimeout(() => refreshRoute(), 120);
    } else if (event === 'done') {
      terminal = 'done';
      turn.done(d);
    } else if (event === 'error') {
      terminal = 'error';
      if (d.code === 'aborted') turn.stopped();
      else if (LIMIT_CODES.has(d.code)) {
        turn.limit();
        setBlock(d.code, {
          message: typeof d.message === 'string' ? d.message : null,
          at: isoMs(d.resetAt),
        });
      } else
        turn.fail(
          { message: d.message, retry: !!d.retry, closed: d.code === 'context_full' },
          text,
        );
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value.replace(/\r\n?/g, '\n');
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      handle(buf.slice(0, i));
      buf = buf.slice(i + 2);
    }
  }
  if (buf.trim()) handle(buf);
  if (!terminal) {
    turn.fail(
      { message: 'The connection to Xo dropped before the answer finished.', retry: true },
      text,
    );
    return 'error';
  }
  return terminal;
}

const userBubble = (text) => h('div.xo-msg.xo-user', h('p', text));
// Quiet line under a user message Xo did not answer (refusal, error, stop, limit). Retry takes it away.
// next = what to do now (reload only; live, the error or banner beside it already says).
const unansweredTag = (next) =>
  h(
    'p.xo-unanswered',
    icon('circleDashed', 14),
    h('span', NOT_ANSWERED, next ? `. ${next}` : null),
  );
// The step after a reloaded message the server marked answered === false, from its outcome and errorCode.
function nextStep({ outcome, errorCode }) {
  if (outcome === 'refusal') return 'Try asking another way.';
  if (errorCode === 'context_full') return 'Start a new chat.';
  if (LIMIT_CODES.has(errorCode)) return 'Send it again when Xo is available.';
  return 'Send it again.';
}
function setUnanswered(bubble, on) {
  if (!bubble?.isConnected) return;
  const tag = bubble.nextElementSibling?.classList.contains('xo-unanswered')
    ? bubble.nextElementSibling
    : null;
  if (on && !tag) bubble.after(unansweredTag());
  else if (!on && tag) tag.remove();
}

// One assistant reply while it streams: step chips, formatted text (repainted once per frame), cards, notices.
function botTurn(bubble = null) {
  const steps = h('div.xo-steps', { hidden: true, 'aria-label': 'What Xo did' });
  const waitLabel = h('span', 'Thinking');
  const wait = h(
    'p.xo-wait',
    h('span.xo-dots', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
    waitLabel,
  );
  const body = h('div.xo-text');
  const extra = h('div.xo-extra');
  const el = h('div.xo-msg.xo-bot', steps, wait, body, extra);
  const chips = new Map();
  let raw = '',
    frame = 0,
    streaming = true;
  const marks = [];
  const paint = () => {
    frame = 0;
    const stick = nearBottom();
    const blocks = rich(raw, marks);
    // The caret sits at the end of the last line being written (inside its paragraph or list item).
    if (streaming && raw) {
      const last = blocks.at(-1);
      (last?.lastElementChild && /^[OU]L$/.test(last.tagName)
        ? last.lastElementChild
        : last || body
      ).append(h('span.xo-caret', { 'aria-hidden': 'true' }));
    }
    clear(body, blocks);
    if (stick) toBottom();
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(paint);
  };
  const grow = new ResizeObserver(() => {
    if (streaming && s.pinned && el.isConnected) toBottom();
  });
  grow.observe(el);
  const settle = () => {
    wait.remove();
    streaming = false;
    grow.disconnect();
    cancelAnimationFrame(frame);
    paint();
  };
  const add = (node) => {
    if (!node) return;
    const stick = nearBottom();
    extra.append(node);
    if (stick) toBottom();
  };
  // Every step finished (or a card came) and no text yet: the model is still writing. The dots come back at the end of
  // the turn, under the chips and any card, so a busy turn never sits still and the indicator never scrolls away.
  const writing = () => {
    if (
      !streaming ||
      (raw && !extra.childElementCount) ||
      [...chips.values()].some((c) => c.dataset.state === 'run')
    )
      return;
    const stick = nearBottom();
    waitLabel.textContent = 'Writing the reply';
    el.append(wait);
    if (stick) toBottom();
  };
  return {
    el,
    text(delta, unverified) {
      // Text streams above a card (body comes before extra), often off screen on a phone, so with a card in the turn
      // the indicator stays pinned at the end until the reply is done.
      if (!extra.childElementCount) wait.remove();
      const start = raw.length;
      raw += delta;
      if (unverified && delta) marks.push([start, raw.length]);
      schedule();
    },
    step({ id, label, phase, ok }) {
      wait.remove();
      steps.hidden = false;
      let chip = chips.get(id);
      if (!chip) {
        chip = h('span.xo-step');
        chips.set(id, chip);
        steps.append(chip);
      }
      const st = phase === 'start' ? 'run' : ok ? 'ok' : 'fail';
      chip.dataset.state = st;
      clear(
        chip,
        st === 'run'
          ? h('span.xo-spin', { 'aria-hidden': 'true' })
          : icon(st === 'ok' ? 'check' : 'alert', 14),
        h('span', label),
        h(
          'span.visually-hidden',
          st === 'run' ? ' (working)' : st === 'ok' ? ' (done)' : ' (didn’t work)',
        ),
      );
      // With a real model the gap after the last step is the longest wait of the turn.
      writing();
      if (nearBottom()) toBottom();
    },
    card(card) {
      // A later event re-renders the card in place (taller or shorter): a reader at the end stays at the end.
      const stick = s.pinned || nearBottom();
      if (!replaceCard(ui.log, card)) extra.append(renderCard(card));
      writing();
      if (stick) toBottom();
    },
    nav(hash) {
      if (typeof hash !== 'string' || !hash.startsWith('#/')) return;
      go(hash);
      add(
        h(
          'div.xo-nav',
          icon('arrowRight', 16),
          h('span', 'Opened ', h('strong', describe(hash))),
          !DOCK.matches
            ? h(
                'button.btn.btn-secondary.btn-sm',
                { type: 'button', onclick: () => closeXo({ focusBack: false }) },
                'Show me',
              )
            : null,
        ),
      );
    },
    done({ grounding, stopReason }) {
      settle();
      // A refusal ends with Xo's own next step ("Try asking another way.") and is kept out of the chat's memory.
      if (stopReason === 'refusal') setUnanswered(bubble, true);
      const n = grounding?.unverified?.length || 0;
      if (n)
        add(
          h(
            'div.xo-notice',
            icon('alert', 16),
            h('span', `Xo couldn’t match ${n === 1 ? '1 number' : `${n} numbers`} to your data.`),
            h(
              'button.xo-chip.xo-chip-sm',
              {
                type: 'button',
                'data-sends': '',
                disabled: gated(),
                onclick: () => send(CHECK_NUMBERS),
              },
              'Check these numbers',
            ),
          ),
        );
      if (!raw && !extra.childElementCount) body.append(h('p.muted', 'Xo had nothing to add.'));
      announce(
        `Xo: ${spoken(body)}${n ? ` Xo couldn’t match ${n === 1 ? '1 number' : `${n} numbers`} to your data.` : ''}`,
      );
    },
    stopped() {
      settle();
      el.classList.add('is-stopped');
      setUnanswered(bubble, true);
      add(h('p.xo-stopped', 'Stopped. This reply wasn’t saved.'));
      announce('Stopped.');
    },
    // A limit or pause ended the turn: the banner on the composer says why, so the reply leaves no empty bubble
    // (whatever streamed before the limit stays readable) and the message is marked "Not answered".
    limit() {
      settle();
      setUnanswered(bubble, true);
      if (!raw) body.remove();
      if (!el.textContent.trim()) el.remove();
    },
    fail({ message, retry, closed }, text) {
      settle();
      setUnanswered(bubble, true);
      if (!raw) body.remove();
      add(
        h(
          'div.xo-error',
          { role: 'alert' },
          icon('alert', 18),
          h('span', message),
          retry
            ? h(
                'button.btn.btn-secondary.btn-sm',
                {
                  type: 'button',
                  'data-sends': '',
                  disabled: gated(),
                  onclick: (e) => {
                    if (gated()) return;
                    // The failed reply goes too when nothing of it is left (no text, no steps), so no empty wrapper keeps a gap.
                    e.currentTarget.closest('.xo-error').remove();
                    if (!el.textContent.trim()) el.remove();
                    send(text, { again: true, bubble });
                  },
                },
                icon('refresh', 16),
                h('span', 'Try again'),
              )
            : null,
          closed
            ? h(
                'button.btn.btn-secondary.btn-sm',
                { type: 'button', onclick: () => newChat() },
                icon('plus', 16),
                h('span', 'Start a new chat'),
              )
            : null,
        ),
      );
    },
  };
}
// Screen-reader text for a reply: paragraphs and list items each end as a sentence, so they never run together.
const spoken = (body) =>
  [...body.children]
    .flatMap((b) => (/^[OU]L$/.test(b.tagName) ? [...b.children] : [b]))
    .map((n) => n.textContent.trim())
    .filter(Boolean)
    .map((t) => (/[.!?:;]$/.test(t) ? t : `${t}.`))
    .join(' ');
const announce = (text) => {
  ui.live.textContent = '';
  setTimeout(() => {
    ui.live.textContent = text.slice(0, 1200);
  }, 60);
};

// History dates: today's chats show their time ("21:40"), so several chats from one day can be told apart.
const histDate = (ms) =>
  ms && new Date(ms).toDateString() === new Date().toDateString()
    ? date(ms, true).split(', ').pop()
    : date(ms);

// A readable name for a hash Xo opened ("Fixes · Claude").
function describe(hash) {
  const { parts, query } = parseHash(hash);
  if (parts[0] === 'clients' && parts[1]) {
    const engine = state.me?.engines?.find((e) => e.id === query.get('engine'))?.name;
    return [TAB_NAMES[parts[2] || 'overview'] || 'Overview', engine].filter(Boolean).join(' · ');
  }
  return (
    { brand: 'Brand', engines: 'Engines', archived: 'Archived clients', new: 'Add a client' }[
      parts[0]
    ] || 'Clients'
  );
}

// ---- formatter: paragraphs, - / 1. lists, **bold** and `code`; unverified ranges become marked spans ----
function rich(raw, marks) {
  const out = [];
  let list = null,
    para = null,
    off = 0;
  for (const line of raw.split('\n')) {
    const m = /^\s*([-*•]|\d{1,2}[.)])\s+/.exec(line);
    if (!line.trim()) {
      list = para = null;
    } else if (m && !marks.some(([a, b]) => a < off + m[0].length && b > off)) {
      const tag = /\d/.test(m[1]) ? 'ol' : 'ul';
      if (!list || list.tagName.toLowerCase() !== tag) {
        list = h(
          tag,
          tag === 'ol' && parseInt(m[1], 10) > 1 ? { start: String(parseInt(m[1], 10)) } : {},
        );
        out.push(list);
      }
      const li = h('li');
      inline(li, raw, off + m[0].length, off + line.length, marks);
      list.append(li);
      para = null;
    } else {
      list = null;
      if (!para) {
        para = h('p');
        out.push(para);
      } else para.append(h('br'));
      inline(para, raw, off, off + line.length, marks);
    }
    off += line.length + 1;
  }
  return out;
}
function inline(el, raw, start, end, marks) {
  let i = start;
  while (i < end) {
    const b = raw.indexOf('**', i),
      c = raw.indexOf('`', i);
    const next = [b, c].filter((x) => x >= 0 && x < end).sort((x, y) => x - y)[0];
    if (next === undefined) {
      runs(el, raw, i, end, marks);
      break;
    }
    runs(el, raw, i, next, marks);
    const bold = next === b;
    const open = next + (bold ? 2 : 1);
    const close = raw.indexOf(bold ? '**' : '`', open);
    // An unclosed marker (mid-stream) styles to the end of the line, so markers never flash as text.
    const stop = close >= 0 && close < end ? close : end;
    const wrap = h(bold ? 'strong' : 'code');
    runs(wrap, raw, open, stop, marks);
    el.append(wrap);
    i = stop === end ? end : stop + (bold ? 2 : 1);
  }
}
function runs(el, raw, start, end, marks) {
  let i = start;
  for (const [a, b] of marks) {
    if (b <= i || a >= end) continue;
    if (a > i) el.append(raw.slice(i, a));
    const from = Math.max(a, i),
      to = Math.min(b, end);
    el.append(
      withTip(
        h(
          'span.xo-unverified',
          { tabindex: '0', 'aria-label': `${raw.slice(from, to)}, unverified: ${UNVERIFIED_TIP}` },
          raw.slice(from, to),
        ),
        UNVERIFIED_TIP,
      ),
    );
    i = to;
  }
  if (i < end) el.append(raw.slice(i, end));
}
