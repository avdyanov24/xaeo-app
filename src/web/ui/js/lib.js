// Shared helpers for the agency app. No framework: small DOM builders that never use innerHTML for data.
import { createXo } from './xo.js';

let csrf = '';
export const setCsrf = (token) => {
  csrf = token;
};
// The Xo chat streams with its own fetch (SSE body), so it needs the token api() sends.
export const csrfToken = () => csrf;

export async function api(path, { method = 'GET', data, raw, type } = {}) {
  const headers = {};
  if (method !== 'GET') {
    headers['X-CSRF-Token'] = csrf;
    headers['Content-Type'] = type || 'application/json';
  }
  let response;
  // R2-2: never surface "Failed to fetch" or a server's internal wording. Network and 5xx errors carry plain words
  // and a `kind`, so views can offer "Try again". 4xx messages are written for people (validation), so they stay.
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers,
      body: raw ?? (data ? JSON.stringify(data) : method === 'GET' ? undefined : '{}'),
    });
  } catch {
    throw Object.assign(new Error(navigator.onLine === false ? OFFLINE_TEXT : NETWORK_TEXT), {
      kind: 'network',
    });
  }
  if (response.status === 401) {
    location.assign('/login?next=' + encodeURIComponent(location.pathname + location.hash));
    throw new Error('Sign in required');
  }
  let body;
  try {
    body = (response.headers.get('content-type') || '').includes('json')
      ? await response.json()
      : null;
  } catch {
    body = null;
  }
  // The CSRF token belongs to one sign-in. Signing in again in another tab replaces the cookie, so this tab's token is stale.
  // Nothing was changed; say how to carry on instead of showing the server's "Invalid session token".
  if (response.status === 403 && body?.error === 'Invalid session token')
    throw Object.assign(new Error(SESSION_CHANGED_TEXT), {
      status: 403,
      kind: 'request',
      code: 'session_changed',
    });
  if (!response.ok) {
    const server = response.status >= 500 || !body?.error;
    const retryAfter =
      Math.min(Math.max(parseInt(response.headers.get('retry-after'), 10) || 0, 0), 300) || null;
    // A 503 that names itself (Retry-After: database blinking, server restarting, PDF or capacity busy; or a stable code: "not set up")
    // carries a sentence written for people. Show it, but keep kind 'server': the same request may work in a few seconds, so views offer Try again.
    const told =
      response.status === 503 &&
      (retryAfter || body?.code) &&
      typeof body?.error === 'string' &&
      body.error.length <= 200
        ? body.error
        : null;
    throw Object.assign(new Error(told || (server ? SERVER_TEXT : body.error)), {
      status: response.status,
      kind: server ? 'server' : 'request',
      code: body?.code || null,
      retryAfter,
    });
  }
  return body;
}
// Tells the rest of the app (Xo scan cards, xo-cards.js) that a scan just started for a client.
export const scanStarted = (clientId) =>
  dispatchEvent(new CustomEvent('xaeo:scan-started', { detail: { clientId } }));
const OFFLINE_TEXT = 'You seem to be offline. Check your connection, then try again.';
const SESSION_CHANGED_TEXT =
  'You signed in again in another tab or window, so this page is out of date. Reload it to continue.';
const NETWORK_TEXT = 'We couldn’t reach Xaeo. Check your connection, then try again.';
const SERVER_TEXT = 'Something on our side didn’t work. Your data is safe; try again in a moment.';
// Plain words for any thrown value (also catches errors that did not come from api()).
export function friendlyError(error) {
  if (error?.kind) return error.message;
  const raw = String(error?.message || error || '');
  if (
    !raw ||
    /failed to fetch|networkerror|load failed|internal|unexpected token|undefined|null|\bjson\b/i.test(
      raw,
    )
  )
    return navigator.onLine === false ? OFFLINE_TEXT : SERVER_TEXT;
  return raw;
}
// In-page error with a retry. `what` names the thing ("this client", "the answers"). Retry re-runs the failed load.
export function errorState({ what = 'this page', error, retry, back = true } = {}) {
  const offline = navigator.onLine === false || error?.kind === 'network';
  // R3-5: Xo never smiles at a failure: the approved uneasy clip for errors and offline, curious only for "not found".
  const node = h(
    'div.empty.error-state',
    { role: 'alert' },
    xo(error?.status === 404 ? 'curious' : 'uneasy', 'empty-xo'),
    h('h2', `We couldn’t load ${what}`),
    h(
      'p',
      offline
        ? navigator.onLine === false
          ? OFFLINE_TEXT
          : NETWORK_TEXT
        : error?.status === 404
          ? 'It may have been removed, or the link belongs to another workspace.'
          : SERVER_TEXT,
    ),
    h(
      'div.row.center',
      retry && error?.status !== 404
        ? button(
            'Try again',
            {
              onclick: (e) => {
                busy(e.currentTarget, async () => {
                  await retry();
                });
              },
            },
            'refresh',
          )
        : null,
      back
        ? link('Back to clients', '#/', {
            variant: retry && error?.status !== 404 ? 'secondary' : undefined,
          })
        : null,
    ),
  );
  return node;
}

