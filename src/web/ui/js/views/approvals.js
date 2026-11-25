// #/approvals: every draft Xo put up for approval, across clients, as the same artifact
// cards the chat shows (xo-cards.js), so a decision here updates the chat and the other way round. Filters live in
// the hash query (?status=pending|approved|rejected|all&client=<id>&artifact=<id>); `artifact` scrolls to one card.
// Also here: the nav badge (pending count) and the client overview's "Pending approvals" block.
import { api, h, clear, icon, plural, emptyState, segScroll, date, reducedMotion } from '../lib.js';
import { renderCard, riskPill, kindIcon, kindLabel, displayTitle } from '../xo-cards.js';
import { go, state } from '../main.js';
import { xoAvailable, openXo } from '../xo-chat.js';

const FILTERS = [
  ['pending', 'Waiting'],
  ['approved', 'Approved'],
  ['rejected', 'Rejected'],
  ['all', 'All'],
];
const EMPTY = {
  pending: [
    'Nothing is waiting for approval',
    'When Xo drafts a fix, schema or page, it lands here. Nothing ships until someone in your workspace approves it.',
  ],
  approved: ['No approved drafts yet', 'Approved drafts stay here, ready to copy or download.'],
  rejected: [
    'No rejected drafts',
    'Drafts you reject stay here, so you can see what was turned down.',
  ],
  all: [
    'No drafts yet',
    'Ask Xo what to fix first for a client. Its drafts show up here for approval.',
  ],
};

const hashFor = ({ status, client, artifact }) => {
  const q = new URLSearchParams();
  if (status && status !== 'pending') q.set('status', status);
  if (client) q.set('client', client);
  if (artifact) q.set('artifact', artifact);
  const s = q.toString();
  return `#/approvals${s ? `?${s}` : ''}`;
};

// The list shows artifacts, not approval rows: newest approval per artifact (an edited draft has a stale one too).
const byArtifact = (approvals) => {
  const seen = new Set();
  return approvals.filter((a) => !seen.has(a.artifactId) && seen.add(a.artifactId) && a.card);
};

export async function renderApprovals(el, { query }) {
  const status = FILTERS.some(([k]) => k === query.get('status')) ? query.get('status') : 'pending';
  const client = query.get('client') || '';
  const focusId = query.get('artifact') || '';
  const q = new URLSearchParams({ status });
  if (client) q.set('clientId', client);
  const data = await api(`/api/app/xo/approvals?${q}`);
  const rows = byArtifact(data.approvals);
  setBadge(client ? null : data.pendingCount);
  const clientName = data.client?.name || rows[0]?.clientName || '';

  const seg = (key, label) =>
    h(
      'button.seg',
      {
        type: 'button',
        'aria-pressed': String(key === status),
        onclick: () => go(hashFor({ status: key, client })),
      },
      label,
      key === 'pending'
        ? h(
            'span.count',
            { dataset: { pendingSeg: '' }, hidden: !data.pendingCount },
            String(data.pendingCount),
          )
        : null,
    );
  const head = h(
    'div.page-head',
    h(
      'div',
      h('h1', 'Approvals'),
      h(
        'p.lead',
        'Drafts Xo made for your clients. Check each one, then approve it. Nothing ships without a person here saying yes.',
      ),
    ),
  );
  const tools = h(
    'div.approvals-tools',
    segScroll(
      h(
        'div.segmented',
        { role: 'group', 'aria-label': 'Show' },
        FILTERS.map(([k, l]) => seg(k, l)),
      ),
    ),
    client
      ? h(
          'p.approvals-scope',
          h('span', 'Showing ', h('strong', clientName || 'one client')),
          h(
            'a.btn.btn-ghost.btn-sm',
            { href: hashFor({ status }), 'aria-label': 'Show every client' },
            icon('x', 16),
            h('span', 'All clients'),
          ),
        )
      : null,
  );
  const list = rows.length
    ? h(
        'div.approvals-list',
        rows.map((r, i) =>
          h(
            'div.approvals-item',
            { style: { '--i': Math.min(i, 6) } },
            renderCard(r.card, { showClient: !client }),
          ),
        ),
      )
    : emptyState({
        pose: status === 'pending' ? 'happy' : 'curious',
        title: EMPTY[status][0],
        text: EMPTY[status][1],
        actions:
          xoAvailable() && status !== 'rejected'
            ? [
                h(
                  'button.btn',
                  { type: 'button', onclick: (e) => openXo(e.currentTarget) },
                  icon('message', 18),
                  h('span', 'Ask Xo what to fix first'),
                ),
              ]
            : [],
      });
  clear(el, h('div.approvals', head, tools, list));

  // ?artifact=: bring that card into view and give it focus (links from the overview block).
  if (focusId) {
    const card = el.querySelector(`.xo-card[data-artifact-id="${CSS.escape(focusId)}"]`);
    if (card)
      requestAnimationFrame(() => {
        card.tabIndex = -1;
        card.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
        card.focus({ preventScroll: true });
        card.classList.add('is-target');
        setTimeout(() => card.classList.remove('is-target'), 1600);
      });
  }
}

