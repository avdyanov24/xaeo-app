// App entry: session, router and shared state. Routes use the hash so every screen has a shareable URL.
import {
  api,
  setCsrf,
  h,
  clear,
  icon,
  errorToast,
  errorState,
  xo,
  reducedMotion,
  desk,
} from './lib.js';
import { get as pref, set as setPref } from './prefs.js';
import { createXo } from './xo.js';
import { renderClients } from './views/clients.js';
import { renderNewClient } from './views/new-client.js';
import { renderClient } from './views/client.js';
import { renderSettings } from './views/settings-page.js';
import { renderEngines } from './views/engines.js';
import { startTour } from './tour.js';
import { initPalette, openPalette } from './palette.js';
import { initXo } from './xo-chat.js';
import { renderApprovals, initApprovalsNav } from './views/approvals.js';

export const state = { me: null };
let view = document.getElementById('view');
let cleanup = null,
  lastParts = [],
  routeSeq = 0,
  routesLoading = 0,
  booted = false;

// One /api/app/me per navigation: calls within 2s share the same request unless a mutation forces a refetch.
let meReq = null,
  meAt = 0;
export async function refreshMe(force = false) {
  if (force || !meReq || Date.now() - meAt > 2000) {
    meAt = Date.now();
    meReq = api('/api/app/me');
    meReq.catch(() => {
      meReq = null;
    });
  }
  state.me = await meReq;
  const ws = state.me.workspace.name;
  document.querySelectorAll('[data-ws-name]').forEach((n) => {
    n.textContent = ws;
  });
  // B6: the sheet shows the email (or nothing), never the internal account id kept in username.
  const who =
    state.me.user.email || (/@/.test(state.me.user.username || '') ? state.me.user.username : '');
  document.querySelectorAll('[data-user-name]').forEach((n) => {
    n.textContent = who;
    n.hidden = !who;
  });
  document.querySelectorAll('[data-ws-initial]').forEach((n) => {
    n.textContent = (ws.trim()[0] || 'X').toUpperCase();
  });
  const role = state.me.user.workspaceRole === 'owner' ? 'Workspace owner' : 'Workspace member';
  document.querySelectorAll('[data-user-role]').forEach((n) => {
    n.textContent = role;
  });
  document
    .querySelectorAll('[data-account-btn], [data-sb-account]')
    .forEach((b) => b.setAttribute('aria-label', `${ws}, account menu`));
  engineBar(state.me.engineStatus);
  return state.me;
}

export const setTitle = (...parts) => {
  document.title = [...parts.filter(Boolean), 'Xaeo'].join(' · ');
};

// The one-line bar under the top bar says plainly whether answers are sample data or come from live engines. Below 560px only the short form shows.
function engineBar(s) {
  const bar = document.querySelector('[data-engine-bar]');
  if (!bar || !s) return;
  const names = (test) => s.engines.filter((e) => test(e.state)).map((e) => e.name);
  const live = names((x) => x === 'live'),
    missing = names((x) => x !== 'live');
  const sample = s.mode === 'sample';
  const more = h(
    'a',
    { href: '#/engines' },
    h('span', 'Engine settings'),
    icon('chevronRight', 14),
  );
  bar.dataset.mode = s.mode;
  const msg = sample
    ? h(
        'span.bar-msg',
        h('strong', 'Sample data'),
        h('span.bar-text', ': scripted answers, not live AI engines.'),
      )
    : h(
        'span.bar-msg',
        h('strong', 'Live engines: '),
        live.length ? live.join(', ') : 'none',
        '.',
        missing.length ? h('span.bar-text', ` Unavailable: ${missing.join(', ')}.`) : null,
      );
  clear(bar, h('span.bar-dot'), msg, h('span.bar-sep', { 'aria-hidden': 'true' }, '·'), more);
  // C3: on phones the dark bar folds into the app bar as one 44px chip that opens Engines.
  const chip = document.querySelector('[data-engine-chip]');
  if (chip) {
    chip.dataset.mode = s.mode;
    chip.setAttribute(
      'aria-label',
      sample
        ? 'Sample data: scripted answers, not live AI engines. Engine settings'
        : `Live engines: ${live.length ? live.join(', ') : 'none'}. Engine settings`,
    );
    clear(
      chip,
      h('span.bar-dot', { 'aria-hidden': 'true' }),
      h('span', sample ? 'Sample' : 'Live'),
    );
    chip.hidden = false;
  }
  // A+ desktop: the bar's message lives at the foot of the sidebar as one quiet line (the dot alone on the rail).
  const note = document.querySelector('[data-sb-engine]');
  if (note) {
    note.dataset.mode = s.mode;
    const full = sample
      ? 'Sample data: scripted answers, not live AI engines. Engine settings'
      : `Live engines: ${live.length ? live.join(', ') : 'none'}. Engine settings`;
    note.setAttribute('aria-label', full);
    note.title = full;
    clear(
      note,
      h('span.bar-dot', { 'aria-hidden': 'true' }),
      h(
        'span.sb-label',
        sample
          ? 'Sample data: scripted answers'
          : `Live: ${live.length ? live.join(', ') : 'no engines'}`,
      ),
    );
    note.hidden = false;
  }
}