// h('div.card#id', { onclick, dataset, style, ...attrs }, children)
export function h(tag, props = {}, ...children) {
  if (
    props === null ||
    typeof props !== 'object' ||
    props instanceof Node ||
    Array.isArray(props)
  ) {
    children.unshift(props);
    props = {};
  }
  const [name, ...rest] = tag.split(/(?=[.#])/);
  const el = document.createElement(name || 'div');
  for (const part of rest)
    part[0] === '.' ? el.classList.add(part.slice(1)) : (el.id = part.slice(1));
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'style')
      for (const [k, v] of Object.entries(value))
        k.startsWith('--') ? el.style.setProperty(k, v) : (el.style[k] = v);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'class')
      String(value)
        .split(' ')
        .filter(Boolean)
        .forEach((c) => el.classList.add(c));
    else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in el && typeof value !== 'string') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}
export const clear = (el, ...children) => {
  el.replaceChildren();
  append(el, children);
  return el;
};

// Lucide icons (ISC licence), inlined so the strict CSP needs no extra requests.
const ICONS = {
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  monitor:
    '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  download:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  external:
    '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  refresh:
    '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  archive:
    '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  trash:
    '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  lightbulb:
    '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  ticket:
    '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  trending: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  palette:
    '<circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  calendar:
    '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
  logout:
    '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  sparkles:
    '<path d="M9.94 14.5A2 2 0 0 0 8.5 13.06L2.36 11.5a.5.5 0 0 1 0-.96L8.5 8.94A2 2 0 0 0 9.94 7.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 7.5A2 2 0 0 0 15.5 8.94l6.14 1.58a.5.5 0 0 1 0 .96L15.5 13.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/>',
  pencil:
    '<path d="M21.17 6.81a1 1 0 0 0-3.98-3.98L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/>',
  alert:
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
  trendingDown:
    '<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>',
  minus: '<path d="M5 12h14"/>',
  shield:
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  sliders:
    '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  keyboard:
    '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
  database:
    '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
  menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
  arrowUp: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  arrowDown: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  command: '<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>',
  settings:
    '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  list: '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
  upload:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  stop: '<circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
  code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  panelLeft: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
  chevronsUpDown: '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
  wrench:
    '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  arrowUpRight: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  circleDashed:
    '<path d="M10.1 2.18a9.93 9.93 0 0 1 3.8 0"/><path d="M17.6 3.71a9.95 9.95 0 0 1 2.69 2.7"/><path d="M21.82 10.1a9.93 9.93 0 0 1 0 3.8"/><path d="M20.29 17.6a9.95 9.95 0 0 1-2.7 2.69"/><path d="M13.9 21.82a9.94 9.94 0 0 1-3.8 0"/><path d="M6.4 20.29a9.95 9.95 0 0 1-2.69-2.7"/><path d="M2.18 13.9a9.93 9.93 0 0 1 0-3.8"/><path d="M3.71 6.4a9.95 9.95 0 0 1 2.7-2.69"/>',
  fileCheck:
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m9 15 2 2 4-4"/>',
  inbox:
    '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
};
export function icon(name, size = 18) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return span;
}

// Xo, the animated mascot (ui/js/xo.js). Poses: waving, happy, excited, cheering, curious, thinking.
export const xo = (pose, cls = '') => {
  const x = createXo({ mood: pose });
  if (cls) x.el.classList.add(...cls.split('.'));
  return x.el;
};

// Formatting
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function date(ms, withTime = false) {
  if (!ms) return '-';
  const d = new Date(ms);
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ''}`;
  return withTime
    ? `${base}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    : base;
}
export const dayDate = (ms) => (ms ? `${DAYS[new Date(ms).getDay()]} ${date(ms)}` : '-');
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// Weekly rescans run Monday 09:00 in the workspace time zone, so day and time are read in that zone and the zone is named:
// "Mon 26 Oct, 09:00 Europe/London". Falls back to UTC if the zone is unknown to this browser.
export function zonedParts(ms, timeZone = 'UTC') {
  const fmt = (tz) =>
    Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(new Date(ms))
        .map((x) => [x.type, x.value]),
    );
  let tz = timeZone || 'UTC',
    p;
  try {
    p = fmt(tz);
  } catch {
    tz = 'UTC';
    p = fmt(tz);
  }
  return {
    day: `${p.weekday} ${p.day} ${p.month}`,
    time: `${p.hour}:${p.minute} ${tz.replace(/_/g, ' ')}`,
  };
}
export const zonedRun = (ms, timeZone) => {
  if (!ms) return '-';
  const p = zonedParts(ms, timeZone);
  return `${p.day}, ${p.time}`;
};
// Canonical IANA ids this browser knows, plus UTC (the workspace default).
export function timeZones() {
  let list = [];
  try {
    list = Intl.supportedValuesOf('timeZone');
  } catch {
    /* older browsers: the browser zone and UTC only */
  }
  const own = browserZone();
  return [...new Set(['UTC', ...(own ? [own] : []), ...list])].sort((a, b) =>
    a === 'UTC' ? -1 : b === 'UTC' ? 1 : a.localeCompare(b),
  );
}
export const browserZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
};