// ---- nav badge: pending approvals across the workspace ----
let badgeT = 0,
  badgeSeq = 0;
function setBadge(n) {
  if (n == null) return;
  const count = Math.max(0, Number(n) || 0);
  document.querySelectorAll('[data-pending-badge]').forEach((b) => {
    const was = b.textContent;
    b.textContent = count > 9 ? '9+' : String(count);
    b.hidden = !count;
    if (count && was && was !== b.textContent) {
      b.classList.remove('bump');
      void b.offsetWidth;
      b.classList.add('bump');
    }
  });
  document.querySelectorAll('[data-pending-seg]').forEach((b) => {
    b.textContent = String(count);
    b.hidden = !count;
  });
  document
    .querySelectorAll('[data-nav="approvals"]')
    .forEach((a) =>
      a.setAttribute('aria-label', count ? `Approvals, ${count} waiting` : 'Approvals'),
    );
}
export function refreshPending() {
  if (!state.me?.xo) return;
  clearTimeout(badgeT);
  badgeT = setTimeout(async () => {
    const my = ++badgeSeq;
    try {
      const r = await api('/api/app/xo/approvals?status=pending');
      if (my === badgeSeq) setBadge(r.pendingCount);
    } catch {
      /* the badge keeps its last value */
    }
  }, 150);
}

// Called once from main.js boot. Xo on: Approvals joins the nav (on phones it takes Brand's bottom-bar slot and
// Brand moves into the account sheet, so the bar keeps five items).
export function initApprovalsNav(me) {
  const on = !!me?.xo;
  document.querySelectorAll('[data-xo-nav]').forEach((n) => {
    n.hidden = !on;
  });
  document.querySelectorAll('[data-xo-swap]').forEach((n) => {
    n.hidden = on;
  });
  if (!on) return;
  refreshPending();
  addEventListener('xaeo:artifact', refreshPending);
  addEventListener('xaeo:refresh', refreshPending);
}

// ---- client overview: "Pending approvals" (count + list, each row opens its card in #/approvals) ----
export const pendingFor = (clientId) =>
  state.me?.xo
    ? api(`/api/app/xo/approvals?status=pending&clientId=${encodeURIComponent(clientId)}`).catch(
        () => null,
      )
    : Promise.resolve(null);

