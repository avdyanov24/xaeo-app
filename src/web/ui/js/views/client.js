// Client page: header, tabs (Overview · Questions · Answers · Fixes · Reports · Settings) and live scan progress.
import {
  api,
  h,
  clear,
  icon,
  button,
  link,
  errorToast,
  errorState,
  friendlyError,
  toast,
  busy,
  plural,
  reducedMotion,
  scanStarted,
  desk,
  date,
} from '../lib.js';
import { go, setTitle } from '../main.js';
import { renderOverview, isQueued, queuedText, markStopped } from './overview.js';
import { renderQuestions } from './questions.js';
import { renderAnswers } from './answers.js';
import { renderFixes } from './fixes.js';
import { renderReports } from './reports.js';
import { renderSettings } from './settings.js';

const TABS = [
  ['overview', 'Overview'],
  ['questions', 'Questions'],
  ['answers', 'Answers'],
  ['fixes', 'Fixes'],
  ['reports', 'Reports'],
  ['settings', 'Settings'],
];
// Where the tab underline was, so it can slide from the old tab to the new one.
let lastInk = null;
// The old ink's on-screen transform when a tab switch re-renders the header mid-slide, so the new ink continues from it.
let inkNow = null;
const scanLabel = (p) =>
  isQueued(p)
    ? `Queued · ${queuedText(p)}`
    : p?.job?.status === 'cancelling'
      ? 'Stopping scan'
      : p
        ? `Scanning ${p.done} of ${p.total}`
        : 'Scanning';
// R10: while answers come in, phones read "6 of 25" on one 14px line beside the spinner; "Scanning" stays for screen
// readers (app.css .scan-verb). Other states keep their full words.
const scanCounting = (p) => !!p && !isQueued(p) && p.job?.status !== 'cancelling';
// R14: an invisible trailing pad holds the digits the done count has not reached yet ("9" -> "10" of 15), so the button
// never widens and the text never shifts its start; the visible words keep normal spacing.
const scanPad = (p) => '0'.repeat(Math.max(0, String(p.total).length - String(p.done).length));
const scanLabelNodes = (p) =>
  scanCounting(p)
    ? [
        h('span.scan-verb', 'Scanning '),
        `${p.done} of ${p.total}`,
        scanPad(p) ? h('span.scan-pad', { 'aria-hidden': 'true' }, scanPad(p)) : null,
      ]
    : [scanLabel(p)];
const RENDER = {
  overview: renderOverview,
  questions: renderQuestions,
  answers: renderAnswers,
  fixes: renderFixes,
  reports: renderReports,
  settings: renderSettings,
};