// The device setting, or the app's own Settings > Appearance > Reduce motion (prefs.js sets <html data-motion>).
// A+ desktop (>=1024px): sidebar shell and the desktop layouts. Views branch on it at render; main.js re-renders the
// route when it flips, so phones and tablets keep their own markup untouched.
export const desk = matchMedia('(min-width: 1024px)');
export const reducedMotion = () =>
  document.documentElement.dataset.motion === 'reduce' ||
  matchMedia('(prefers-reduced-motion: reduce)').matches;

// Bars grow with transform (scaleX), never width, so they stay smooth.
// Pass `from` to glide from an earlier value instead of growing from zero.
export function meter(fraction, cls = '', from = null) {
  const clamp = (v) => Math.max(0, Math.min(1, Number(v) || 0));
  const f = clamp(fraction);
  const bar = h('span', { style: { transform: `scaleX(${from == null ? f : clamp(from)})` } });
  const el = h(
    `div.meter${cls ? '.' + cls : ''}${from == null ? '' : '.glide'}`,
    { role: 'presentation' },
    bar,
  );
  if (from != null)
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        bar.style.transform = `scaleX(${f})`;
      }),
    );
  return el;
}
export function setMeter(el, fraction) {
  const bar = el?.querySelector('span');
  if (bar) bar.style.transform = `scaleX(${Math.max(0, Math.min(1, fraction))})`;
}

// Put important numbers in the DOM at their actual value from the first frame.
// Numbers in calm data views are static. The one exception (C5 7.4): right after a watched scan finishes, a tile whose
// value changed counts from the old value to the new one. Load, tab switch, polling and reduced motion stay static.
export function countUp(el, to, { format = String, from = null, delay = 0 } = {}) {
  to = Number(to) || 0;
  // Keep the actual value visible even when a browser pauses animation frames.
  el.textContent = format(to);
  if (from == null || Number(from) === to || reducedMotion()) return el;
  el.textContent = format(Number(from) || 0);
  setTimeout(() => rollNumber(el, from, to), delay);
  return el;
}

// The headline numeral roll: 600ms on --ease-out, tabular width reserved so nothing beside it shifts, the final
// value forced after 700ms even if animation frames pause; reduced motion shows the final value at once.
export const easeOut = (t) => {
  // cubic-bezier(.22,1,.36,1), solved for x by Newton steps
  let x = t;
  for (let i = 0; i < 5; i++) {
    const cx = 3 * 0.22 * x * (1 - x) ** 2 + 3 * 0.36 * x * x * (1 - x) + x ** 3 - t;
    const dx = 3 * 0.22 * (1 - x) ** 2 + 6 * (0.36 - 0.22) * x * (1 - x) + 3 * (1 - 0.36) * x * x;
    if (Math.abs(dx) < 1e-6) break;
    x -= cx / dx;
  }
  x = Math.max(0, Math.min(1, x));
  return 3 * 1 * x * (1 - x) ** 2 + 3 * 1 * x * x * (1 - x) + x ** 3;
};
export function rollNumber(el, from, to) {
  from = Number(from) || 0;
  to = Number(to) || 0;
  const id = (el._roll = (el._roll || 0) + 1); // a newer roll on the same numeral wins
  if (from === to || reducedMotion()) {
    el.textContent = String(to);
    return;
  }
  el.style.minWidth = `${Math.max(String(from).length, String(to).length)}ch`;
  el.textContent = String(from);
  const start = performance.now(),
    D = 600;
  const done = () => {
    if (el._roll === id) el.textContent = String(to);
  };
  const safety = setTimeout(done, D + 100);
  const frame = (now) => {
    if (el._roll !== id) return clearTimeout(safety);
    const t = Math.min(1, (now - start) / D);
    el.textContent = String(Math.round(from + (to - from) * easeOut(t)));
    if (t < 1) requestAnimationFrame(frame);
    else {
      clearTimeout(safety);
      done();
    }
  };
  requestAnimationFrame(frame);
}

// One shared tooltip, fixed to the viewport so it never widens the page. Used by help tips and label badges.
let tipEl = null;
export function showTip(anchor, text) {
  if (!tipEl) {
    tipEl = h('div.tooltip', { role: 'tooltip', id: 'xaeo-tip' });
    document.body.append(tipEl);
  }
  tipEl.textContent = text;
  tipEl.classList.add('on');
  const r = anchor.getBoundingClientRect(),
    w = Math.min(280, innerWidth - 24);
  tipEl.style.width = `${w}px`;
  const left = Math.max(12, Math.min(innerWidth - w - 12, r.left + r.width / 2 - w / 2));
  const above = r.top > tipEl.offsetHeight + 20;
  tipEl.style.transform = `translate(${Math.round(left)}px, ${Math.round(above ? r.top - tipEl.offsetHeight - 10 : r.bottom + 10)}px)`;
}
export const hideTip = () => tipEl?.classList.remove('on');
export const tipShown = () => !!tipEl?.classList.contains('on');
addEventListener('scroll', hideTip, { passive: true, capture: true });
export function withTip(el, text) {
  el.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'mouse') showTip(el, text);
  });
  el.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') hideTip();
  });
  el.addEventListener('focus', () => showTip(el, text));
  el.addEventListener('blur', hideTip);
  return el;
}

