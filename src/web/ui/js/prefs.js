// Device preferences: one localStorage key, `xaeo-prefs` (JSON), read before the first paint by /prefs.js.
// get(name) / set(name, value) / subscribe(fn). set() writes, mirrors the value onto <html> at once
// (data-density, data-motion, data-theme) and tells subscribers; nothing here touches the server.
// theme is "light", "dark" or "system" (default); <html data-theme> always holds the resolved light|dark, and
// "system" follows live OS changes. Storage that throws (private mode) keeps the choice until reload.
export const DEFAULTS = {
  density: 'comfortable',
  motion: 'system',
  theme: 'system',
  xoOnStart: false,
  xoKey: true,
  sidebar: 'full',
};
const ATTRS = {
  density: 'data-density',
  motion: 'data-motion',
  theme: 'data-theme',
  sidebar: 'data-sidebar',
};
const subs = new Set();
const memory = {};
const dark = matchMedia('(prefers-color-scheme: dark)');

function read() {
  try {
    const v = JSON.parse(localStorage.getItem('xaeo-prefs') || '{}');
    return v && typeof v === 'object' ? { ...v, ...memory } : { ...memory };
  } catch {
    return { ...memory };
  }
}
export const get = (name) => {
  const v = read()[name];
  return v === undefined ? DEFAULTS[name] : v;
};
// The value written to <html>: theme resolves "system" (or anything unknown) through the OS setting.
const attr = (name, value) =>
  name !== 'theme'
    ? String(value)
    : value === 'light' || value === 'dark'
      ? value
      : dark.matches
        ? 'dark'
        : 'light';
const apply = (name) => document.documentElement.setAttribute(ATTRS[name], attr(name, get(name)));

export function set(name, value) {
  const all = read();
  if (value === DEFAULTS[name]) delete all[name];
  else all[name] = value;
  try {
    if (Object.keys(all).length) localStorage.setItem('xaeo-prefs', JSON.stringify(all));
    else localStorage.removeItem('xaeo-prefs');
    delete memory[name];
  } catch {
    memory[name] = value; /* private mode: applies until reload */
  }
  if (ATTRS[name]) apply(name);
  subs.forEach((fn) => fn(name, value));
}
export const subscribe = (fn) => {
  subs.add(fn);
  return () => subs.delete(fn);
};
// Another tab changed the preferences: follow it.
addEventListener('storage', (e) => {
  if (e.key !== 'xaeo-prefs' && e.key !== null) return;
  for (const name of Object.keys(ATTRS)) apply(name);
  subs.forEach((fn) => fn(null));
});
// "System" follows the OS live (e.g. macOS switching to dark at sunset).
// /prefs.js followed the OS until now; hand the job over so one listener runs (it also ignored an in-memory choice).
try {
  window.xaeoThemeLiveOff?.();
} catch {
  /* not loaded */
}
dark.addEventListener('change', () => {
  if (get('theme') === 'system') {
    apply('theme');
    subs.forEach((fn) => fn('theme', 'system'));
  }
});