// ---- A+ desktop sidebar (>=1024px; app.css "A+ desktop") ----
// Full or icon rail, remembered in xaeo-prefs (`sidebar`); /prefs.js puts it on <html> before the first paint.
function initSidebar() {
  const bar = document.querySelector('[data-sidebar]');
  if (!bar) return;
  bar
    .querySelectorAll('[data-sb-icon]')
    .forEach((n) => n.prepend(icon(n.dataset.sbIcon, n.classList.contains('sb-add') ? 16 : 18)));
  bar.querySelector('[data-sb-caret]')?.append(icon('chevronsUpDown', 16));
  const btn = bar.querySelector('[data-sb-collapse]');
  btn.append(icon('panelLeft', 18));
  const sync = () => {
    const rail = pref('sidebar') === 'rail';
    btn.setAttribute('aria-expanded', String(!rail));
    btn.setAttribute('aria-label', rail ? 'Expand sidebar' : 'Collapse sidebar');
    btn.title = btn.getAttribute('aria-label');
  };
  btn.addEventListener('click', () => {
    setPref('sidebar', pref('sidebar') === 'rail' ? 'full' : 'rail');
    sync();
  });
  sync();
  // Xo rests on the Ask Xo card (a calm idle, blinks only); app.css hides him while the page shows its own Xo.
  const spot = bar.querySelector('[data-sb-xo]');
  if (spot && state.me?.xo && desk.matches) spot.append(createXo({ mood: 'rest' }).el);
  const key = bar.querySelector('[data-sb-xo-key]');
  if (key) key.hidden = pref('xoKey') === false;
}
// The client list: name, letter tile and the latest scan's "mentioned/answers". Fetched in boot before the shell
// shows (no half-built sidebar), then refreshed after routes (at most every 4s) and when a scan starts.
let sbAt = 0,
  sbReq = 0;
