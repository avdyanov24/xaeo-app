// Settings (#/settings/<section>): one place for the workspace, its data and this browser's preferences.
// Wide screens: a section list on the left, one section on the right. Phones: #/settings is the list, a section
// opens on its own with a link back. Client settings stay inside each client (views/settings.js).
// Workspace sections save to the server (owner-only edits, "Saved" toast); device sections write `xaeo-prefs`
// through prefs.js and apply at once, with no toast.
import { h, clear, icon } from '../lib.js';
import { state, refreshMe, setTitle, refreshRoute } from '../main.js';
import { brandSection, dataSection } from './brand.js';
import { timeZoneBlock } from './settings.js';
import { get, set, subscribe } from '../prefs.js';

const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const SECTIONS = [
  {
    id: 'workspace',
    group: 'Workspace',
    label: 'Workspace and brand',
    icon: 'palette',
    lead: 'How your reports look, and when weekly rescans run.',
    render: workspace,
  },
  {
    id: 'data',
    group: 'Workspace',
    label: 'Team and data',
    icon: 'database',
    lead: 'Who is in this workspace, and downloads of your data.',
    render: () => dataSection(),
  },
  {
    id: 'appearance',
    group: 'This browser',
    label: 'Appearance',
    icon: 'sliders',
    lead: 'Saved in this browser only. Changes apply at once.',
    render: appearance,
  },
  {
    id: 'xo',
    group: 'This browser',
    label: 'Xo',
    icon: 'message',
    lead: 'Saved in this browser only. Changes apply at once.',
    when: (me) => !!me.xo,
    render: xoPrefs,
  },
];

export async function renderSettings(view, { section } = {}) {
  await refreshMe();
  const me = state.me;
  const list = SECTIONS.filter((s) => !s.when || s.when(me));
  let current = list.find((s) => s.id === section);
  // An unknown or unavailable section (e.g. Xo switched off) falls back to the Settings index.
  if (section && !current) {
    history.replaceState(null, '', '#/settings');
    section = undefined;
  }
  current = current || list[0];
  setTitle(section ? current.label : null, 'Settings');

  const nav = h(
    'nav.settings-nav',
    { 'aria-label': 'Settings sections' },
    [...new Set(list.map((s) => s.group))].map((group) =>
      h(
        'div.settings-group',
        h(
          'p.settings-group-label',
          { id: `sg-${group.replace(/\s+/g, '-').toLowerCase()}` },
          group,
        ),
        h(
          'ul',
          { 'aria-labelledby': `sg-${group.replace(/\s+/g, '-').toLowerCase()}` },
          list
            .filter((s) => s.group === group)
            .map((s) =>
              h(
                'li',
                h(
                  'a.settings-link',
                  { href: `#/settings/${s.id}`, 'aria-current': s === current ? 'page' : null },
                  h('span.settings-link-icon', icon(s.icon, 18)),
                  h('span.settings-link-label', s.label),
                  h('span.settings-link-go', icon('chevronRight', 18)),
                ),
              ),
            ),
        ),
      ),
    ),
  );

  const body = await current.render(me);
  // Switching sections replaces the link that had focus; keyboard users land on the new section's heading.
  const hadFocus = view.contains(document.activeElement);
  const main = h(
    'section.settings-main.tab-content',
    { 'aria-labelledby': 'settings-section-title' },
    h('a.crumb.settings-back', { href: '#/settings' }, icon('chevronLeft', 16), 'All settings'),
    h(
      'div.settings-head',
      h('h2#settings-section-title', { tabindex: '-1' }, current.label),
      h('p.muted', current.lead),
    ),
    body,
  );

  clear(
    view,
    h(
      'div.page-head',
      h(
        'div',
        h('h1', 'Settings'),
        h('p.lead', 'Your workspace, its data, and how Xaeo works in this browser.'),
      ),
    ),
    h('div.settings-layout', { dataset: section ? {} : { index: '' } }, nav, main),
  );
  if (section && matchMedia('(max-width: 719px)').matches) scrollTo({ top: 0 });
  if (section && hadFocus)
    view.querySelector('#settings-section-title')?.focus({ preventScroll: true });
}