export async function renderClient(
  view,
  id,
  tab,
  { detail = null, query = new URLSearchParams(), keep = false } = {},
) {
  if (!RENDER[tab]) tab = 'overview';
  let alive = true,
    timer = null;
  // main.js may hand over a detail it fetched before starting the view transition (C2).
  // ctx.query: the hash query (main.js parseHash), e.g. Fixes filters Xo opens with.
  const ctx = {
    id,
    query,
    keep,
    detail: detail || (await api(`/api/app/clients/${id}`)),
    progressListeners: new Set(),
  };
  const header = h('div'),
    content = h('div.tab-content');

  // `fresh` (optional): a detail already fetched, so a caller can hold its exit until the data is in (R3-3).
  // R14: a header redraw (scan end, a count change) replaces every header control. If one of them held focus (a tab,
  // the crumb, the domain link, Export), the same control in the new header takes it back, so focus never drops to <body>.
  const headerKey = () => {
    const a = document.activeElement?.closest?.('a, button');
    if (!a || !header.contains(a)) return null;
    if (a.dataset.tour) return `[data-tour="${CSS.escape(a.dataset.tour)}"]`;
    const href = a.getAttribute('href');
    return href ? `${a.tagName.toLowerCase()}[href="${CSS.escape(href)}"]` : null;
  };
  const redraw = () => {
    const key = headerKey();
    drawHeader();
    const lost =
      !document.activeElement ||
      document.activeElement === document.body ||
      !document.activeElement.isConnected;
    const twin = key && lost ? header.querySelector(key) : null;
    if (twin && !twin.disabled) twin.focus({ preventScroll: true });
  };
  ctx.refresh = async (fresh) => {
    ctx.detail = fresh || (await api(`/api/app/clients/${id}`));
    redraw();
    await drawTab();
    if (ctx.detail.running && !timer) poll();
  };
  // Views that change a header count (Fixes after Mark done) redraw only the header, keeping their own focus.
  ctx.redrawHeader = () => redraw();
  ctx.startScan = async (btn) => {
    // busy() disables the button at once, so read focus before it does.
    const hadFocus =
      !!btn && (btn === document.activeElement || header.contains(document.activeElement));
    const run = async () => {
      try {
        ctx.detail.running = await api(`/api/app/clients/${id}/scans`, { method: 'POST' });
        scanStarted(id);
        // R12: the header redraw disables the focused Run scan button, which dropped focus to <body>. Hand it to the
        // scan card's heading instead (it says what is happening; the card's live region reads the progress).
        redraw();
        if (tab !== 'overview') go(`#/clients/${id}/overview`);
        else {
          await drawTab();
          if (hadFocus)
            document.querySelector('[data-scan-heading]')?.focus({ preventScroll: true });
        }
        poll();
      } catch (err) {
        // The button comes back once busy() re-enables it; give focus back to it then.
        if (hadFocus)
          setTimeout(() => {
            if (btn.isConnected && !btn.disabled) btn.focus({ preventScroll: true });
          }, 0);
        // A refusal with a code (paused, over a limit, no live engine, budget) is a decision, not a failure: say why, and do not
        // offer Try again (the same request is refused the same way). Only the plain 409 below means "already running".
        if (err.kind === 'request' && err.code) {
          toast(friendlyError(err), { tone: 'error' });
          return;
        }
        // R10: 409 = a scan is already running (another tab, a teammate, Xo). Retrying can't help; show its progress.
        if (err.status === 409) {
          toast('A scan is already running for this client. Showing its progress.', {
            mark: 'info',
          });
          if (tab !== 'overview') go(`#/clients/${id}/overview`);
          else {
            await ctx.refresh();
          }
          return;
        }
        // R2-2: say what failed in plain words and offer the same action again.
        // R3-5: short enough for two lines on a 320px phone; the button carries "Try again".
        toast(
          err.kind === 'request'
            ? friendlyError(err)
            : err.kind === 'network'
              ? 'The scan didn’t start. You seem to be offline.'
              : 'The scan didn’t start on our side.',
          { tone: 'error', action: { label: 'Try again', onClick: () => ctx.startScan() } },
        );
      }
    };
    return btn ? busy(btn, run) : run();
  };
  // Cancel needs no confirm: answers already collected are kept and the rest can be retried from the overview.
  // 202 cancelled (queued scans) ends at once; 202 cancelling stops before the next answer; 409 = it already
  // finished; 404 = it is gone. Each outcome is spoken through the card's status line (onCancel listeners).
  // One cancel per scan: a second tap while the first POST is out (or after it landed) never sends another.
  let cancelSent = null;
  ctx.cancelScan = async (btn) =>
    busy(btn, async () => {
      const p = ctx.detail.running;
      if (!p || cancelSent === p.id || p.job?.status === 'cancelling') return;
      cancelSent = p.id;
      const say = (text) => ctx.progressListeners.forEach((fn) => fn(ctx.detail.running, text));
      try {
        const res = await api(`/api/app/scans/${p.id}/cancel`, { method: 'POST' });
        markStopped(p.id);
        if (!alive) return;
        ctx.detail.running = { ...p, job: { ...(p.job || {}), status: 'cancelling' } };
        redraw();
        say(
          res?.state === 'cancelled'
            ? 'Scan cancelled. Answers already collected are kept.'
            : 'Stopping the scan after the answer in progress. Answers already collected are kept.',
        );
        // The running 1s poll picks up the end state; starting a second poll here could finish the scan twice.
      } catch (err) {
        if (!alive) return;
        if (err.status !== 409 && err.status !== 404) cancelSent = null; // a network or server error can be retried
        if (err.status === 409) say('This scan already finished. Its result appears in a moment.');
        else if (err.status === 404) {
          toast('This scan is no longer available.');
          await ctx.refresh();
        } else errorToast(err);
      }
    });

  // U1: the result moment. Runs only when this page saw the scan running and it just finished while the
  // Overview is on screen; page loads, tab switches and polling re-renders never replay it.
  async function finishScan(p) {
    const before = ctx.detail.latest,
      stopped = p.job?.status === 'cancelled';
    if (stopped) markStopped(p.id);
    const watching = tab === 'overview' && document.visibilityState === 'visible' && !stopped;
    let fresh = null;
    if (watching) {
      ctx.reveal = {
        scanId: p.id,
        from: before ? before.mentioned : 0,
        first: !before,
        engines: Object.fromEntries(
          (ctx.detail.engines || []).map((e) => [e.id, e.ok ? e.mentioned / e.ok : 0]),
        ),
        kpis: { cited: ctx.detail.kpis?.cited ?? 0, fixesDone: ctx.detail.kpis?.fixesDone ?? 0 },
      };
      // R3-3: fetch the result while the thinking card is still fully on screen, THEN let it leave (150ms ease-in)
      // and draw the result in the same task as its removal. Fetching after the exit left one empty body frame.
      fresh = await api(`/api/app/clients/${id}`).catch(() => null);
      if (!alive) return;
      const leaving = content.querySelectorAll('.scan-card, .scan-grid');
      // C5 7.1: the last batch of cells lands, the full grid holds 240ms, then the cards leave.
      if (leaving.length && !reducedMotion())
        await new Promise((r) => setTimeout(r, Math.min(600, ctx.gridSettle?.() || 0) + 240));
      if (!alive) return;
      if (fresh && leaving.length && !reducedMotion()) {
        leaving.forEach((n) => n.classList.add('exit'));
        await new Promise((r) => setTimeout(r, 140));
      } // swap 10ms before fully transparent: no empty frame
    }
    // R13: focus sat on the scan card (its heading or Cancel) and the card is about to go. Hand it to the result card
    // that replaces it, so a keyboard user keeps their place; the overview's status line still speaks the number.
    const a = document.activeElement;
    const hadFocus = !!a?.closest?.('.scan-card, .scan-grid');
    await ctx.refresh(fresh || undefined);
    if (
      hadFocus &&
      alive &&
      (document.activeElement === document.body || !document.activeElement?.isConnected)
    ) {
      const result = content.querySelector('.headline') || content.querySelector('h2');
      if (result) {
        result.setAttribute('tabindex', '-1');
        result.focus({ preventScroll: true });
      }
    }
    const now = ctx.detail.latest;
    const shown = ctx.reveal?.used;
    ctx.reveal = null;
    if (shown) return; // Overview played the reveal and spoke the result in its own status line.
    if (stopped) {
      toast(
        now?.ok
          ? `Scan stopped. ${plural(now.ok, 'answer was', 'answers were')} collected; retry from the overview to fill in the rest.`
          : 'Scan stopped before any answer came back.',
      );
      return;
    }
    if (!now) return;
    const was = before?.mentioned,
      up = was !== undefined && now.mentioned > was,
      down = was !== undefined && now.mentioned < was;
    toast(
      `Scan finished: ${now.mentioned} of ${now.ok} answers name ${ctx.detail.name}.${up ? ` Up from ${was}.` : down ? ` Down from ${was}. See what changed.` : ''}`,
      {
        pose: content.querySelector('.xo')
          ? undefined
          : up
            ? 'excited'
            : down
              ? 'curious'
              : 'happy',
      },
    ); // one Xo on screen
  }

  function poll() {
    clearTimeout(timer);
    timer = null;
    if (!alive || !ctx.detail.running) return;
    timer = setTimeout(async () => {
      timer = null;
      try {
        const p = await api(`/api/app/scans/${ctx.detail.running.id}`);
        if (!alive) return;
        ctx.detail.running = p;
        const label = header.querySelector('[data-tour=run-scan] > span:last-child');
        if (label && p.status === 'running') {
          clear(label, scanLabelNodes(p));
          label.parentElement.classList.toggle('scan-short', scanCounting(p));
        }
        ctx.progressListeners.forEach((fn) => fn(p));
        if (p.status === 'running') return poll();
        await finishScan(p);
      } catch (err) {
        // R2-2: the scan runs on the server either way; say so once and keep checking (every 5s) instead of stopping.
        if (!alive) return;
        toast(
          err.kind === 'network'
            ? 'Lost the connection. The scan keeps running; we’ll update this page when you’re back online.'
            : 'We couldn’t check on the scan. It keeps running; we’ll try again in a few seconds.',
          { tone: 'error' },
        );
        timer = setTimeout(() => {
          timer = null;
          poll();
        }, 4000);
      }
    }, 1000);
  }

  function drawHeader() {
    const d = ctx.detail;
    // While a scan runs the button stays readable: spinner + "Scanning 6 of 25", updated by poll().
    const scanning = !!(d.runningId || d.running);
    const headTags = () => [
      d.sample ? h('span.tag', 'Sample') : null,
      d.status === 'archived' ? h('span.tag.tag-muted', 'Archived') : null,
    ];
    const runBtn = button(
      'Run scan',
      {
        variant: 'secondary',
        disabled: scanning || d.status === 'archived',
        'aria-busy': scanning ? 'true' : null,
        dataset: { tour: 'run-scan' },
        class: scanning && scanCounting(d.running) ? 'scan-short' : '',
        onclick: (e) => ctx.startScan(e.currentTarget),
      },
      'refresh',
    );
    if (scanning) clear(runBtn.lastElementChild, scanLabelNodes(d.running));
    // A+ desktop: the sidebar lists the clients (no crumb), the meta line ends with the last scan, Export is a quiet
    // ghost action before Run scan, and the tabs carry their counts. Phones and tablets keep the markup below.
    if (desk.matches) {
      const kind = [d.type, d.city].filter(Boolean);
      const activeQs = (d.questions || []).filter((q) => q.active).length;
      const counts = { questions: activeQs, answers: d.latest?.ok || 0, fixes: d.fixes.todo };
      // U23: a plain link to the Reports tab says so ("Reports", not "Export report"), and it goes away on that tab.
      const exportBtn =
        tab === 'reports'
          ? null
          : d.latest
            ? link(
                'Reports',
                `#/clients/${id}/reports`,
                { variant: 'ghost', class: 'head-export' },
                'file',
              )
            : h(
                'span.export-wait.head-export',
                button(
                  'Reports',
                  { variant: 'ghost', disabled: true, 'aria-describedby': 'export-wait-note' },
                  'file',
                ),
                h('span.export-wait-note#export-wait-note', 'Available after the first scan'),
              );
      clear(
        header,
        h(
          'div.page-head.client-head.desk-head',
          h(
            'div.desk-head-id',
            h('span.client-avatar.head-avatar', {
              'aria-hidden': 'true',
              dataset: { initial: d.name.trim()[0]?.toUpperCase() || '?' },
            }),
            h(
              'div',
              h('h1', h('span.client-title', d.name), headTags()),
              h(
                'p.head-domain',
                h(
                  'a.ext',
                  { href: `https://${d.domain}`, target: '_blank', rel: 'noopener noreferrer' },
                  d.domain,
                  icon('arrowUpRight', 14),
                ),
                kind.length
                  ? h(
                      'span.head-meta',
                      `${kind[0][0].toUpperCase()}${kind[0].slice(1)}${kind[1] ? ` in ${kind[1]}` : ''}`,
                    )
                  : null,
                d.latest
                  ? h('span.head-meta', `Last scan ${date(d.latest.finishedAt)}`)
                  : h('span.head-meta', 'No scan yet'),
              ),
            ),
          ),
          h(
            'div.row.head-actions',
            exportBtn,
            d.status === 'archived' && !scanning
              ? h(
                  'span.export-wait.scan-wait',
                  (runBtn.setAttribute('aria-describedby', 'scan-wait-note'), runBtn),
                  h('span.export-wait-note#scan-wait-note', 'Unarchive in Settings to scan'),
                )
              : runBtn,
          ),
        ),
        h(
          'nav.tabs',
          { 'aria-label': 'Client sections' },
          TABS.map(([key, label]) =>
            h(
              'a.tab',
              {
                href: `#/clients/${id}/${key}`,
                'aria-current': key === tab ? 'page' : null,
                class: key === tab ? 'active' : '',
              },
              label,
              counts[key] ? h('span.count', String(counts[key])) : null,
            ),
          ),
          h('span.tab-ink', { 'aria-hidden': 'true' }),
        ),
      );
    } else
      clear(
        header,
        h(
          'div.page-head.client-head',
          h(
            'div',
            h('a.crumb', { href: '#/' }, icon('chevronLeft', 16), 'Clients'),
            // The letter tile matches the client card, so the card -> page view transition (U6) has an anchor.
            h(
              'h1',
              h('span.client-avatar.head-avatar', {
                'aria-hidden': 'true',
                dataset: { initial: d.name.trim()[0]?.toUpperCase() || '?' },
              }),
              h('span.client-title', d.name),
              headTags(),
            ),
            // R3-2: the domain may only break after a dot (or at a hyphen), never mid-word ("northsideplumbing.co.u / k").
            // D6: on phones the Sample / Archived tags lead the domain row (CSS shows one copy per breakpoint), so the
            // name gets the title row to itself.
            h(
              'p.muted.head-domain',
              d.sample || d.status === 'archived' ? h('span.head-tags-phone', headTags()) : null,
              h(
                'span.head-domain-text',
                h(
                  'a.ext',
                  { href: `https://${d.domain}`, target: '_blank', rel: 'noopener noreferrer' },
                  String(d.domain)
                    .split('.')
                    .flatMap((part, i) => (i ? [h('wbr'), `.${part}`] : [part])),
                  icon('external', 14),
                ),
                [d.type, d.city].filter(Boolean).length
                  ? ` · ${[d.type, d.city].filter(Boolean).join(' in ')}`
                  : '',
              ),
            ),
          ),
          // Phones drop the Reports link from the header (the Reports tab is the same place) to give the content room.
          // R13: an archived client's Run scan says why it is off (same note pattern as Export before the first scan).
          h(
            'div.row.head-actions',
            d.status === 'archived' && !scanning
              ? h(
                  'span.export-wait.scan-wait',
                  (runBtn.setAttribute('aria-describedby', 'scan-wait-note'), runBtn),
                  h('span.export-wait-note#scan-wait-note', 'Unarchive in Settings to scan'),
                )
              : runBtn,
            tab === 'reports'
              ? null
              : d.latest
                ? link(
                    'Reports',
                    `#/clients/${id}/reports`,
                    { variant: 'secondary', class: 'head-export' },
                    'file',
                  )
                : h(
                    'span.export-wait.head-export',
                    button(
                      'Reports',
                      {
                        variant: 'secondary',
                        disabled: true,
                        'aria-describedby': 'export-wait-note',
                      },
                      'file',
                    ),
                    h('span.export-wait-note#export-wait-note', 'Available after the first scan'),
                  ),
          ),
        ),
        // Plain navigation links (not an ARIA tab widget): aria-current marks the open section.
        h(
          'nav.tabs',
          { 'aria-label': 'Client sections' },
          TABS.map(([key, label]) =>
            h(
              'a.tab',
              {
                href: `#/clients/${id}/${key}`,
                'aria-current': key === tab ? 'page' : null,
                class: key === tab ? 'active' : '',
              },
              label,
              key === 'fixes' && d.fixes.todo ? h('span.count', String(d.fixes.todo)) : null,
            ),
          ),
          h('span.tab-ink', { 'aria-hidden': 'true' }),
        ),
      );
    // C5 5.1: the ink leads. It starts moving on the click, before the tab's data loads; the content rises after.
    const nav = header.querySelector('.tabs'),
      ink = nav.querySelector('.tab-ink');
    nav.addEventListener('click', (e) => {
      const a = e.target.closest('a.tab');
      if (!a || a.classList.contains('active') || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const to = { id, x: a.offsetLeft, w: a.offsetWidth };
      ink.style.transform = `translateX(${to.x}px) scaleX(${to.w / 100})`;
      lastInk = to;
    });
    setTitle(d.name, TABS.find(([k]) => k === tab)[1]);
    requestAnimationFrame(placeInk);
  }
  function placeInk() {
    const nav = header.querySelector('.tabs'),
      ink = nav?.querySelector('.tab-ink'),
      active = nav?.querySelector('.tab.active');
    if (!ink || !active) return;
    const to = { id, x: active.offsetLeft, w: active.offsetWidth };
    const put = (p) => {
      ink.style.transform = `translateX(${p.x}px) scaleX(${p.w / 100})`;
    };
    if (lastInk && lastInk.id === id && (inkNow || lastInk.x !== to.x || lastInk.w !== to.w)) {
      ink.classList.add('still');
      if (inkNow && inkNow !== 'none') ink.style.transform = inkNow;
      else put(lastInk);
      void ink.offsetWidth;
      ink.classList.remove('still');
    }
    inkNow = null;
    put(to);
    lastInk = to;
    // Horizontal only: scrollIntoView would also scroll the page up to the tabs when the header redraws
    // mid-page (Fixes badge after Mark done), undoing the scroll to the next fix.
    // R9: an overflowing strip centres the open tab, so a neighbour peeks out on each side (at 375 "Fixes" used to sit
    // flush right with "Reports" hidden under the end fade and "Overview" cut to "erview").
    if (nav.scrollWidth > nav.clientWidth + 1)
      nav.scrollLeft = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
    // C20: the end fade (app.css .tabs mask) only shows while more tabs wait to the right; R9 adds the start side.
    const edge = () => {
      nav.classList.toggle('at-end', nav.scrollLeft + nav.clientWidth >= nav.scrollWidth - 2);
      nav.classList.toggle('at-start', nav.scrollLeft <= 1);
    };
    if (!nav.dataset.edge) {
      nav.dataset.edge = '1';
      nav.addEventListener('scroll', edge, { passive: true });
      // R11: Tab onto a tab that sits past the strip's edge: the snap strip did not scroll it in, so its inset focus
      // ring was cut off. Centre it the same way as the open tab.
      nav.addEventListener('focusin', (e) => {
        const t = e.target.closest('.tab');
        if (!t || nav.scrollWidth <= nav.clientWidth + 1) return;
        const r = t.getBoundingClientRect(),
          n = nav.getBoundingClientRect();
        if (r.left < n.left || r.right > n.right)
          nav.scrollLeft = t.offsetLeft - (nav.clientWidth - t.offsetWidth) / 2;
      });
    }
    edge();
  }
  async function drawTab() {
    ctx.progressListeners.clear();
    // R2-2: a failed tab load keeps the header and tabs, explains in plain words and retries only this tab.
    try {
      await RENDER[tab](content, ctx);
      // R10: Overview and Settings start with cards, not a section heading; a hidden one names the tab, so a keyboard
      // or screen reader user who switches tabs lands on "Overview" (main.js) rather than the first card's title.
      if (!content.querySelector(':scope > .section-head h2'))
        content.prepend(
          h('h2.visually-hidden.tab-title', { tabindex: '-1' }, TABS.find(([k]) => k === tab)[1]),
        );
    } catch (err) {
      clear(
        content,
        errorState({
          what: `the ${TABS.find(([k]) => k === tab)[1].toLowerCase()}`,
          error: err,
          retry: drawTab,
          back: false,
        }),
      );
    }
  }

  const oldInk = view.querySelector('.tabs .tab-ink');
  inkNow = oldInk && lastInk?.id === id ? getComputedStyle(oldInk).transform : null;
  drawHeader();
  clear(view, header, content);
  placeInk();
  await drawTab();
  if (ctx.detail.running) poll();
  return () => {
    alive = false;
    clearTimeout(timer);
  };
}
