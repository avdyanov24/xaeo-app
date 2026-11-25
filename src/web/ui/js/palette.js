// Command palette: Ctrl+K (Cmd+K on a Mac) or "/" jumps to any client, tab or action. "?" lists the shortcuts.
import { api, h, clear, icon } from './lib.js';
import { go } from './main.js';
import { startTour } from './tour.js';
import { xoAvailable, toggleXo, openXo } from './xo-chat.js';
import { get as pref, set as setPref, subscribe } from './prefs.js';

const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const PALETTE_KEY = mac ? 'Cmd K' : 'Ctrl K';
const TABS = [
  ['overview', 'Overview', 'trending'],
  ['questions', 'Questions', 'message'],
  ['answers', 'Answers', 'list'],
  ['fixes', 'Fixes', 'zap'],
  ['reports', 'Reports', 'download'],
  ['settings', 'Settings', 'settings'],
];
const SHORTCUTS = [
  [PALETTE_KEY, 'Open the command palette'],
  ['/', 'Open the command palette'],
  ['N', 'Add a client'],
  ['G then C', 'Go to clients'],
  ['G then E', 'Go to engines'],
  ['G then S', 'Go to settings'],
  ['X', 'Open or close Xo'],
  ['← →', 'Step through answers in the answer panel'],
  ['Esc', 'Close any panel'],
  ['?', 'Show these shortcuts'],
];

let layer = null;
// X opens Xo unless Settings > Xo turned the shortcut off.
const xoKey = () => xoAvailable() && pref('xoKey') !== false;
// Only text entry swallows single-key shortcuts; a focused checkbox, switch, radio or button still lets X work.
const NOT_TEXT = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'range',
  'color',
  'file',
  'image',
]);
const typing = () => {
  const a = document.activeElement;
  return (
    !!a &&
    ((a.tagName === 'INPUT' && !NOT_TEXT.has(a.type)) ||
      ['SELECT', 'TEXTAREA'].includes(a.tagName) ||
      a.isContentEditable)
  );
};
const blocked = () => document.querySelector('.tour, .drawer-wrap, .celebrate');

async function items() {
  const out = [
    { group: 'Actions', label: 'Add a client', icon: 'plus', hint: 'N', run: () => go('#/new') },
    ...(xoAvailable()
      ? [
          {
            group: 'Actions',
            label: 'Ask Xo',
            icon: 'message',
            hint: xoKey() ? 'X' : null,
            run: () => openXo(),
          },
        ]
      : []),
    { group: 'Actions', label: 'Tour with Xo', icon: 'help', run: () => startTour() },
    { group: 'Go to', label: 'Clients', icon: 'users', run: () => go('#/') },
    ...(xoAvailable()
      ? [{ group: 'Go to', label: 'Approvals', icon: 'inbox', run: () => go('#/approvals') }]
      : []),
    { group: 'Go to', label: 'Engines', icon: 'zap', run: () => go('#/engines') },
    {
      group: 'Go to',
      label: 'Settings',
      icon: 'settings',
      hint: 'G S',
      run: () => go('#/settings'),
    },
    { group: 'Go to', label: 'Archived clients', icon: 'archive', run: () => go('#/archived') },
    // Settings sections show when the search matches them (deep, like client tabs).
    {
      group: 'Settings',
      label: 'Workspace and brand',
      sub: 'Logo, color, website, time zone',
      icon: 'palette',
      deep: true,
      run: () => go('#/settings/workspace'),
    },
    {
      group: 'Settings',
      label: 'Team and data',
      sub: 'Team, exports',
      icon: 'users',
      deep: true,
      run: () => go('#/settings/data'),
    },
    {
      group: 'Settings',
      label: 'Appearance',
      sub: 'Theme, density, motion',
      icon: 'sliders',
      deep: true,
      run: () => go('#/settings/appearance'),
    },
    ...[
      ['light', 'Use light theme', 'sun'],
      ['dark', 'Use dark theme', 'moon'],
      ['system', 'Use system theme', 'monitor'],
    ]
      .filter(([v]) => pref('theme') !== v)
      .map(([v, label, ic]) => ({
        group: 'Settings',
        label,
        sub: v === 'system' ? 'Follow your device setting' : 'Theme',
        icon: ic,
        deep: true,
        run: () => setPref('theme', v),
      })),
    ...(xoAvailable()
      ? [
          {
            group: 'Settings',
            label: 'Xo settings',
            sub: 'Open on sign-in, X shortcut',
            icon: 'message',
            deep: true,
            run: () => go('#/settings/xo'),
          },
        ]
      : []),
  ];
  try {
    const { clients } = await api('/api/app/clients');
    for (const c of clients) {
      out.push({
        group: 'Clients',
        label: c.name,
        sub: c.domain,
        icon: 'chevronRight',
        run: () => go(`#/clients/${c.id}/overview`),
      });
      for (const [key, name, ic] of TABS.slice(1))
        out.push({
          group: 'Clients',
          label: `${c.name}: ${name}`,
          sub: c.domain,
          icon: ic,
          deep: true,
          run: () => go(`#/clients/${c.id}/${key}`),
        });
    }
  } catch {
    /* the palette still works without the client list */
  }
  return out;
}

