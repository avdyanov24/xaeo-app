// Report toolbar actions (screen only). Previewing a report is free. Every way the report leaves the app (the print
// button, Cmd/Ctrl+P) first passes one review step: the checklist and the attestation. The first confirmed print saves
// the report, so the saved copy carries who reviewed it and when. The browser print dialog makes the PDF (print CSS in
// report.css), so there is no server-side PDF route.
const $ = (selector) => document.querySelector(selector);
const button = $('[data-pdf]');
const status = $('[data-pdf-status]');
const say = (text) => {
  if (status) status.textContent = text;
};
const params = new URLSearchParams(location.hash.slice(1));
const ID = /^[\w-]{36}$/;
// What report.js loaded: a saved report (report=<id>) or a live preview (client=<id>&type=...), saved on first print.
let reportId = ID.test(params.get('report') || '') ? params.get('report') : null;
let loaded = null;
document.addEventListener('report:loaded', (e) => {
  loaded = e.detail;
});

const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key in node && typeof value !== 'string') node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.flat().filter((c) => c !== null && c !== undefined));
  return node;
};
const flag = (name) => ($(`[data-opt="${name}"]`)?.checked ? '1' : '0');
// Icon from path data, built node by node (no innerHTML, so page data never reaches an HTML sink).
const SVG = (paths) => {
  const NS = 'http://www.w3.org/2000/svg',
    s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    s.append(p);
  }
  return s;
};

// Toolbar option labels say what they add; the linked-counts hint says what the number is and is not.
function labelOptions() {
  const answers = $('[data-opt="answers"]')?.closest('label'),
    estimates = $('[data-opt="estimates"]')?.closest('label');
  if (answers)
    answers.replaceChildren(answers.querySelector('input'), el('span', {}, 'Include full answers'));
  if (estimates) {
    const hint = el(
      'span',
      { class: 'tb-hint', id: 'estimates-hint' },
      'How many missed answers each fix links to. Not a forecast.',
    );
    estimates.querySelector('input').setAttribute('aria-describedby', hint.id);
    estimates.classList.add('tb-opt-hinted');
    estimates.replaceChildren(
      estimates.querySelector('input'),
      el('span', { class: 'tb-opt-text' }, el('span', {}, 'Include linked answer counts'), hint),
    );
  }
}

// ---- Review step ------------------------------------------------------------------------------------------------
// One native modal dialog (focus stays inside, Esc cancels). Resolves true only when the box is ticked and the user
// confirms; Cancel, Esc and a click on the backdrop resolve false and nothing is sent or saved.
const ACTIONS = {
  print: { title: 'Review before you print', go: 'Print' },
};
let dialog = null,
  settle = null;
function buildDialog() {
  const box = el('input', { type: 'checkbox', id: 'review-attest' });
  const error = el('p', { class: 'rd-error', id: 'review-error', role: 'alert' });
  const go = el('button', {
    type: 'button',
    class: 'tb-btn rd-go',
    'aria-describedby': 'review-error',
  });
  const cancel = el('button', { type: 'button', class: 'tb-btn tb-btn-secondary' }, 'Cancel');
  const links = el('div', { class: 'rd-links' });
  dialog = el(
    'dialog',
    {
      class: 'review-dialog',
      'aria-labelledby': 'review-title',
      'aria-describedby': 'review-text',
    },
    el('p', { class: 'rd-eyebrow' }, 'Before you share'),
    el('h2', { id: 'review-title' }),
    el(
      'p',
      { id: 'review-text', class: 'rd-text' },
      'Check the current answer excerpts, the suggested fixes, and your agency details. The client sees them exactly as in this preview.',
    ),
    links,
    el(
      'label',
      { class: 'rd-check', for: 'review-attest' },
      box,
      el('span', {}, 'I reviewed the current findings and agency details for this report.'),
    ),
    error,
    el('div', { class: 'rd-actions' }, cancel, go),
  );
  document.body.append(dialog);
  const close = (ok) => {
    if (!dialog.open || dialog.classList.contains('rd-closing')) return;
    const done = () => {
      dialog.classList.remove('rd-closing');
      dialog.close();
      settle?.(ok);
      settle = null;
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return done();
    dialog.classList.add('rd-closing');
    dialog.addEventListener('animationend', done, { once: true });
    setTimeout(() => {
      if (dialog.classList.contains('rd-closing')) done();
    }, 260);
  };
  // F1-8: the confirm button is a real, enabled button (it explains itself on click), so it never looks disabled.
  box.addEventListener('change', () => {
    if (box.checked) error.textContent = '';
  });
  go.addEventListener('click', () => {
    if (box.checked) return close(true);
    error.textContent = 'Tick the box to confirm you reviewed this report.';
    box.focus();
  });
  cancel.addEventListener('click', () => close(false));
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close(false);
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close(false);
  });
  return { box, error, go, links };
}
let parts = null;
function confirmReview(action) {
  if (settle) return Promise.resolve(false);
  parts ||= buildDialog();
  const { box, error, go, links } = parts,
    a = ACTIONS[action];
  dialog.querySelector('#review-title').textContent = a.title;
  go.textContent = a.go;
  box.checked = false;
  error.textContent = '';
  // Review links open the app in a new tab, so this preview and its options stay as they are.
  const client = loaded?.clientId;
  const arrow = ['M7 7h10v10', 'M7 17 17 7'];
  links.replaceChildren(
    ...[
      client && ['Review answers', `/app#/clients/${client}/answers`],
      client && ['Review fixes', `/app#/clients/${client}/fixes`],
      ['Review brand', '/app#/settings/workspace'],
    ]
      .filter(Boolean)
      .map(([label, href]) =>
        el('a', { class: 'rd-link', href, target: '_blank', rel: 'noopener' }, label, SVG(arrow)),
      ),
  );
  const opener = document.activeElement;
  dialog.showModal();
  box.focus();
  return new Promise((resolve) => {
    settle = (ok) => {
      if (opener?.isConnected) opener.focus();
      resolve(ok);
    };
  });
}