// Pills for fixed labels. Hits get a fill and an icon; "Not named" is quiet text with a hollow ring.
const PILL = {
  Cited: ['cited', 'link'],
  Mentioned: ['mentioned', 'check'],
  'Not mentioned': ['missed'],
  Failed: ['failed', 'alert'],
  Cancelled: ['off', 'stop'],
  'Not connected': ['off'],
  'No result': ['off'],
};
// F1-11: the server's labels read in the Answers tab's words everywhere (Named + linked, Named, Not named).
export const LABEL_SHOWN = {
  Cited: 'Named + linked',
  Mentioned: 'Named',
  'Not mentioned': 'Not named',
};
export function labelPill(label) {
  const [tone, glyph] = PILL[label] || ['missed'];
  return h(`span.pill.pill-${tone}`, glyph ? icon(glyph, 12) : null, LABEL_SHOWN[label] || label);
}
// Fix badges: impact is white with a 3-bar signal, evidence is tinted by strength. Both always carry their text.
export function badge(kind, value, definitions) {
  const text = kind === 'impact' ? `${value} impact` : `${value} evidence`;
  const bars =
    kind === 'impact'
      ? h(
          `span.signal.signal-${{ High: 3, Medium: 2, Low: 1 }[value] || 1}`,
          { 'aria-hidden': 'true' },
          h('i'),
          h('i'),
          h('i'),
        )
      : null;
  const tone = kind === 'impact' ? 'impact' : String(value).toLowerCase();
  const el = h(
    `span.badge.badge-${tone}`,
    {
      tabindex: definitions?.[value] ? '0' : null,
      'aria-label': definitions?.[value] ? `${text}: ${definitions[value]}` : null,
    },
    bars,
    text,
  );
  return definitions?.[value] ? withTip(el, `${text}: ${definitions[value]}`) : el;
}

// Toasts: at most 3, newest at the bottom, a bar shows the time left, hover pauses it.
// R2-1: confirmations are short (3s); errors stay 6s; a toast with an action (Undo, Try again) stays 8s.
const TOAST_MS = { info: 3000, error: 6000 };
// R2-1: the stack sits above the bottom nav (--bn-h) AND any pinned action bar (open fix, wizard footer), so it never
// covers the next "Mark done". --toast-lift is measured here; app.css adds it to the stack offset.
const PINNED = '.fix.open .fix-actions, .wizard-pane .form-actions';
export function liftToasts() {
  const host = document.querySelector('.toasts');
  if (!host) return;
  // N1: lift to the bar's real top, not its height. Near the page end the bar is no longer stuck and sits higher than
  // its pinned spot, so a height-based lift left the toast over "Mark done" (768). Toast bottom = bar top - 12px.
  const base = parseFloat(getComputedStyle(host).bottom) || 0;
  let lift = 0;
  for (const bar of document.querySelectorAll(PINNED)) {
    if (!bar.offsetParent || getComputedStyle(bar).position !== 'sticky') continue;
    const r = bar.getBoundingClientRect();
    if (r.bottom > innerHeight * 0.5 && r.top < innerHeight)
      lift = Math.max(lift, Math.ceil(innerHeight - r.top + 12 - base));
  }
  lift = Math.min(Math.max(0, lift), Math.round(innerHeight * 0.6));
  host.style.setProperty('--toast-lift', `${lift}px`);
}
let liftBound = false;
// `mark`: a neutral icon instead of the green check, for outcomes that are done but not good news (a rejected draft).
// R13: the live region exists before the first toast. Created in the same task as its first message, screen readers
// (VoiceOver, NVDA) often skipped that message because the region was not registered yet.
const toastHost = () =>
  document.querySelector('.toasts') ||
  document.body.appendChild(h('div.toasts', { role: 'status', 'aria-live': 'polite' }));