async function loadSidebarClients(force = false) {
  const list = document.querySelector('[data-sb-clients]');
  if (!list || !desk.matches || (!force && Date.now() - sbAt < 4000)) return;
  sbAt = Date.now();
  const my = ++sbReq;
  let data;
  try {
    data = await api('/api/app/clients');
  } catch {
    return;
  }
  if (my !== sbReq) return;
  const clients = (data.clients || []).filter((c) => c.status !== 'archived');
  const cur = parseHash().parts;
  clear(
    list,
    clients.slice(0, 12).map((c) => {
      const score = c.runningId
        ? 'Scanning'
        : c.latest?.ok
          ? `${c.latest.mentioned}/${c.latest.ok}`
          : '';
      const label = `${c.name}${c.runningId ? ', scanning' : c.latest?.ok ? `, ${c.latest.mentioned} of ${c.latest.ok} answers name them` : ''}`;
      const on = cur[0] === 'clients' && cur[1] === c.id;
      return h(
        'li',
        h(
          'a.sb-client',
          {
            href: `#/clients/${c.id}`,
            title: c.name,
            'aria-label': label,
            'aria-current': on ? 'page' : null,
            dataset: { client: c.id },
          },
          h('span.sb-tile', { 'aria-hidden': 'true' }, (c.name.trim()[0] || '?').toUpperCase()),
          h('span.sb-label.sb-client-name', { 'aria-hidden': 'true' }, c.name),
          score ? h('span.sb-label.sb-score', { 'aria-hidden': 'true' }, score) : null,
        ),
      );
    }),
    clients.length > 12
      ? h(
          'li',
          h('a.sb-row.sb-all', { href: '#/' }, h('span.sb-label', `All ${clients.length} clients`)),
        )
      : null,
  );
  // A scan in progress: check again shortly so the row trades "Scanning" for its new score.
  clearTimeout(loadSidebarClients.t);
  if (clients.some((c) => c.runningId))
    loadSidebarClients.t = setTimeout(() => loadSidebarClients(true), 3000);
}
const markSidebarClient = (parts) =>
  document.querySelectorAll('[data-sb-clients] a[data-client]').forEach((a) => {
    if (parts[0] === 'clients' && a.dataset.client === parts[1])
      a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

// C2: a 3px cobalt bar at the top of the page when a route takes longer than 160ms. It grows by scaleX
// (.1 -> .8 over 600ms ease-out), completes to 1 on paint and fades out. Transform + opacity only.
const routeBar = (() => {
  let el = null,
    t = null;
  return {
    start() {
      clearTimeout(t);
      t = setTimeout(() => {
        if (!el) {
          el = h('div.route-bar', { 'aria-hidden': 'true' });
          document.body.append(el);
        }
        el.className = 'route-bar';
        void el.offsetWidth;
        el.classList.add('on');
      }, 160);
    },
    end() {
      clearTimeout(t);
      if (!el || !el.classList.contains('on')) return;
      el.classList.add('done');
      t = setTimeout(() => {
        el.className = 'route-bar';
      }, 400);
    },
  };
})();
// Tabs acknowledge the press at once; the header redraw on paint clears it.
addEventListener('click', (e) => {
  const a = e.target.closest?.('a.tab');
  if (a && !a.classList.contains('active') && !e.metaKey && !e.ctrlKey && !e.shiftKey)
    a.classList.add('pending');
});

// Help, account and the phone menu are disclosure menus: Esc or a click outside closes them,
// Esc returns focus to the trigger, arrow keys move between items, and opening one closes the others.
const menus = [];
function menu(btn, panel) {
  const items = () => [...panel.querySelectorAll('.menu-item')].filter((n) => !n.hidden);
  // Menu buttons open with Enter, Space or arrow keys (ArrowUp lands on the last item), like a native menu.
  btn.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    m.set(true);
    const list = items();
    (e.key === 'ArrowUp' ? list[list.length - 1] : list[0])?.focus();
  });
  const m = {
    btn,
    panel,
    set(on, { focusBack = false, focusFirst = false } = {}) {
      if (on) menus.forEach((o) => o !== m && o.set(false));
      if (on) m.place?.();
      btn.setAttribute('aria-expanded', String(on));
      clearTimeout(panel._out);
      panel.classList.remove('out');
      if (on || panel.hidden || reducedMotion()) panel.hidden = !on;
      else {
        panel.classList.add('out');
        panel._out = setTimeout(() => {
          panel.hidden = true;
          panel.classList.remove('out');
        }, 120);
      }
      if (on && focusFirst) items()[0]?.focus();
      if (!on && focusBack) btn.focus();
    },
  };
  btn.addEventListener('click', () => m.set(panel.hidden, { focusFirst: true }));
  panel.addEventListener('keydown', (e) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const list = items(),
      i = list.indexOf(document.activeElement);
    const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: list.length - 1 }[e.key];
    e.preventDefault();
    list[(next + list.length) % list.length]?.focus();
  });
  // Tabbing past the last item closes the menu without pulling focus back.
  panel.addEventListener('focusout', (e) => {
    if (e.relatedTarget && !panel.contains(e.relatedTarget) && e.relatedTarget !== btn)
      m.set(false);
  });
  panel.addEventListener('click', (e) => {
    if (e.target.closest('a.menu-item')) m.set(false);
  });
  menus.push(m);
  return m;
}
const openMenu = () => menus.find((m) => !m.panel.hidden);
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openMenu()) {
    e.preventDefault();
    openMenu().set(false, { focusBack: true });
  }
});
addEventListener('pointerdown', (e) => {
  const m = openMenu();
  if (m && !m.panel.contains(e.target) && !m.btn.contains(e.target)) m.set(false);
});