export function pendingBlock(clientId, data) {
  const box = h('section.card.pending-block', { 'aria-labelledby': `pending-${clientId}` });
  const paint = (d) => {
    const rows = byArtifact(d?.approvals || []).filter((r) => r.status === 'pending');
    box.hidden = !rows.length;
    if (!rows.length) return clear(box);
    clear(
      box,
      h(
        'div.card-head',
        h(
          'h2',
          { id: `pending-${clientId}` },
          'Pending approvals',
          h('span.count', String(rows.length)),
        ),
        h(
          'a.card-link',
          { href: hashFor({ client: clientId }) },
          h('span', 'Review all'),
          icon('chevronRight', 16),
        ),
      ),
      h(
        'ul.pending-list',
        rows.slice(0, 5).map((r) => {
          const a = r.card.artifact;
          return h(
            'li',
            h(
              'a.pending-row',
              { href: hashFor({ client: clientId, artifact: r.artifactId }) },
              h('span.xo-card-icon', { 'aria-hidden': 'true' }, icon(kindIcon(r.kind), 18)),
              h(
                'span.pending-copy',
                h('span.pending-title', displayTitle(r.title)),
                h(
                  'span.pending-meta',
                  [
                    kindLabel(r.kind),
                    `asked ${date(r.requestedAt)}`,
                    a.approveBlockedBy ? 'needs values first' : null,
                  ]
                    .filter(Boolean)
                    .join(' · '),
                ),
              ),
              riskPill(r.risk),
              icon('chevronRight', 18),
            ),
          );
        }),
      ),
      rows.length > 5
        ? h('p.muted.small', `${plural(rows.length - 5, 'more draft')} in Approvals.`)
        : null,
    );
  };
  paint(data);
  // A decision anywhere (chat, Approvals, the drawer) updates the block without a reload.
  let t = 0;
  const onChange = (e) => {
    if (!box.isConnected) return removeEventListener('xaeo:artifact', onChange);
    if (e.detail?.card?.clientId !== clientId) return;
    clearTimeout(t);
    t = setTimeout(async () => {
      const d = await pendingFor(clientId);
      if (d && box.isConnected) paint(d);
    }, 150);
  };
  addEventListener('xaeo:artifact', onChange);
  return box;
}

// ---- client Fixes tab: "1 draft approved for {client}, ready to ship" (U01, UI part) ----
// Counts this client's Xo drafts by state and links to Approvals for that client. It does not claim which fix a draft
// belongs to (drafts carry no fix link in the UI yet): only how many are approved and how many wait. Hidden when
// there are none. A decision anywhere (chat, Approvals, the drawer) repaints it through `xaeo:artifact`.
export const draftsFor = (clientId) =>
  state.me?.xo
    ? api(`/api/app/xo/approvals?status=all&clientId=${encodeURIComponent(clientId)}`).catch(
        () => null,
      )
    : Promise.resolve(null);

export function draftStrip(clientId, clientName, data) {
  const box = h('div.notice.notice-soft.draft-strip');
  const paint = (d) => {
    const rows = byArtifact(d?.approvals || []);
    const ready = rows.filter((r) => ['approved', 'applied'].includes(r.card.state)).length;
    const waiting = rows.filter((r) => r.card.state === 'pending').length;
    // .notice sets display, which beats [hidden]: an empty strip is taken out with an inline display instead.
    box.style.display = ready || waiting ? '' : 'none';
    if (!ready && !waiting) return clear(box);
    const name = clientName || 'this client';
    const text = ready
      ? `${plural(ready, 'draft')} approved for ${name}, ready to ship${waiting ? ` · ${waiting} waiting for approval` : ''}`
      : `${plural(waiting, 'draft')} for ${name} ${waiting === 1 ? 'is' : 'are'} waiting for approval`;
    clear(
      box,
      icon(waiting ? 'clock' : 'check', 18),
      h('p', text),
      // F1-7: the link opens the tab that lists what the strip counts: All when it names both kinds.
      h(
        'a.btn.btn-ghost.btn-sm',
        {
          href: hashFor({
            status: ready && waiting ? 'all' : waiting ? 'pending' : 'approved',
            client: clientId,
          }),
        },
        h('span', waiting ? 'Review in Approvals' : 'Open in Approvals'),
        icon('chevronRight', 16),
      ),
    );
  };
  paint(data);
  let t = 0;
  const onChange = (e) => {
    if (!box.isConnected) return removeEventListener('xaeo:artifact', onChange);
    if (e.detail?.card?.clientId !== clientId) return;
    clearTimeout(t);
    t = setTimeout(async () => {
      const d = await draftsFor(clientId);
      if (d && box.isConnected) paint(d);
    }, 150);
  };
  addEventListener('xaeo:artifact', onChange);
  return box;
}