function score(item, q) {
  if (!q) return item.deep ? -1 : 1;
  const text = `${item.label} ${item.sub || ''}`.toLowerCase();
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.every((w) => text.includes(w))) return -1;
  return (text.startsWith(words[0]) ? 3 : 1) + (item.deep ? 0 : 1);
}

export async function openPalette({ help = false } = {}) {
  if (layer) return;
  const previous = document.activeElement;
  const input = h('input.palette-input', {
    type: 'text',
    placeholder: 'Jump to a client, tab or action',
    'aria-label': 'Search',
    autocomplete: 'off',
    spellcheck: 'false',
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-controls': 'palette-list',
  });
  const list = h('ul.palette-list#palette-list', { role: 'listbox' });
  const foot = h('div.palette-foot');
  const searchFoot = () =>
    clear(
      foot,
      h('span', h('kbd', '↑'), h('kbd', '↓'), ' to move'),
      h('span', h('kbd', 'Enter'), ' to open'),
      h('button.linkish', { type: 'button', onclick: () => showHelp() }, 'Shortcuts'),
    );
  searchFoot();
  const panel = h(
    'div.palette',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command palette' },
    h('div.palette-search', icon('search', 20), input, h('kbd.palette-esc', 'Esc')),
    list,
    foot,
  );
  layer = h('div.palette-wrap', h('div.palette-backdrop', { onclick: () => close() }), panel);
  document.body.append(layer);
  let all = [],
    shown = [],
    active = 0;

  function close() {
    if (!layer) return;
    const l = layer;
    layer = null;
    l.classList.add('out');
    setTimeout(() => l.remove(), 180);
    document.removeEventListener('keydown', onKey, true);
    previous?.focus?.({ preventScroll: true });
  }
  function run(item) {
    close();
    item.run();
  }
  function draw() {
    const q = input.value.trim();
    shown = all
      .map((i) => [i, score(i, q)])
      .filter(([, s]) => s >= 0)
      .sort((a, b) => b[1] - a[1])
      .map(([i]) => i)
      .slice(0, q ? 12 : 10);
    active = Math.min(active, Math.max(0, shown.length - 1));
    let group = null;
    clear(
      list,
      shown.length
        ? shown.flatMap((item, i) => {
            const headRow =
              item.group !== group && !q
                ? h('li.palette-group', { role: 'presentation' }, item.group)
                : null;
            group = item.group;
            return [
              headRow,
              h(
                'li.palette-item',
                {
                  role: 'option',
                  id: `pi-${i}`,
                  'aria-selected': String(i === active),
                  onclick: () => run(item),
                  onpointermove: () => {
                    if (active !== i) {
                      active = i;
                      mark();
                    }
                  },
                },
                h('span.palette-icon', icon(item.icon, 16)),
                h('span.palette-label', item.label),
                item.sub ? h('span.palette-sub', item.sub) : null,
                item.hint ? h('kbd', item.hint) : null,
              ),
            ];
          })
        : h('li.palette-empty', 'Nothing matches. Try a client name or “fixes”.'),
    );
    mark();
  }
  function mark() {
    list
      .querySelectorAll('.palette-item')
      .forEach((n, i) => n.setAttribute('aria-selected', String(i === active)));
    const el = list.querySelector(`#pi-${active}`);
    if (el) {
      input.setAttribute('aria-activedescendant', el.id);
      el.scrollIntoView({ block: 'nearest' });
    }
  }
  function showHelp() {
    input.value = '';
    input.disabled = true;
    clear(
      list,
      h('li.palette-group', 'Keyboard shortcuts'),
      SHORTCUTS.filter(([k]) => k !== 'X' || xoKey()).map(([k, what]) =>
        h(
          'li.palette-shortcut',
          h('span', what),
          h(
            'span.keys',
            k
              .split(' then ')
              .map((part, i) => [i ? h('span.muted', ' then ') : null, h('kbd', part)]),
          ),
        ),
      ),
    );
    clear(
      foot,
      h(
        'button.linkish',
        {
          type: 'button',
          onclick: async () => {
            input.disabled = false;
            searchFoot();
            if (!all.length) all = await items();
            draw();
            input.focus();
          },
        },
        'Back to search',
      ),
    );
  }
  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      return close();
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!shown.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
      mark();
    } else if (e.key === 'Enter' && shown[active] && !input.disabled) {
      e.preventDefault();
      run(shown[active]);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      input.focus();
    }
  }
  document.addEventListener('keydown', onKey, true);
  input.addEventListener('input', () => {
    active = 0;
    draw();
  });
  input.focus();
  if (help) return showHelp();
  clear(list, h('li.palette-empty', 'Loading…'));
  all = await items();
  if (layer) draw();
}