function initMenus() {
  const help = menu(
    document.querySelector('[data-help-btn]'),
    document.getElementById('help-menu'),
  );
  menu(
    document.querySelector('.topbar [data-account-btn]'),
    document.getElementById('account-menu'),
  );
  // The sidebar's menu lives on <body> (a portal): the sidebar clips its overflow and is a size container (which
  // also traps position: fixed), so a menu inside it was cut at the rail's 72px or the sidebar's 256px edge.
  const sbm = menu(
    document.querySelector('[data-sb-account]'),
    document.getElementById('sb-account-menu'),
  );
  if (sbm.btn && sbm.panel) {
    document.body.append(sbm.panel);
    sbm.place = () => {
      // Full sidebar: under the trigger. Rail: beside the rail, level with the trigger (it never covers the icons).
      const r = sbm.btn.getBoundingClientRect(),
        rail = document.querySelector('aside[data-sidebar]').getBoundingClientRect();
      const beside = rail.width < 120,
        top = Math.round(beside ? r.top : r.bottom + 6);
      sbm.panel.style.left = `${Math.round(beside ? rail.right + 8 : r.left)}px`;
      sbm.panel.style.top = `${top}px`;
      sbm.panel.style.maxHeight = `${Math.max(200, innerHeight - top - 16)}px`;
    };
    // Tab leaves the menu where it would have from the trigger (it no longer sits next to it in the DOM).
    sbm.panel.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        sbm.set(false);
        sbm.btn.focus();
      }
    });
    const shut = () => {
      if (!sbm.panel.hidden) sbm.set(false);
    };
    addEventListener('resize', shut);
    document
      .querySelector('aside[data-sidebar]')
      ?.addEventListener('scroll', shut, { passive: true });
  }
  const sheet = menu(
    document.querySelector('[data-menu-btn]'),
    document.getElementById('app-menu'),
  );
  help.btn.append(icon('help', 20));
  // U7: on phones the sheet is the Account sheet under the avatar; sections live in the bottom bar.
  sheet.panel.setAttribute('aria-label', 'Account');
  document.querySelectorAll('[data-bn-icon]').forEach((n) => n.prepend(icon(n.dataset.bnIcon, 22)));
  document.querySelector('[data-bottom-search]')?.addEventListener('click', () => {
    menus.forEach((m) => m.set(false));
    openPalette();
  });
  const icons = {
    'data-tour-item': 'play',
    'data-settings-item': 'settings',
    'data-engines-item': 'sparkles',
    'data-appearance-item': 'sliders',
    'data-shortcuts': 'keyboard',
    'data-team': 'users',
    'data-account-item': 'user',
    'data-admin': 'shield',
    'data-logout': 'logout',
  };
  document.querySelectorAll('[data-caret]').forEach((n) => n.append(icon('chevronDown', 16)));
  document.querySelectorAll('.menu-item').forEach((n) => {
    const k = Object.keys(icons).find((a) => n.hasAttribute(a));
    if (k) n.prepend(icon(icons[k], 18));
  });
  // Closing first hands focus back to the trigger, so the tour and the palette return focus there too.
  const from = (n) => menus.find((m) => m.panel.contains(n));
  document.querySelectorAll('[data-tour-item]').forEach((n) =>
    n.addEventListener('click', () => {
      from(n)?.set(false, { focusBack: true });
      startTour();
    }),
  );
  document.querySelectorAll('[data-shortcuts]').forEach((n) =>
    n.addEventListener('click', (e) => {
      from(e.currentTarget)?.set(false, { focusBack: true });
      openPalette({ help: true });
    }),
  );
  addEventListener('hashchange', () => menus.forEach((m) => m.set(false)));
  matchMedia('(min-width: 720px)').addEventListener('change', () =>
    menus.forEach((m) => m.set(false)),
  );
  desk.addEventListener('change', () => menus.forEach((m) => m.set(false)));
}