if (document.body?.classList.contains('app-body')) toastHost();
export function toast(message, { tone = 'info', pose, action = null, mark = null } = {}) {
  const host = toastHost();
  if (!liftBound) {
    liftBound = true;
    let raf = 0;
    const queue = () => {
      if (!raf && host.childElementCount)
        raf = requestAnimationFrame(() => {
          raf = 0;
          liftToasts();
        });
    };
    addEventListener('scroll', queue, { passive: true });
    addEventListener('resize', queue);
  }
  // Measure now and again after the next fix has opened (its 240-420ms expand), so the lift follows the bar.
  // D7: an empty stack takes its lift with no transition, before the toast is inserted, so the first painted frame
  // already sits above the bar (it used to glide up from 0 over the bar for ~15 frames). Later moves still glide.
  if (!host.childElementCount) {
    host.style.transition = 'none';
    liftToasts();
    void getComputedStyle(host).transform;
    host.style.transition = '';
  } else liftToasts();
  setTimeout(liftToasts, 260);
  setTimeout(liftToasts, 640);
  const same = [...host.children].find((n) => n.dataset.message === message);
  const dismiss = (node) => {
    clearTimeout(node._timer);
    node.classList.add('out');
    setTimeout(() => node.remove(), 260);
  };
  const ms = action ? 8000 : TOAST_MS[tone] || TOAST_MS.info;
  const node =
    same ||
    h(
      `div.toast.toast-${tone}`,
      { dataset: { message } },
      pose
        ? xo(pose, 'toast-xo')
        : h(
            'span.toast-icon',
            { class: mark ? 'toast-icon-neutral' : '' },
            icon(tone === 'error' ? 'alert' : mark || 'check', 16),
          ),
      h('span.toast-text', message),
      action
        ? h(
            'button.toast-action',
            {
              type: 'button',
              onclick: (e) => {
                dismiss(e.currentTarget.closest('.toast'));
                action.onClick();
              },
            },
            action.label,
          )
        : null,
      h(
        'button.toast-close',
        {
          type: 'button',
          'aria-label': 'Dismiss',
          onclick: (e) => dismiss(e.currentTarget.closest('.toast')),
        },
        icon('x', 16),
      ),
      h('span.toast-timer'),
    );
  if (!same) {
    // R9: one message per tone. A new toast retires the older ones of its tone (they leave with their exit), so
    // "Saved" + "Approved" never stack into a wall of bars; only toasts with an action (such as "Try again") wait for their own timer.
    for (const old of host.children)
      if (
        old !== node &&
        !old.classList.contains('out') &&
        old.classList.contains(`toast-${tone}`) &&
        !old.querySelector('.toast-action')
      )
        dismiss(old);
    host.append(node);
  }
  while (host.children.length > 3) host.firstElementChild.remove();
  const arm = () => {
    clearTimeout(node._timer);
    node._timer = setTimeout(() => dismiss(node), ms);
  };
  const timer = node.querySelector('.toast-timer');
  timer.style.animationDuration = `${ms}ms`;
  timer.classList.remove('run');
  void timer.offsetWidth;
  timer.classList.add('run');
  if (!same) {
    // Mouse only: on touch the timer keeps running (a tap must not pause the toast forever).
    node.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse') return;
      clearTimeout(node._timer);
      timer.classList.add('paused');
    });
    node.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse') return;
      timer.classList.remove('paused', 'run');
      void timer.offsetWidth;
      timer.classList.add('run');
      arm();
    });
  }
  arm();
}
// Plain words only (friendlyError). Pass `retry` to offer "Try again" that re-runs the failed request.
export const errorToast = (error, { retry } = {}) =>
  toast(friendlyError(error), {
    tone: 'error',
    action: retry ? { label: 'Try again', onClick: retry } : null,
  });

export async function copyText(text, message = 'Copied', btn = null) {
  const done = () => {
    toast(message);
    if (btn) {
      btn.classList.add('copied');
      setTimeout(() => btn.classList.remove('copied'), 1600);
    }
  };
  try {
    await navigator.clipboard.writeText(text);
    done();
  } catch {
    const area = h('textarea', { value: text });
    document.body.append(area);
    area.select();
    try {
      document.execCommand('copy');
      done();
    } catch {
      toast('Copy failed. Select the text and copy it yourself.', { tone: 'error' });
    }
    area.remove();
  }
}

// Side drawer. Esc or the backdrop closes it; Tab stays inside while it's open.
// `returnFocus()` names where focus goes on close when the opener may have been re-rendered meanwhile.
export function drawer(title, content, { head = null, returnFocus = null } = {}) {
  document.querySelector('.drawer-wrap')?.remove();
  const previous = document.activeElement;
  const close = () => {
    wrap.classList.add('out');
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('drawer-open');
    setTimeout(() => wrap.remove(), 160);
    (previous?.isConnected ? previous : returnFocus?.())?.focus?.({ preventScroll: true });
  };
  const onKey = (e) => {
    if (e.key === 'Escape') return close();
    if (e.key !== 'Tab') return;
    const items = [
      ...panel.querySelectorAll('button, a[href], input, select, textarea, [tabindex="0"]'),
    ].filter((n) => !n.disabled && n.offsetParent);
    if (!items.length) return;
    if (e.shiftKey && document.activeElement === items[0]) {
      e.preventDefault();
      items.at(-1).focus();
    } else if (!e.shiftKey && document.activeElement === items.at(-1)) {
      e.preventDefault();
      items[0].focus();
    }
  };
  const closeBtn = h(
    'button.icon-btn',
    { type: 'button', 'aria-label': 'Close', onclick: close },
    icon('x'),
  );
  const titleEl = h('h2', title);
  const panel = h(
    'aside.drawer',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div.drawer-head', titleEl, h('div.drawer-tools', head, closeBtn)),
    h('div.drawer-body', content),
  );
  const wrap = h('div.drawer-wrap', h('div.drawer-backdrop', { onclick: close }), panel);
  document.body.append(wrap);
  document.body.classList.add('drawer-open');
  document.addEventListener('keydown', onKey);
  closeBtn.focus();
  return {
    close,
    panel,
    body: panel.querySelector('.drawer-body'),
    setTitle: (t) => {
      titleEl.textContent = t;
      panel.setAttribute('aria-label', t);
    },
  };
}

