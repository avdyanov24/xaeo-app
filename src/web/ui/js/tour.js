// "Tour with Xo": Xo walks to each part of the app, spotlights it and explains it in one or two sentences.
// Uses a scanned client when available; empty workspaces get a shorter setup tour. Esc closes, arrow keys step.
import { api, h, errorToast, reducedMotion } from './lib.js';
import { createXo } from './xo.js';
import { get as pref } from './prefs.js';
// Settings > Xo can turn the X shortcut off; then the tour must not teach it.
const xoKeyOn = () => pref('xoKey') !== false;

let active = null;
const reduced = reducedMotion;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PHONE = 720,
  GAP = 16,
  PAD = 8,
  EDGE = 16;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
// The sticky top bar paints over anything scrolled under it, so the spotlight starts below it.
const chromeBottom = () =>
  Math.max(0, document.querySelector('.topbar')?.getBoundingClientRect().bottom || 0);

async function waitFor(selector, timeout = 4000) {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    const el = document.querySelector(selector);
    if (el && el.getBoundingClientRect().height > 0) return el;
    await wait(80);
  }
  return null;
}

// Ask Xo: shown only when Xo is on. Phones hide the bottom bar during the tour, so the step
// has no spotlight there and names the bar instead.
function xoStep() {
  if (!document.querySelector('[data-xo-open]:not([hidden])')) return [];
  const phone = innerWidth < PHONE;
  return [
    {
      route: '#/',
      target: phone
        ? null
        : innerWidth >= 1024
          ? '.sidebar [data-tour="ask-xo"]'
          : '.topbar [data-tour="ask-xo"]',
      pose: 'happy',
      title: 'Ask Xo',
      text: `Xo answers questions about your clients from your Xaeo data and opens the view that shows it. ${phone ? 'Find it as Ask Xo in the bottom bar.' : xoKeyOn() ? 'Press X to open it from any screen.' : `Open it with Ask Xo in the ${innerWidth >= 1024 ? 'sidebar' : 'top bar'}.`}`,
    },
  ];
}

function steps(clientId) {
  const c = `#/clients/${clientId}`;
  const intro = [
    {
      route: '#/',
      pose: 'waving',
      title: 'Welcome to your workspace',
      text: 'Xaeo helps you review AI answers and turn gaps into work for your clients. This short tour shows the main path.',
    },
    {
      route: '#/',
      target: '[data-tour="add-client"]',
      pose: 'curious',
      title: 'Start with a client',
      text: 'Add their website, business type and city. You can review suggested buyer questions before scanning.',
    },
  ];
  if (!clientId)
    return [
      ...intro,
      {
        route: '#/',
        target: '[data-tour="onboarding"]',
        pose: 'happy',
        title: 'Follow the setup guide',
        text: `The checklist takes you from your first client to a report. You can also add a sample client to explore without using customer data.`,
      },
      ...xoStep(),
      {
        route: '#/',
        pose: 'cheering',
        title: 'You’re ready',
        text: 'Add a client when you’re ready. You can reopen this tour from the top bar.',
      },
    ];
  return [
    ...intro,
    {
      route: '#/',
      target: '[data-tour="client-card"]',
      pose: 'happy',
      title: 'See what needs attention',
      text: `Each client ${innerWidth >= 1024 ? 'row' : 'card'} shows the latest result and one next action. Sample results are illustrative.`,
    },
    {
      route: `${c}/overview`,
      target: '[data-tour="run-scan"]',
      pose: 'excited',
      title: 'Run a scan',
      text: 'Scans use the engines available to your workspace. Sample data uses scripted answers, and unavailable engines are marked separately.',
    },
    {
      route: `${c}/answers`,
      target: '[data-tour="grid"]',
      pose: 'curious',
      title: 'Read the evidence',
      text: 'Open an answer to see its text and cited sources. Check the evidence before treating a recommendation as a finding.',
    },
    // If no fix is rendered (all done or set aside), the filter row is the target instead of stalling on a missing fix.
    {
      route: `${c}/fixes`,
      target: '[data-tour="fix"] .fix-head',
      ready: '.fix-toolbar, .filtered-empty, .tab-content .empty',
      alt: '.fix-toolbar',
      pose: 'thinking',
      title: 'Review a fix',
      text: 'Fixes include supporting answers and a suggested change. Verify the client’s site before shipping any code.',
    },
    {
      route: `${c}/reports`,
      target: '[data-tour="report"]',
      pose: 'excited',
      title: 'Prepare a report',
      text: 'Review the findings, add your agency brand and save a report as PDF when it is ready to share.',
    },
    ...xoStep(),
    {
      route: '#/',
      pose: 'cheering',
      title: 'That’s the main path',
      text: 'Return to a client whenever you need the next action. Reopen this tour from the top bar.',
    },
  ];
}

