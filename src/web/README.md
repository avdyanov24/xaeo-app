# src/web

Plain HTML, CSS and JavaScript, served as static files by `src/server/http/static.js`. There is no build step: the browser loads the ES modules directly.

```
app.html        the app shell: sidebar, top bar, navigation and the mount point for views
prefs.js        runs in <head> and puts density, motion and theme on <html> before first paint
ui/js/          main.js (entry and router), lib.js, Xo, charts, tour, palette
ui/js/views/    one module per screen: clients, overview, answers, fixes, settings, ...
ui/img/         small icons used by form controls
ds/tokens/      design tokens as CSS custom properties
ds/fonts/       self-hosted variable fonts
assets/         favicons and the wordmark
```

`ui/js/lib.js` is the only module that calls `fetch` for JSON, through `api()`; views call it instead of using `fetch` directly. URLs are the file paths under this folder, so `ui/js/main.js` is `/ui/js/main.js`. See [docs/architecture.md](../../docs/architecture.md).