function workspace() {
  return [
    brandSection(),
    h(
      'section.card.settings-card',
      { 'aria-labelledby': 'tz-title' },
      h('h3#tz-title', 'Time zone'),
      h(
        'p.muted.card-lead',
        'Weekly rescans run every Monday at 09:00 in this time zone, for every client.',
      ),
      timeZoneBlock({ refresh: () => refreshRoute() }),
    ),
  ];
}

// One choice per row: title and one line of help on the left, native radios drawn as a segmented control on the
// right (arrow keys move between options for free). An option may carry a Lucide icon name as its third item.
function choice(name, title, help, options) {
  const id = `pref-${name}`;
  return h(
    'div.pref-row',
    h(
      'div.pref-text',
      h('h3', { id: `${id}-label` }, title),
      h('p.muted', { id: `${id}-help` }, help),
    ),
    h(
      'div.seg-radio',
      { role: 'radiogroup', 'aria-labelledby': `${id}-label`, 'aria-describedby': `${id}-help` },
      options.map(([value, label, ic]) =>
        h(
          'label.seg-opt',
          h('input', {
            type: 'radio',
            name: id,
            value,
            checked: get(name) === value,
            onchange: () => set(name, value),
          }),
          h('span', ic ? icon(ic, 16) : null, label),
        ),
      ),
    ),
  );
}
function toggle(name, title, help) {
  const id = `pref-${name}`;
  return h(
    'label.pref-row.pref-switch',
    { for: id },
    h('span.pref-text', h('span.pref-title', title), h('span.muted', { id: `${id}-help` }, help)),
    h('input.switch', {
      type: 'checkbox',
      id,
      role: 'switch',
      checked: get(name) === true,
      'aria-describedby': `${id}-help`,
      onchange: (e) => set(name, e.target.checked),
    }),
  );
}

// The palette, another tab or the OS can change a preference while this card is open: keep the radios in step.
// The subscription ends itself once the card has left the page (route change).
function syncRadios(card) {
  const off = subscribe(() => {
    if (!card.isConnected) return off();
    card.querySelectorAll('input[type=radio]').forEach((r) => {
      r.checked = get(r.name.replace(/^pref-/, '')) === r.value;
    });
  });
  return card;
}

function appearance() {
  return syncRadios(
    h(
      'section.card.settings-card.pref-card',
      { 'aria-label': 'Appearance' },
      choice('theme', 'Theme', 'System follows your device setting.', [
        ['light', 'Light', 'sun'],
        ['dark', 'Dark', 'moon'],
        ['system', 'System', 'monitor'],
      ]),
      choice('density', 'Density', 'Compact tightens spacing on pages, cards and lists.', [
        ['comfortable', 'Comfortable'],
        ['compact', 'Compact'],
      ]),
      choice(
        'motion',
        'Reduce motion',
        'Reduce keeps screens still: no slides, pops or counting numbers.',
        [
          ['system', 'Match device'],
          ['reduce', 'Reduce'],
        ],
      ),
      h(
        'p.pref-foot.muted',
        icon('info', 14),
        h(
          'span',
          'Text size follows your browser zoom (',
          h('kbd', mac ? 'Cmd' : 'Ctrl'),
          ' and ',
          h('kbd', '+'),
          ').',
        ),
      ),
    ),
  );
}

function xoPrefs() {
  return h(
    'section.card.settings-card.pref-card',
    { 'aria-label': 'Xo' },
    toggle(
      'xoOnStart',
      'Open Xo when I sign in',
      'On wide screens, Xo opens beside your work at the start of each session.',
    ),
    toggle('xoKey', 'X opens Xo', 'Press X anywhere outside a text field to open or close Xo.'),
  );
}