export function initPalette() {
  // Top bar (tablets) and the A+ desktop sidebar each have a trigger.
  document.querySelectorAll('[data-palette]').forEach((trigger) => {
    trigger.append(icon('search', 16), h('span', 'Search'), h('kbd', PALETTE_KEY));
    trigger.addEventListener('click', () => openPalette());
  });
  let pendingG = 0;
  addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      return layer ? null : openPalette();
    }
    if (layer || typing() || blocked() || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    // The tablet/phone Xo sheet is modal: the page behind it is inert, so only X (close Xo) still works.
    if (document.body.classList.contains('xo-sheet-open')) {
      if (k === 'x' && xoKey()) {
        e.preventDefault();
        toggleXo();
      }
      return;
    }
    if (k === '/') {
      e.preventDefault();
      openPalette();
    } else if (e.key === '?') {
      e.preventDefault();
      openPalette({ help: true });
    } else if (k === 'n') go('#/new');
    else if (k === 'x' && xoKey()) {
      e.preventDefault();
      toggleXo();
    } else if (k === 'g') pendingG = Date.now();
    // G then B still opens the brand settings for anyone used to the old Brand page.
    else if (Date.now() - pendingG < 900 && ['c', 'b', 'e', 's'].includes(k)) {
      pendingG = 0;
      go({ c: '#/', b: '#/settings/workspace', e: '#/engines', s: '#/settings' }[k]);
    }
  });
  // The Ask Xo button advertises X only while the shortcut is on.
  const syncXoKey = () =>
    document.querySelectorAll('.topbar [data-xo-open], .sidebar [data-xo-open]').forEach((b) => {
      if (xoKey()) {
        b.setAttribute('aria-keyshortcuts', 'x');
        b.title = 'Ask Xo (press X)';
      } else {
        b.removeAttribute('aria-keyshortcuts');
        b.title = 'Ask Xo';
      }
    });
  syncXoKey();
  subscribe(syncXoKey);
}