// The standalone tour button shows until the tour is finished or skipped. It uses an icon, not Xo, so the view keeps one Xo.
function initTourButton() {
  const btn = document.querySelector('[data-tour-start]');
  const done = () => {
    try {
      return localStorage.getItem('xaeo-tour-done') === '1';
    } catch {
      return false;
    }
  };
  if (done()) return;
  btn.prepend(icon('play'));
  btn.hidden = false;
  btn.addEventListener('click', () => startTour());
  // tour.js marks the tour done when it ends; it also clears body.touring then.
  new MutationObserver((_, obs) => {
    if (!document.body.classList.contains('touring') && done()) {
      btn.remove();
      obs.disconnect();
    }
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
}

export const go = (hash) => {
  if (location.hash === hash) route();
  else location.hash = hash;
};
// Re-render the current screen in place after Xo changed data (SSE `refresh`): no skeleton, no scroll, no entrance.
// `xaeo:refresh` tells the nav badge (views/approvals.js) to recount too.
export const refreshRoute = () => {
  dispatchEvent(new CustomEvent('xaeo:refresh'));
  return route({ quiet: true });
};

// The query is split off before the path, so `#/clients/<id>/fixes?engine=claude` stays on
// Fixes and hands the filter to the view. Xo's uiState reads the same parse.
export function parseHash(hash = location.hash) {
  const raw = hash.replace(/^#\/?/, '');
  const q = raw.indexOf('?');
  const parts = (q < 0 ? raw : raw.slice(0, q)).split('/').filter(Boolean);
  return { parts, query: new URLSearchParams(q < 0 ? '' : raw.slice(q + 1)) };
}

// Grey placeholder blocks while a screen loads (only shown if loading takes a moment).
// R10: a client page loads in its own shape (tile + name, tab strip, one wide card), so nothing jumps when it lands;
// other screens keep the card grid. Screen readers hear one "Loading" instead of nothing.
function skeleton(kind = 'list') {
  const line = (w, cls = '') => h(`span.sk${cls}`, { style: { width: w } });
  const say = h('p.visually-hidden', { role: 'status' }, 'Loading');
  if (kind === 'client')
    return h(
      'div.skeleton.sk-client',
      say,
      h(
        'div.sk-chead',
        { 'aria-hidden': 'true' },
        h('span.sk.sk-tile'),
        h('div.sk-head', line('min(260px, 60%)', '.sk-h1'), line('min(220px, 50%)')),
        h('span.sk.sk-btn'),
      ),
      h(
        'div.sk-tabs',
        { 'aria-hidden': 'true' },
        ['72px', '80px', '68px', '52px', '64px', '62px'].map((w) => line(w)),
      ),
      h(
        'div.sk-card.sk-wide',
        { 'aria-hidden': 'true' },
        line('40%', '.sk-h2'),
        line('22%', '.sk-big'),
        line('100%'),
        line('70%'),
      ),
    );
  return h(
    'div.skeleton',
    say,
    h('div.sk-head', { 'aria-hidden': 'true' }, line('180px', '.sk-h1'), line('min(320px, 80%)')),
    h(
      'div.sk-grid',
      { 'aria-hidden': 'true' },
      [0, 1, 2].map(() =>
        h('div.sk-card', line('55%', '.sk-h2'), line('30%', '.sk-big'), line('100%'), line('80%')),
      ),
    ),
  );
}

// R10 keyboard: a re-render that removed the focused control hands focus back to the same control in the new view
// (Approvals filters, Xo refresh); a real route change that dropped focus lands on the new view's heading, as Settings
// sections do. Focus that survived (top nav, bottom bar, an input the view focused itself) is left alone.
const focusKey = (n) =>
  n && n !== document.body
    ? `${n.tagName}|${n.classList[0] || ''}|${(n.textContent || '').trim().replace(/\d+/g, '').slice(0, 40)}`
    : null;
function restoreFocus(el, key, { tab = false, same = false } = {}) {
  const a = document.activeElement;
  if (a && a !== document.body && a.isConnected) return;
  if (key && same) {
    const [tag, cls, text] = key.split('|');
    const twin = [...el.querySelectorAll(cls ? `${tag}.${CSS.escape(cls)}` : tag)].find(
      (n) =>
        (n.textContent || '').trim().replace(/\d+/g, '').slice(0, 40) === text && n.offsetParent,
    );
    if (twin) return twin.focus({ preventScroll: true });
  }
  const head =
    (tab && el.querySelector('.tab-content > .section-head h2, .tab-content > .tab-title')) ||
    el.querySelector('h1') ||
    el.querySelector('h2');
  if (!head) return;
  if (!head.hasAttribute('tabindex')) head.setAttribute('tabindex', '-1');
  head.focus({ preventScroll: true });
}

// Routes animate in: a whole screen rises in; switching tabs on the same client only animates the tab.
function animate(kind) {
  view.classList.remove('enter', 'enter-tab');
  void view.offsetWidth;
  view.classList.add(kind);
  clearTimeout(animate.t);
  animate.t = setTimeout(() => view.classList.remove(kind), 900);
}

// U6: a client card click names its tile and title (clients.js) and asks for a shared-element transition to that
// client. One shot: any other navigation clears it.
let sharedTo = null;
export const shareRoute = (id) => {
  sharedTo = id;
};

// U7: the phone bottom bar's 3px indicator slides (transform only) to the active item.
function placeBottomInk() {
  const bar = document.querySelector('[data-bottom-nav]');
  const items = bar ? [...bar.querySelectorAll('.bn-item[data-nav]:not([hidden])')] : [];
  const i = items.findIndex((a) => a.classList.contains('active'));
  bar?.style.setProperty('--bn-i', String(Math.max(0, i)));
  bar?.classList.toggle('bn-none', i < 0);
}

// R13: Back and Forward return to where you were on that screen (Back to the clients list used to land at the top).
// Every history entry gets a key in history.state; leaving an entry stores its scroll, and a traversal (an entry
// that already has a key) restores it once the route has painted. A new entry (link, Xo, redirect) starts at the top.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
const scrollMemory = new Map();
let entryKey = null,
  entrySeq = 0,
  clickY = null;
// A tab or card click handler may move the page before the hash changes (the tab ink scrolls the strip into view),
// so the position is also taken in the click's capture phase and preferred when the route follows within a second.
addEventListener(
  'click',
  () => {
    if (entryKey) clickY = { key: entryKey, y: scrollY, t: performance.now() };
  },
  true,
);
function keyEntry() {
  const known = history.state?.k;
  if (known) return { key: known, traversal: scrollMemory.has(known) };
  const key = `${Date.now().toString(36)}-${++entrySeq}`;
  history.replaceState({ ...(history.state || {}), k: key }, '');
  return { key, traversal: false };
}

async function route({ quiet = false } = {}) {
  cleanup?.();
  cleanup = null;
  if (entryKey)
    scrollMemory.set(
      entryKey,
      clickY?.key === entryKey && performance.now() - clickY.t < 1000 ? clickY.y : scrollY,
    );
  clickY = null;
  if (/^#\/clients\/?$/.test(location.hash)) history.replaceState(null, '', '#/');
  // Brand moved into Settings; old links, bookmarks and Xo's navigation still land there.
  if (/^#\/brand\/?$/.test(location.hash)) history.replaceState(null, '', '#/settings/workspace');
  const entry = keyEntry();
  entryKey = entry.key;
  const backTo = entry.traversal ? scrollMemory.get(entry.key) : 0;
  // Latest route wins: if an older route is still loading, it keeps painting into a detached <main> and this one gets a fresh one.
  const seq = ++routeSeq;
  if (routesLoading) {
    const fresh = view.cloneNode(false);
    view.replaceWith(fresh);
    view = fresh;
  }
  const el = view;
  routesLoading++;
  const { parts, query } = parseHash();
  const [section] = parts;
  // Moving between a client's tabs, or between Settings sections, keeps the page and only animates the panel.
  const sameClient =
    (section === 'clients' && lastParts[0] === 'clients' && lastParts[1] === parts[1]) ||
    (section === 'settings' && lastParts[0] === 'settings');
  // Same path (Xo `refresh`, or only the hash query changed, §4.1): re-render in place, no skeleton, scroll or entrance.
  // The view keeps its height while it repaints, so the page never collapses and clamps the scroll to the top.
  const still = (quiet || !!section) && lastParts.join('/') === parts.join('/');
  const keep = quiet && still;
  const y = scrollY;
  if (still) el.style.minHeight = `${el.offsetHeight}px`;
  const shared =
    sharedTo &&
    section === 'clients' &&
    parts[1] === sharedTo &&
    !sameClient &&
    typeof document.startViewTransition === 'function' &&
    !reducedMotion();
  sharedTo = null;
  lastParts = parts;
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const on = ['engines', 'approvals', 'settings'].includes(section)
      ? a.dataset.nav === section
      : a.dataset.nav === 'clients';
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  placeBottomInk();
  document
    .querySelectorAll('[data-account-btn], [data-menu-btn]')
    .forEach((b) => b.classList.toggle('is-current', section === 'settings'));
  markSidebarClient(parts);
  document.body.dataset.route =
    section === 'clients' && parts[1] ? `client-${parts[2] || 'overview'}` : section || 'clients';
  // In a view transition the old screen is captured first, so the scroll to the top happens inside the update.
  if (!sameClient && !shared && !still) scrollTo({ top: 0 });
  const slow =
    sameClient || shared || still
      ? null
      : setTimeout(
          () => clear(el, skeleton(section === 'clients' && parts[1] ? 'client' : 'list')),
          160,
        );
  // R10: '' = focus was already lost, a key = it sat in the view, undefined = it lives outside (nav) and stays put.
  const prev = document.activeElement;
  const prevKey = !booted
    ? undefined
    : !prev || prev === document.body
      ? ''
      : el.contains(prev)
        ? focusKey(prev)
        : undefined;
  routeBar.start();
  let result = null,
    prefetched = null;
  const paint = async () => {
    if (shared) {
      scrollTo({ top: 0 });
      el.classList.add('vt');
    }
    await render();
  };
  const render = async () => {
    try {
      if (!section || section === 'archived') {
        setTitle(section ? 'Archived clients' : 'Clients');
        result = await renderClients(el, { archived: section === 'archived' });
      } else if (section === 'new') {
        setTitle('Add a client');
        result = await renderNewClient(el);
      } else if (section === 'clients' && parts[1])
        result = await renderClient(el, parts[1], parts[2] || 'overview', {
          detail: prefetched,
          query,
          keep,
        });
      else if (section === 'settings') result = await renderSettings(el, { section: parts[1] });
      else if (section === 'engines') {
        setTitle('Engines');
        result = await renderEngines(el);
      } else if (section === 'approvals' && state.me?.xo) {
        setTitle('Approvals');
        result = await renderApprovals(el, { query });
      } else {
        setTitle('Page not found');
        clear(
          el,
          h(
            'div.empty',
            xo('curious', 'empty-xo'),
            h('h2', 'Page not found'),
            h('p', 'That link doesn’t go anywhere. Your clients are one click away.'),
            h('a.btn', { href: '#/' }, 'Back to clients'),
          ),
        );
      }
    } catch (error) {
      // R2-2: plain words, no raw error text, and "Try again" re-runs this route in place (the user stays here).
      if (error.status === 404) {
        setTitle('Not found');
        clear(
          el,
          h(
            'div.empty',
            xo('curious', 'empty-xo'),
            h('h2', 'We can’t find that'),
            h('p', 'It may have been removed, or the link belongs to another workspace.'),
            h('a.btn', { href: '#/' }, 'Back to clients'),
          ),
        );
      } else {
        setTitle('Couldn’t load');
        const what =
          section === 'clients' && parts[1]
            ? 'this client'
            : section === 'settings'
              ? 'your settings'
              : section === 'engines'
                ? 'the engines'
                : section === 'approvals'
                  ? 'the approvals'
                  : section === 'new'
                    ? 'this page'
                    : 'your clients';
        clear(el, errorState({ what, error, retry: () => route(), back: !!section }));
      }
    }
  };
  let morph = shared;
  if (shared) {
    // C2: fetch first, so the clients list stays live (pressed card + top bar) instead of freezing inside the
    // transition while the API answers. A failed fetch falls through to the normal render and its error page.
    try {
      prefetched = await api(`/api/app/clients/${parts[1]}`);
    } catch {
      prefetched = null;
      morph = false;
    }
    if (seq !== routeSeq) morph = false;
  }
  if (morph) {
    // Card tile + name morph into the page header (240ms --ease-out, app.css "U6"); the content below rises as usual.
    const t = document.startViewTransition(paint);
    await t.updateCallbackDone.catch(() => {});
    t.ready.catch(() => {});
    t.finished.catch(() => {}).finally(() => el.classList.remove('vt'));
  } else {
    if (shared) scrollTo({ top: 0 });
    await render();
  }
  clearTimeout(slow);
  if (still) {
    el.style.minHeight = '';
    if (scrollY !== y) scrollTo({ top: y, behavior: 'instant' });
  } else if (backTo > 0 && seq === routeSeq) scrollTo({ top: backTo, behavior: 'instant' });
  routesLoading--;
  if (seq === routeSeq) {
    routeBar.end();
    document
      .querySelectorAll('.client-card.pending, .client-row.pending, a.tab.pending')
      .forEach((n) => n.classList.remove('pending'));
  }
  if (seq !== routeSeq) {
    result?.();
    return;
  }
  cleanup = result;
  // Settings moves focus to its own section heading (settings-page.js).
  if (prevKey !== undefined && !(still && !prevKey) && !(section === 'settings' && !still))
    restoreFocus(view, prevKey, { tab: sameClient && section === 'clients', same: still });
  booted = true;
  if (!still) animate(sameClient ? 'enter-tab' : 'enter');
  view.dispatchEvent(new CustomEvent('routed'));
}

async function boot() {
  clear(view, skeleton());
  const session = await api('/api/session');
  setCsrf(session.csrfToken);
  await refreshMe();
  document.querySelectorAll('[data-admin]').forEach((n) => {
    n.hidden = state.me.user.role !== 'admin';
  });
  document.querySelectorAll('[data-team]').forEach((n) => {
    n.hidden = false;
  });
  // A workspace with an open deletion request: every member sees it; owners cancel on the Account page.
  const deletion = state.me.workspace?.deletion;
  if (deletion) {
    const banner = document.createElement('div');
    banner.className = 'notice';
    banner.setAttribute('role', 'status');
    const date = deletion.executeAfter
      ? ` on ${new Date(deletion.executeAfter).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`
      : '';
    banner.textContent = `${state.me.workspace.name} is scheduled for deletion${date}. Owners can cancel on the Account page.`;
    document.querySelector('main#view')?.before(banner);
  }
  initMenus();
  // R10: "Skip to content" points at #view, which the hash router read as a route ("Page not found"). It now moves
  // focus to the open screen's heading (or main) and leaves the URL alone.
  document.querySelector('.skip[href="#view"]')?.addEventListener('click', (e) => {
    e.preventDefault();
    const head = view.querySelector('h1') || view.querySelector('h2');
    if (head && !head.hasAttribute('tabindex')) head.setAttribute('tabindex', '-1');
    (head || view).focus();
    (head || view).scrollIntoView({ block: 'nearest' });
  });
  document.querySelectorAll('[data-logout]').forEach((n) =>
    n.addEventListener('click', async () => {
      try {
        await api('/api/logout', { method: 'POST' });
        location.assign('/login');
      } catch (e) {
        errorToast(e);
      }
    }),
  );
  initTourButton();
  initXo(state.me);
  initPalette();
  initApprovalsNav(state.me);
  initSidebar();
  await loadSidebarClients(true);
  // R14: the top bar actions are filled now; show them once (app.css "chrome-ready").
  document.body.classList.add('chrome-ready');
  // Frosted top bar gets its edge once the page scrolls under it.
  const bar = document.querySelector('.topbar');
  const onScroll = () => bar.classList.toggle('scrolled', scrollY > 4);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  addEventListener('hashchange', route);
  addEventListener('routed', () => loadSidebarClients(), true);
  addEventListener('xaeo:scan-started', () => setTimeout(() => loadSidebarClients(true), 300));
  addEventListener('xaeo:refresh', () => loadSidebarClients(true));
  // U10: a client was created or the sample added: the sidebar shows it at once (the 4s throttle would skip it).
  addEventListener('xaeo:clients', () => loadSidebarClients(true));
  // Crossing 1024px swaps shell and layouts: the open screen re-renders in place with the other markup.
  desk.addEventListener('change', () => {
    if (desk.matches) loadSidebarClients(true);
    refreshRoute();
  });
  await route();
}
// R2-2: a failed boot gets the same plain-words error with a full reload as the retry (the session may be stale).
boot().catch(
  (error) => (
    document.body.classList.add('chrome-ready'),
    clear(
      view,
      errorState({ what: 'your workspace', error, retry: () => location.reload(), back: false }),
    )
  ),
);
