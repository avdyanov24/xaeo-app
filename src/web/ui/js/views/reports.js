// Reports: white-label fix and progress reports. Opening one is a free preview in a new tab; the review attestation
// sits on every path that sends it (Download PDF, print), in report-actions.js (U06).
import { h, clear, icon, date, emptyState, button, link, friendlyError, api } from '../lib.js';
import { brandTokens } from '../brand-color.js';
import { state } from '../main.js';

// The report tab tells this one when a report is saved (on its first download or print), so Exported stays
// current without a reload. The channel name is shared with report-actions.js.
let exportsChannel = null;

export async function renderReports(el, ctx) {
  const d = ctx.detail,
    w = state.me.workspace;
  exportsChannel?.close();
  exportsChannel = null;
  if (!d.latest)
    return clear(
      el,
      emptyState({
        pose: 'curious',
        title: 'Reports start after the first scan',
        text: 'The report is built from the scan’s answers.',
        actions: [
          button('Run first scan', { onclick: (e) => ctx.startScan(e.currentTarget) }, 'play'),
        ],
      }),
    );
  const marker = h('div.reports-view');
  if ('BroadcastChannel' in window) {
    const channel = (exportsChannel = new BroadcastChannel('agency-report-exports'));
    channel.onmessage = ({ data }) => {
      if (!marker.isConnected) {
        channel.close();
        if (exportsChannel === channel) exportsChannel = null;
        return;
      }
      if (data?.clientId !== d.id) return;
      if (state.me?.onboarding) state.me.onboarding.report = true;
      ctx.refresh().catch(() => {
        /* the list catches up on the next visit */
      });
    };
  }
  // A small picture of the report's first page in the agency's color.
  const thumb = (type) =>
    h(
      'div.report-thumb.theme-light',
      {
        style: ((t) => ({ '--brand': t.brand, '--brand-graphic': t.graphic }))(
          brandTokens(w.color),
        ),
        'aria-hidden': 'true',
      },
      h('span.rt-band'),
      w.logo ? h('img.rt-logo', { src: w.logo, alt: '' }) : h('span.rt-agency', w.name),
      h('span.rt-line.rt-kicker'),
      h('span.rt-line.rt-title'),
      type === 'fix'
        ? h(
            'span.rt-bars',
            [0.3, 0.55, 0.8, 0.45].map((v) =>
              h('span', h('i', { style: { transform: `scaleX(${v})` } })),
            ),
          )
        : h(
            'span.rt-cols',
            [0.3, 0.45, 0.6, 0.75, 0.9].map((v) =>
              h('i', { style: { transform: `scaleY(${v})` } }),
            ),
          ),
    );
  // One click opens the live preview (a plain link, so popup blockers and middle-click both work). Options (full
  // answers, linked answer counts) live in the report's toolbar, next to what they change.
  const reportCard = (type, title, text, sections, first) => {
    const label = `Open ${title.toLowerCase()}`,
      note = h('p.muted.small', { id: `report-${type}-note`, hidden: true });
    const action = link(
      label,
      `/report#${new URLSearchParams({ client: d.id, type })}`,
      { target: '_blank', rel: 'noopener' },
      'external',
    );
    // Ask the server whether this report can be built (the same rule the preview uses). A known failure turns the
    // link into a disabled button that says why, instead of opening a tab that only shows the error.
    api(`/api/app/clients/${d.id}/reports?type=${type}&check=1`).then(
      (r) => {
        if (r.ready || !action.isConnected) return;
        note.textContent = friendlyError(new Error(r.error));
        note.hidden = false;
        action.replaceWith(
          button(label, { disabled: true, 'aria-describedby': note.id }, 'external'),
        );
      },
      () => {
        /* unknown: the preview shows its own error if it can't be built */
      },
    );
    return h(
      'section.card.report-card',
      { dataset: first ? { tour: 'report' } : {} },
      thumb(type),
      h('h2', title),
      h('p', text),
      h(
        'ul.mini-list',
        sections.map((x) => h('li', x)),
      ),
      action,
      note,
    );
  };
  const brandNote = !(w.logo || w.website)
    ? h(
        'div.notice',
        icon('palette'),
        h(
          'p',
          state.me.user.workspaceRole === 'owner'
            ? 'Reports use your logo, colors and website. Add them first so the report looks like yours.'
            : 'Reports use the agency’s branding. Ask the workspace owner to add a logo and website.',
        ),
        state.me.user.workspaceRole === 'owner'
          ? h('a.btn.btn-secondary.btn-sm', { href: '#/settings/workspace' }, 'Add your brand')
          : null,
      )
    : null;
  clear(
    el,
    marker,
    h(
      'div.section-head',
      h(
        'div',
        h('h2', 'Reports'),
        h(
          'p.muted',
          `White‑label: ${w.name}’s logo and colors, no Xaeo marks anywhere. A report opens as a preview in a new tab. You confirm your review there when you download or print it.`,
        ),
      ),
    ),
    brandNote,
    h(
      'div.grid-2',
      reportCard(
        'fix',
        'Fix report',
        `What the engines say about ${d.name} today, and the ranked fixes.`,
        [
          'At a glance, engine by engine',
          'Question grid',
          'Competitors and sources',
          'Ranked fixes with code',
          'Method and limits',
        ],
        true,
      ),
      reportCard(
        'progress',
        'Progress report',
        'Baseline against the latest scan, with the fixes shipped in between.',
        [
          'Before and after, per engine',
          'Named answers over time',
          'Fixes done and when',
          'Method and limits',
        ],
      ),
    ),
    h(
      'section.card',
      h('h2', 'Exported'),
      d.reportsList.length
        ? h(
            'ul.history',
            d.reportsList.map((r) =>
              h(
                'li',
                h('span.history-icon', icon(r.type === 'fix' ? 'file' : 'trending', 16)),
                h(
                  'a',
                  { href: `/report#report=${r.id}`, target: '_blank', rel: 'noopener' },
                  r.type === 'fix' ? 'Fix report' : 'Progress report',
                ),
                h('span.muted', date(r.createdAt, true)),
              ),
            ),
          )
        : h(
            'p.muted',
            'Nothing exported yet. A report lands here the first time you download or print it.',
          ),
    ),
  );
}