// Render **bold** from answer text safely, highlighting the client name.
export function answerText(text, clientName) {
  const out = h('div.answer-text');
  for (const raw of String(text || '').split('\n')) {
    // Real engines write markdown links; show the link text only (sources are listed separately).
    const line = raw.replace(/^\* /, '• ').replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '$1');
    const p = h('p');
    String(line)
      .split(/(\*\*.+?\*\*)/g)
      .forEach((part) => {
        if (!part) return;
        if (part.startsWith('**') && part.endsWith('**')) {
          const name = part.slice(2, -2);
          p.append(
            h(
              name.toLowerCase().includes(String(clientName).toLowerCase()) ? 'mark' : 'strong',
              name,
            ),
          );
        } else p.append(part);
      });
    out.append(p);
  }
  return out;
}

// A+ desktop reading pane: the same answer view as the drawer, inline beside the Answers matrix (not a dialog, so no
// focus trap). Returns the drawer-shaped handle openAnswer uses.
function answerPane(into, nav) {
  into._off?.();
  const titleEl = h('h2.pane-title', 'Answer');
  const body = h('div.drawer-body.pane-body');
  clear(into, h('div.pane-head', titleEl, nav), body);
  return {
    panel: into,
    body,
    setTitle: (t) => {
      titleEl.textContent = t;
    },
  };
}