// A live preview becomes a saved report on its first confirmed print; later prints reuse it. The server checks the
// review flag and that the reviewed scan is still the latest one.
async function savedId() {
  if (reportId) return reportId;
  if (!loaded?.clientId || !loaded.scanId)
    throw new Error("This preview can't be saved. Open it again from the client's Reports tab.");
  const response = await fetch(`/api/app/clients/${loaded.clientId}/reports`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: loaded.type,
      answers: flag('answers') === '1',
      estimates: flag('estimates') === '1',
      reviewed: true,
      reviewedScanId: loaded.scanId,
    }),
  });
  if (response.status === 401) {
    location.assign('/login?next=' + encodeURIComponent(location.pathname + location.hash));
    throw new Error('Signed out.');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      response.status === 409
        ? 'The latest scan changed since this preview opened. Reload the page to see it, then review again.'
        : body?.error || "The report couldn't be saved. Try again.",
    );
  reportId = body.id;
  // Same address as a saved report, so a reload shows this copy. replaceState fires no hashchange (no reload).
  history.replaceState(history.state, '', `/report#${new URLSearchParams({ report: reportId })}`);
  return reportId;
}

// ---- Print gate -------------------------------------------------------------------------------------------------
// Printing from the browser menu can't be stopped, so until a print is confirmed the printed page shows a short note
// instead of the report (report-actions.css). Cmd/Ctrl+P opens the review step first.
document.body.classList.add('review-pending');
document.body.append(
  el(
    'div',
    { class: 'print-gate' },
    el('h1', {}, 'Review this report before printing'),
    el(
      'p',
      {},
      'Go back to the preview and press Cmd+P (Ctrl+P on Windows) or the print button. You confirm your review there first.',
    ),
  ),
);
let printing = false;
function printConfirmed() {
  printing = true;
  document.body.classList.remove('review-pending');
  print();
}
addEventListener('afterprint', () => {
  const ours = printing;
  printing = false;
  document.body.classList.add('review-pending');
  // A print from the browser menu printed the note: offer the review step right away.
  if (!ours && !document.body.classList.contains('report-failed') && loaded) startPrint();
});
async function startPrint() {
  if (!(await confirmReview('print'))) return;
  try {
    await savedId();
  } catch (err) {
    say(err.message);
    return;
  }
  say('');
  printConfirmed();
}
addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() !== 'p' || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
  e.preventDefault();
  if (!document.body.classList.contains('report-failed') && loaded) startPrint();
});

// A link with neither a saved report nor a client can't load a report: hide the action (report.js shows why).
if (button) {
  labelOptions();
  const live = ID.test(params.get('client') || '');
  if (!reportId && !live) {
    button.hidden = true;
    if (status) status.hidden = true;
  } else {
    // Nothing to print until the report is on screen: the button stays disabled while it loads, and a failed load hides
    // it (report.css .report-failed).
    button.disabled = true;
    document.addEventListener(
      'report:loaded',
      () => {
        button.disabled = false;
      },
      { once: true },
    );
    button.addEventListener('click', startPrint);
  }
}
