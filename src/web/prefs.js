// Device preferences, applied before the first paint: the app and account pages load this blocking in <head>,
// ahead of the stylesheets. One localStorage key, `xaeo-prefs` (JSON); ui/js/prefs.js writes it and keeps <html> in
// sync afterwards. Sets data-density (comfortable|compact), data-motion (system|reduce) and data-theme (light|dark;
// the saved "system" or no choice resolves through the OS setting). Storage errors fall back to the defaults.
(function () {
  var p,
    d = document.documentElement,
    t;
  try {
    p = JSON.parse(localStorage.getItem('xaeo-prefs') || '{}') || {};
  } catch {
    p = {};
  }
  d.setAttribute('data-density', p.density === 'compact' ? 'compact' : 'comfortable');
  d.setAttribute('data-motion', p.motion === 'reduce' ? 'reduce' : 'system');
  // A+ desktop sidebar: full or the icon rail, known before the first paint so the shell never jumps.
  d.setAttribute('data-sidebar', p.sidebar === 'rail' ? 'rail' : 'full');
  t = p.theme === 'light' || p.theme === 'dark' ? p.theme : '';
  try {
    var mq = matchMedia('(prefers-color-scheme: dark)');
    if (!t) t = mq.matches ? 'dark' : 'light';
    // Follow a live OS change while the choice is "system" (the account pages load nothing else that listens).
    var live = function () {
      var s;
      try {
        s = JSON.parse(localStorage.getItem('xaeo-prefs') || '{}') || {};
      } catch {
        s = {};
      }
      if (s.theme !== 'light' && s.theme !== 'dark')
        d.setAttribute('data-theme', mq.matches ? 'dark' : 'light');
    };
    if (mq.addEventListener) mq.addEventListener('change', live);
    else if (mq.addListener) mq.addListener(live);
    // The app's module (ui/js/prefs.js) owns the live switch once it loads, so only one listener runs (R9).
    window.xaeoThemeLiveOff = function () {
      if (mq.removeEventListener) mq.removeEventListener('change', live);
      else if (mq.removeListener) mq.removeListener(live);
    };
  } catch {
    if (!t) t = 'light';
  }
  d.setAttribute('data-theme', t);
  // R14: the browser's own bar (Android Chrome, Safari) takes the top bar's colour and follows every theme change
  // (this script, ui/js/prefs.js and the OS listener all write data-theme).
  try {
    var meta = document.createElement('meta');
    meta.name = 'theme-color';
    var sync = function () {
      meta.content = d.getAttribute('data-theme') === 'dark' ? '#141A46' : '#FFFFFF';
    };
    sync();
    document.head.appendChild(meta);
    new MutationObserver(sync).observe(d, { attributes: true, attributeFilter: ['data-theme'] });
  } catch {
    /* no theme-color: the browser keeps its default bar */
  }
})();