// Answer detail. Pass the ids of the answers around it (a grid row, a fix's evidence) to step through them with ← and →.
// `into` (A+ desktop Answers): render in that inline pane instead of the drawer; arrows step while focus is in `scope`.
// `onShow(index, id)` tells the caller which answer is on show (the matrix marks its cell).
export async function openAnswer(id, list = [], { into = null, scope = null, onShow = null } = {}) {
  let index = Math.max(0, list.indexOf(id));
  const ids = list.length ? list : [id];
  const counter = h('span.drawer-count');
  const prev = h(
    'button.icon-btn',
    { type: 'button', 'aria-label': 'Previous answer', onclick: () => go(index - 1) },
    icon('chevronLeft'),
  );
  const next = h(
    'button.icon-btn',
    { type: 'button', 'aria-label': 'Next answer', onclick: () => go(index + 1) },
    icon('chevronRight'),
  );
  const nav = ids.length > 1 ? h('div.drawer-nav', prev, counter, next) : null;
  const d = into
    ? answerPane(into, nav)
    : drawer('Answer', h('p.muted', 'Loading answer…'), { head: nav });
  const onArrow = (e) => {
    if (!d.panel.isConnected) return document.removeEventListener('keydown', onArrow);
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    if (into && !(scope || into).contains(document.activeElement)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowLeft') {
      if (into) e.preventDefault();
      go(index - 1);
    } else if (e.key === 'ArrowRight') {
      if (into) e.preventDefault();
      go(index + 1);
    }
  };
  if (nav) document.addEventListener('keydown', onArrow);
  if (into) into._off = () => document.removeEventListener('keydown', onArrow);
  let token = 0,
    opened = false;
  async function go(i) {
    if (i < 0 || i >= ids.length) return;
    index = i;
    onShow?.(i, ids[i]);
    const my = ++token;
    if (nav) {
      counter.textContent = `${i + 1} of ${ids.length}`;
      prev.disabled = i === 0;
      next.disabled = i === ids.length - 1;
    }
    // Dim only when the answer is slow (over 160ms); a fast answer swaps with no dim flash.
    const dim = setTimeout(() => d.body.classList.add('loading-soft'), 160);
    try {
      const a = await api(`/api/app/answers/${ids[i]}`);
      if (my !== token) return;
      d.body.classList.toggle('nav', opened);
      opened = true;
      d.setTitle(`${a.engine} answer`);
      clear(
        d.body,
        h(
          'div.answer-meta',
          h('span.engine-tag', a.engine),
          labelPill(a.label),
          a.position ? h('span.muted', `Listed #${a.position}`) : null,
          a.mode === 'sample' && a.status === 'ok' ? h('span.muted.small', 'Sample answer') : null,
        ),
        h('p.answer-question', `“${a.question}”`),
        a.status === 'failed'
          ? h(
              'p.answer-state',
              icon('alert', 16),
              h(
                'span',
                a.error || `${a.engine} didn’t answer this time.`,
                ' Retry from the overview.',
              ),
            )
          : a.status === 'skipped'
            ? h(
                'p.answer-state',
                icon('info', 16),
                h(
                  'span',
                  a.error || `${a.engine} isn’t connected.`,
                  ' ',
                  h('a', { href: '#/engines' }, 'See engines'),
                ),
              )
            : answerText(a.text, a.clientName),
        // One plain sentence up front; versions and character offsets stay available under "Details".
        a.extraction?.entities?.length
          ? h(
              'div.drawer-section',
              h('h3', 'How we read this answer'),
              h(
                'p.muted.small',
                'We matched these names in the answer text with fixed rules. A person has not reviewed this answer yet.',
              ),
              h(
                'ul',
                a.extraction.entities.map((entity) =>
                  h('li', h('strong', entity.quote), ` - ${entity.classification}`),
                ),
              ),
              h(
                'details.drawer-details',
                h('summary', 'Details'),
                h(
                  'p.muted.small',
                  a.extraction.validation ||
                    'Current rule-based interpretation; human review is pending. Historical report snapshots stay unchanged.',
                ),
                h(
                  'ul.muted.small',
                  a.extraction.entities.map((entity) =>
                    h('li', `“${entity.quote}”: characters ${entity.start}–${entity.end}`),
                  ),
                ),
              ),
            )
          : null,
        a.competitors.length
          ? h(
              'div.drawer-section',
              h('h3', 'Recommended instead'),
              h(
                'div.chips',
                a.competitors.map((c) => h('span.chip', c)),
              ),
            )
          : null,
        a.citations.length
          ? h(
              'div.drawer-section',
              h('h3', `Sources cited (${a.citations.length})`),
              h(
                'ul.source-list',
                a.citations.map((c) =>
                  h(
                    'li',
                    /^https?:\/\//i.test(c.url)
                      ? h(
                          'a.source-link',
                          { href: c.url, target: '_blank', rel: 'noopener noreferrer' },
                          h('span.source-domain', c.domain),
                          h(
                            'span.source-title',
                            c.title && c.title !== c.domain ? c.title : 'Source',
                          ),
                          icon('external', 14),
                        )
                      : h('span', c.domain),
                  ),
                ),
              ),
            )
          : null,
        a.method
          ? h(
              'p.method-note',
              `Collected on ${date(a.collectedAt, true)}${a.model ? ` (${a.model})` : ''}. ${a.method}`,
            )
          : null,
      );
      d.body.scrollTop = 0;
    } catch (error) {
      if (my === token)
        clear(
          d.body,
          h(
            'div.drawer-error',
            { role: 'alert' },
            h('p', `We couldn’t load this answer. ${friendlyError(error)}`),
            button('Try again', { onclick: () => go(index) }, 'refresh'),
          ),
        );
    } finally {
      clearTimeout(dim);
      if (my === token) d.body.classList.remove('loading-soft');
    }
  }
  go(index);
}

// Light syntax colouring for fix code (HTML, JSON-LD, markdown). Builds spans; never parses HTML.
export function highlight(code, lang) {
  const frag = document.createDocumentFragment();
  const add = (text, cls) => {
    if (!text) return;
    frag.append(cls ? h(`span.tok-${cls}`, text) : document.createTextNode(text));
  };
  if (lang === 'markdown' || lang === 'text') {
    String(code)
      .split('\n')
      .forEach((line, i, all) => {
        const m =
          line.match(/^(#{1,6} )(.*)$/) ||
          line.match(/^(\s*[-*] |\s*\d+\. )(.*)$/) ||
          line.match(/^(\|)(.*)$/);
        if (m && m[1].startsWith('#')) {
          add(m[1], 'punct');
          add(m[2], 'head');
        } else if (m) {
          add(m[1], 'punct');
          line = m[2];
          String(line)
            .split(/(\[[^\]]*\])/g)
            .forEach((part) => add(part, part.startsWith('[') ? 'hole' : ''));
        } else
          String(line)
            .split(/(\[[^\]]*\])/g)
            .forEach((part) => add(part, part.startsWith('[') ? 'hole' : ''));
        if (i < all.length - 1) add('\n');
      });
    return frag;
  }
  const re =
    /(<\/?[a-zA-Z][\w-]*)|(\s[a-zA-Z-:]+)(?==)|("(?:[^"\\]|\\.)*")(\s*:)?|(\[[^\]\n]*\])|(\/?>)/g;
  let last = 0,
    m;
  const src = String(code);
  while ((m = re.exec(src))) {
    add(src.slice(last, m.index));
    if (m[1]) add(m[1], 'tag');
    else if (m[2]) add(m[2], 'attr');
    else if (m[3]) {
      add(m[3], m[4] ? 'key' : 'str');
      if (m[4]) add(m[4], 'punct');
    } else if (m[5]) add(m[5], 'hole');
    else if (m[6]) add(m[6], 'tag');
    last = re.lastIndex;
  }
  add(src.slice(last));
  return frag;
}