export async function startTour() {
  if (active) return;
  let clientId;
  try {
    const { clients } = await api('/api/app/clients');
    clientId = (clients.find((c) => c.sample && c.latest) || clients.find((c) => c.latest))?.id;
  } catch (err) {
    return errorToast(err);
  }
  const list = steps(clientId);
  let index = 0;
  const previousRoute = location.hash;

  const spot = h('div.tour-spot');
  const guide = createXo({ mood: 'waving' });
  const img = guide.el;
  img.classList.add('tour-xo');
  const title = h('h2.tour-title'),
    head = h('div.tour-head', title),
    text = h('p.tour-text'),
    count = h('span.tour-count');
  const back = h(
    'button.btn.btn-ghost.btn-sm',
    { type: 'button', onclick: () => show(index - 1) },
    'Back',
  );
  const next = h('button.btn.btn-sm', { type: 'button', onclick: () => show(index + 1) }, 'Next');
  const skip = h('button.linkish.tour-skip', { type: 'button', onclick: () => end() }, 'Skip tour');
  const bubble = h(
    'div.tour-bubble',
    { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tour-title' },
    head,
    text,
    h('div.tour-actions', count, h('div.row', skip, back, next)),
  );
  title.id = 'tour-title';
  // Xo sits in the bubble header at every width (64px on desktop, 40px on phones), so it never covers page content.
  // Phones dock the card as a top or bottom sheet. The card never overlaps the spotlit target.
  const card = h('div.tour-card', bubble);
  const layer = h('div.tour', h('div.tour-shade'), spot, card);
  const previousFocus = document.activeElement;
  document.body.append(layer);
  document.body.classList.add('touring');
  let target = null,
    token = 0,
    shown = '',
    settling = false;

  // Lays out the spotlight and the card for the current target.
  function place() {
    const vw = innerWidth,
      vh = innerHeight,
      phone = vw < PHONE,
      top = chromeBottom();
    let a = null;
    if (target) {
      // A target inside the top bar (Ask Xo) is not covered by it, so its spotlight may start above the bar's edge.
      const r = target.getBoundingClientRect(),
        floor = target.closest('.topbar, .sidebar') ? 0 : top;
      a = {
        l: Math.max(0, r.left - PAD),
        t: clamp(r.top - PAD, floor, vh),
        r: Math.min(vw, r.right + PAD),
        b: clamp(r.bottom + PAD, floor, vh),
      };
    }
    if (img.parentNode !== head) head.prepend(img);
    if (phone) {
      const low = a && a.t > vh * 0.55;
      card.className = `tour-card sheet ${low ? 'sheet-top' : 'sheet-bottom'}`;
      card.style.transform = '';
      const c = card.getBoundingClientRect();
      if (a) {
        if (low) a.t = Math.max(a.t, c.bottom + GAP);
        else a.b = Math.min(a.b, c.top - GAP);
      }
    } else {
      card.className = 'tour-card';
      const cw = card.offsetWidth,
        ch = card.offsetHeight;
      let x = (vw - cw) / 2,
        y = (vh - ch) / 2;
      if (a) {
        // Below, above, right, left of the target: the first that fits on screen wins. A target too big for all four
        // is spotlit down to the part above the card.
        const cx = clamp(a.l, EDGE, vw - cw - EDGE),
          cy = clamp(a.t, EDGE, vh - ch - EDGE);
        const fits = ([px, py]) =>
          px >= EDGE && py >= EDGE && px + cw <= vw - EDGE && py + ch <= vh - EDGE;
        const spot = [
          [cx, a.b + GAP],
          [cx, a.t - GAP - ch],
          [a.r + GAP, cy],
          [a.l - GAP - cw, cy],
        ].find(fits);
        if (spot) [x, y] = spot;
        else {
          x = cx;
          y = vh - ch - EDGE;
          a.b = Math.min(a.b, y - GAP);
        }
      }
      card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }
    if (a)
      Object.assign(spot.style, {
        transform: `translate(${Math.round(a.l)}px, ${Math.round(a.t)}px)`,
        width: `${Math.round(a.r - a.l)}px`,
        height: `${Math.round(Math.max(0, a.b - a.t))}px`,
      });
    spot.classList.toggle('hidden', !a);
  }

  // Before each step the target scrolls to about 30% of the screen (just under the top bar on phones, so the sheet fits).
  function scrollToTarget() {
    const r = target.getBoundingClientRect(),
      top = chromeBottom() + PAD + 8;
    const want = innerWidth < PHONE ? top : Math.max(top, innerHeight * 0.3);
    scrollTo({ top: Math.max(0, scrollY + r.top - want), behavior: reduced() ? 'auto' : 'smooth' });
  }

  async function show(i) {
    if (i < 0) return;
    if (i >= list.length) return end();
    const my = ++token;
    settling = true;
    index = i;
    const step = list[i];
    bubble.classList.add('changing');
    if (location.hash !== step.route) location.hash = step.route;
    if (step.ready) {
      // Wait for the screen, not the element: once it has rendered, use the target, its fallback, or skip at once.
      await waitFor(step.ready);
      const found =
        document.querySelector(step.target) || (step.alt && document.querySelector(step.alt));
      target = found && found.getBoundingClientRect().height > 0 ? found : null;
    } else target = step.target ? await waitFor(step.target) : null;
    layer.classList.toggle('no-target', !target);
    if (my !== token) return;
    if (step.target && !target) return show(i + 1);
    if (target && !target.closest('.topbar, .sidebar')) {
      scrollToTarget();
      await wait(reduced() ? 0 : 350);
    }
    if (my !== token) return;
    title.textContent = step.title;
    text.replaceChildren(
      ...step.text.split(' ').flatMap((word, n) => {
        const w = h('span.tw', word);
        w.style.setProperty('--n', String(n));
        return [w, ' '];
      }),
    );
    count.textContent = `${i + 1} of ${list.length}`;
    // Step 1 hides Back but keeps its space, so Next never moves; one look for the control on every step.
    back.disabled = i === 0;
    back.style.visibility = i === 0 ? 'hidden' : '';
    next.textContent = i === list.length - 1 ? 'Finish' : 'Next';
    // The spotlight only ever moves with transform. A size change fades it out (150ms), resizes, then fades it in.
    const r = target?.getBoundingClientRect(),
      size = r ? `${Math.round(r.width)}x${Math.round(r.height)}` : '';
    const resize = !!shown && !!size && size !== shown;
    if (resize && !reduced()) {
      spot.classList.add('fading');
      await wait(150);
      if (my !== token) return;
    }
    spot.classList.toggle('jump', !shown || resize);
    place();
    // Xo points towards the side its target is on (viewer's left or right) and presents on the last step.
    let mood = step.pose;
    if (i === list.length - 1) mood = 'present';
    else if (target) {
      const t = target.getBoundingClientRect(),
        x = img.getBoundingClientRect();
      mood = t.left + t.width / 2 < x.left + x.width / 2 ? 'pointLeft' : 'pointRight';
    }
    if (mood !== guide.mood) guide.setMood(mood);
    else if (target) guide.replay(); // a new target on the same side: point again
    shown = size;
    void spot.offsetWidth;
    spot.classList.remove('fading', 'jump');
    settling = false;
    bubble.classList.remove('changing');
    next.focus({ preventScroll: true });
  }

  const onKey = (e) => {
    if (e.key === 'Escape') end();
    else if (e.key === 'ArrowRight') show(index + 1);
    else if (e.key === 'ArrowLeft') show(index - 1);
    else if (e.key === 'Tab') {
      const controls = [skip, back, next].filter((button) => !button.disabled);
      const first = controls[0],
        last = controls.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  // Scrolling and resizing follow the target at once; only step changes animate.
  const onMove = () => {
    if (!active || settling) return;
    spot.classList.add('jump');
    place();
    void spot.offsetWidth;
    spot.classList.remove('jump');
  };
  function end() {
    token++;
    removeEventListener('keydown', onKey);
    removeEventListener('resize', onMove);
    removeEventListener('scroll', onMove, true);
    layer.classList.add('out');
    document.body.classList.remove('touring');
    setTimeout(() => layer.remove(), 250);
    if (location.hash !== previousRoute) location.hash = previousRoute || '#/';
    previousFocus?.focus?.({ preventScroll: true });
    // R12: the standalone Tour button is removed once the tour is done (main.js), so focus would fall to <body>.
    // Land on Help, where the tour lives from now on, or on the view's heading on phones.
    setTimeout(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      const help = document.querySelector('[data-help-btn]');
      const to = help?.offsetParent ? help : document.querySelector('#view h1');
      if (to && !help?.offsetParent) to.tabIndex = -1;
      to?.focus({ preventScroll: true });
    }, 0);
    active = null;
    try {
      localStorage.setItem('xaeo-tour-done', '1');
    } catch {
      /* private mode */
    }
  }
  addEventListener('keydown', onKey);
  addEventListener('resize', onMove);
  addEventListener('scroll', onMove, true);
  active = { end };
  show(0);
}