// Confetti for the one big celebration (all fixes done). Skipped with reduced motion.
export function confetti() {
  if (reducedMotion()) return;
  const canvas = h('canvas.confetti');
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  canvas.width = innerWidth;
  canvas.height = innerHeight;
  const css = getComputedStyle(document.documentElement); // theme tokens, so the bits read on light and dark
  const colors = ['--accent-fg', '--on-panel-muted', '--green', '--sun', '--ink'].map((t) =>
    css.getPropertyValue(t).trim(),
  );
  const bits = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2,
    y: innerHeight / 3,
    vx: (Math.random() - 0.5) * 14,
    vy: Math.random() * -12 - 4,
    r: Math.random() * Math.PI,
    s: 6 + Math.random() * 6,
    c: colors[Math.floor(Math.random() * colors.length)],
  }));
  const start = performance.now();
  const frame = (now) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const b of bits) {
      b.vy += 0.35;
      b.x += b.vx;
      b.y += b.vy;
      b.r += 0.15;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.r);
      ctx.fillStyle = b.c;
      ctx.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2);
      ctx.restore();
    }
    if (now - start < 2600) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

export function emptyState({ pose = 'curious', title, text, actions = [] }) {
  return h(
    'div.empty',
    xo(pose, 'empty-xo'),
    h('h2', title),
    text ? h('p', text) : null,
    actions.length ? h('div.row.center', actions) : null,
  );
}
export const button = (label, props = {}, iconName) =>
  h(
    `button.btn${props.variant ? '.btn-' + props.variant : ''}${props.size ? '.btn-' + props.size : ''}`,
    { type: 'button', ...props, variant: undefined, size: undefined },
    iconName ? icon(iconName) : null,
    h('span', label),
  );
export const link = (label, href, props = {}, iconName) =>
  h(
    `a.btn${props.variant ? '.btn-' + props.variant : ''}${props.size ? '.btn-' + props.size : ''}`,
    { href, ...props, variant: undefined, size: undefined },
    iconName ? icon(iconName) : null,
    h('span', label),
  );

// Segmented filters scroll sideways on narrow screens: keep the active option in view and fade only the clipped edge.
export function segScroll(g) {
  const fade = () => {
    const rest = g.scrollWidth - g.clientWidth - g.scrollLeft;
    g.classList.toggle('fade-start', g.scrollLeft > 1);
    g.classList.toggle('fade-end', rest > 1);
  };
  const show = (b) => {
    if (b && g.scrollWidth > g.clientWidth)
      g.scrollLeft = b.offsetLeft - (g.clientWidth - b.offsetWidth) / 2;
    fade();
  };
  g.addEventListener('scroll', fade, { passive: true });
  g.addEventListener('click', (e) => show(e.target.closest('.seg')));
  const ro = new ResizeObserver(() =>
    g.isConnected ? show(g.querySelector('[aria-pressed="true"]')) : ro.disconnect(),
  );
  ro.observe(g);
  return g;
}

// Wide tables scroll sideways: a flat 3px edge marks the side with more columns, and a one-line hint shows only while it overflows.
export function edgeScroll(scroller, frame, hint) {
  const fade = () => {
    const over = scroller.scrollWidth > scroller.clientWidth + 1,
      rest = scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft;
    frame.classList.toggle('fade-start', over && scroller.scrollLeft > 1);
    frame.classList.toggle('fade-end', over && rest > 1);
    if (hint) hint.hidden = !over;
  };
  scroller.addEventListener('scroll', fade, { passive: true });
  const ro = new ResizeObserver(() => (scroller.isConnected ? fade() : ro.disconnect()));
  ro.observe(scroller);
  return frame;
}

// The one-field "add a question" forms: an inline reason when nothing was added, cleared on the next keystroke.
export function addFieldError(input, id = 'q-add-error') {
  const text = h('span'),
    el = h('p.field-error', { id, role: 'alert', hidden: true }, icon('alert', 16), text);
  const hide = () => {
    el.hidden = true;
    input.removeAttribute('aria-invalid');
  };
  input.addEventListener('input', hide);
  return {
    el,
    hide,
    check() {
      const n = input.value.trim().length;
      if (n >= 3) {
        hide();
        return true;
      }
      text.textContent = n ? 'Write at least 3 characters.' : 'Type a question first.';
      el.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', id);
      input.focus({ preventScroll: true });
      return false;
    },
  };
}

// Busy state for buttons during requests.
// A one-line textarea that grows to fit its text (C4). CSS field-sizing does it where supported; this is the fallback,
// re-measured on input and once after the element is laid out.
export function growText(t) {
  const fit = () => {
    if (!t.isConnected) return;
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight + 4}px`;
  };
  if (!CSS.supports?.('field-sizing', 'content')) {
    if (t.isConnected) fit();
    else requestAnimationFrame(() => requestAnimationFrame(fit));
  }
  return t;
}

export async function busy(btn, fn) {
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
}
