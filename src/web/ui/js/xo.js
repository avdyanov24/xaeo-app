// Xo, the Xaeo axolotl, on the app and account pages. A thin adapter over the whole-frame vector morph
// renderer (assets/xo-morph-v1/xo-morph.js): one shared animation loop, clips loaded lazily per mood, a static pose
// under reduced motion, paused offscreen and in hidden tabs, and one animated Xo per screen.
// He performs from the dense x6 clips in
// assets/xo-app/, played slow, one focused gesture per mood cut from the clip, then a 360ms smoothstep settle to rest
// (450ms after the wave). Idle is blinks only: the first 0.35-0.85s after he settles, then every 1.2-2.6s (4-7s for a
// second Xo on screen that does not hold the stage). No glances, nods or replays on their own. thinking repeats its gesture after a 1.2-2.4s rest until the mood changes.
// Tour guide moods: pointLeft / pointRight (the same point, mirrored, towards the viewer's left or right) and present.
// A mouse passing over him does nothing; a click or tap replays the gesture once.
// Every dynamic style goes through el.style, so the strict CSP holds.

const SRC = '/assets/xo-morph-v1/xo-morph.js';
const CLIPS = '/assets/xo-app/'; // the x6 clips the app plays (own manifest)
// mood -> clip, speed (1 = drawn tempo), cut (clip ms where the gesture ends, then the settle), settle (ms),
// still (the v1 pose shown under reduced motion, from poses.json), flip (mirror), loop.
const WAVE = { clip: 'x6welcome', speed: 0.5, cut: 1250, settle: 450, still: 'wave' };
const HOP = { clip: 'x6hop', speed: 1131 / 1390, cut: 1318, still: 'cheer' }; // one clean hop, cut just after the landing
const POINT = { clip: 'x6point', speed: 0.6, cut: 1380, still: 'tour-pointLeft' }; // x6point points to the viewer's left
const MOODS = {
  wave: WAVE,
  waving: WAVE,
  curious: { clip: 'x6curious', speed: 0.55, cut: 700, still: 'curious' },
  uneasy: { clip: 'x6worried', speed: 0.55, cut: 1000, still: 'uneasy' },
  thinking: { clip: 'x6thinking', speed: 0.65, cut: 1400, still: 'thinking', loop: true },
  nod: { clip: 'x6nod', speed: 0.65 },
  cheer: HOP,
  hop: HOP,
  happy: HOP,
  excited: HOP,
  cheering: HOP,
  pointLeft: POINT,
  pointRight: { ...POINT, flip: true },
  // no x6 clip for these two: the tour clip at slow tempo, cut after its one gesture
  present: { clip: 'tour-present', speed: 0.6, cut: 1700, still: 'tour-present' },
  love: { clip: 'love', speed: 0.65, cut: 2600, still: 'love' },
};
// U5 reaction map (one Xo per screen, never on tables, the answers grid, drawers, reports or admin):
// first client saved -> wave · scan start -> thinking · result up -> cheer · flat -> nod · all fixes done -> cheer
// first report exported -> love · empty workspace -> curious (once a session) · error pages -> curious
// failed scan -> uneasy · onboarding step done -> hop. 'rest' (or any unknown mood) is the blink-only idle with no clip.
// Reactions share one 2s cooldown so quick repeats (Mark done twice, retry storms) never stack clips.
let lastReaction = 0;
export const reactionReady = () => {
  const now = Date.now();
  if (now - lastReaction < 2000) return false;
  lastReaction = now;
  return true;
};
// react(xoElementOrApi, mood): play a reaction on an Xo already on screen; false when cooling down.
export function react(target, mood) {
  const x = target?._xo || target;
  if (!x?.setMood || !reactionReady()) return false;
  if (x.mood === mood) x.replay();
  else x.setMood(mood);
  return true;
}
const media = matchMedia('(prefers-reduced-motion: reduce)');
const live = new Set();
const rand = (a, b) => a + Math.random() * (b - a);
let lib = null,
  n = 0,
  watcher = null,
  AppXo = null;

function morph() {
  if (window.XoMorph) return Promise.resolve(window.XoMorph);
  return (
    lib ||
    (lib = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SRC;
      s.async = true;
      s.onload = () =>
        window.XoMorph ? resolve(window.XoMorph) : reject(new Error('Xo morph renderer missing'));
      s.onerror = () => {
        lib = null;
        s.remove();
        reject(new Error('Xo morph renderer not ready'));
      };
      document.head.append(s);
    }))
  );
}

function intent(mood) {
  const m = MOODS[mood] || {};
  return { kind: 'calm', ...m, clip: m.clip || null, key: 'calm:' + mood + ':' + ++n };
}

// The app's player: the Player (director, stage, visibility, reduced motion) with the app's performance.
// It overrides only the calm path (calmNext, restBlink, interrupt, need, drawStatic), so other intents never reach it.
function player(X) {
  if (AppXo) return AppXo;
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  // a clip played at `speed`, stopped at `cut` (clip ms). Same activity shape as the renderer's own clips.
  const clipAct = (c, t0, speed = 1, cut = null, onEnd) => {
    const total = c.total / speed,
      cutAt = cut != null && cut < c.total ? t0 + cut / speed : null;
    return {
      type: 'clip',
      c: { id: c.id, total },
      t0,
      onEnd,
      stopAt: cutAt,
      takeAt: null,
      mustFinish: false,
      end() {
        return this.stopAt ?? t0 + total;
      },
      done(pt) {
        return pt >= this.end();
      },
      st(pt) {
        return X.at(c, (Math.min(pt, this.end()) - t0) * speed);
      },
      pose(pt) {
        const [s, t, u] = this.st(pt);
        return X.evalPose(c, s, t, u);
      },
      endPose() {
        return this.end() < t0 + total ? this.pose(this.end()) : X.REST;
      },
      key(pt) {
        const [s, t, u] = this.st(pt);
        return c.id + ':' + s + ':' + t.toFixed(3) + ':' + u.toFixed(2);
      },
      wake(pt) {
        // during a drawn hold nothing changes: sleep until it ends (or the cut)
        const ms = (pt - t0) * speed;
        let k = c.n - 1;
        for (let i = 1; i < c.n; i++)
          if (c.T[i] > ms) {
            k = i - 1;
            break;
          }
        const lt = ms - c.T[k];
        return lt >= 0 && lt < c.hold[k]
          ? Math.max(0, Math.min((c.hold[k] - lt) / speed, this.end() - pt))
          : 0;
      },
      phraseLeft(pt) {
        return Math.max(0, this.end() - pt);
      },
    };
  };
  const settleAct = (from, t0, ms) => {
    const plan = X.blendPlan(from, X.REST),
      u = (pt) => clamp01((pt - t0) / ms);
    return {
      type: 'blend',
      to: X.REST,
      done: (pt) => pt >= t0 + ms,
      pose: (pt) => X.blendPose(plan, X.ease.smooth(u(pt))),
      endPose: () => X.REST,
      key: (pt) => 'settle' + t0.toFixed(1) + ':' + u(pt).toFixed(3),
      wake: () => 0,
    };
  };
  const holdAct = (until) => (
    (until = Number.isNaN(until) ? Infinity : until),
    {
      type: 'hold',
      done: (pt) => pt >= until,
      pose: () => X.REST,
      endPose: () => X.REST,
      key: () => 'hold:rest',
      wake: (pt) => Math.max(1, Math.min(until - pt, 60000)),
    }
  );
  const fetchClip = (id) =>
    X.manifest.clips[id] ? X.clip(id) : X.load([], { base: CLIPS }).then(() => X.clip(id));

  return (AppXo = class extends X.Player {
    // loopAt stays finite: a loop gesture cut by a stage loss or reduced motion skips onEnd and resumes at once
    constructor(...a) {
      super(...a);
      this.blinkAt = rand(350, 850);
      this.loopAt = 0;
      this.failed = null;
    }
    need() {
      // load this mood's clip and the blink once Xo is within a viewport of the screen
      const I = this.intent;
      if (!I || !this.near) return;
      if (this.reduced) {
        X.poses(1).then(
          () => {
            this.paint = '';
            if (this.reduced) this.drawStatic();
          },
          () => {},
        );
        return;
      }
      for (const id of [I.clip, 'blink'])
        if (id && !X.loaded(id))
          fetchClip(id).then(
            () => {
              if (this.failed === id) this.failed = null;
              X.director.wake();
            },
            () => {
              // a mood clip that does not load: give up the stage claim and fall back to the blink-only idle (need() retries later)
              if (id === this.intent?.clip) {
                this.failed = id;
                this.busy = false;
                X.director.arbitrate();
                X.director.wake();
              }
            },
          );
    }
    settle(ms = this.intent?.settle || 360) {
      // smoothstep back to rest; the first blink follows 0.35-0.85s after
      this.atRest = true;
      this.blinkAt = this.pt + ms + rand(350, 850);
      return settleAct(this.posePose, this.pt, ms);
    }
    restBlink(until) {
      // rest pose, blinks only (the idle pose)
      if (!this.atRest) return this.settle();
      const b = X.loaded('blink'),
        pt = this.pt;
      // off-stage Xos (a second one on screen) blink at a slower 4-7s, so one Xo stays the focus
      if (b && pt >= this.blinkAt) {
        this.blinkAt = pt + b.total + (this.stage ? rand(1200, 2600) : rand(4000, 7000));
        return clipAct(b, pt);
      }
      return holdAct(Math.min(until, b ? this.blinkAt : pt + 500));
    }
    calmNext() {
      // the mood's gesture once (thinking: again after a calm rest), then the blink-only idle
      const I = this.intent,
        pt = this.pt;
      if (!this.atRest) return this.settle();
      const c = I.clip ? X.loaded(I.clip) : null;
      if (I.clip && !c) {
        if (this.failed !== I.clip) return this.restBlink(pt + 200);
        this.busy = false;
        return this.restBlink(Infinity);
      }
      if (c && (this.playedKey !== I.key || (I.loop && pt >= this.loopAt))) {
        this.playedKey = I.key;
        this.busy = true;
        this.everPlayed = true;
        this.atRest = false;
        this.loopAt = 0;
        return clipAct(c, pt, I.speed, I.cut, (p) => {
          if (!I.loop && p.intent === I) p.busy = false; // a newer mood waiting on this gesture keeps the stage claim
          // cut mid-gesture: the settle goes first in the queue, so no other wait (another Xo settling) shows a jump to rest
          if (p.atRest) p.blinkAt = p.pt + rand(350, 850);
          else p.queue = [(q) => q.settle()];
          p.loopAt = p.pt + (p.atRest ? 0 : I.settle || 360) + rand(1200, 2400);
        });
      }
      if (!I.loop) this.busy = false;
      return this.restBlink(I.loop ? this.loopAt : Infinity);
    }
    interrupt() {
      // a new mood: a gesture within 600ms of its end finishes, anything else settles now; a settle lands first
      const a = this.act;
      this.queue = [];
      if (!a || a.type === 'blend') return;
      if (a.type === 'clip') {
        const r = a.phraseLeft(this.pt);
        if (r < 600) {
          a.stopAt = this.pt + r;
          return;
        }
      }
      this.posePose = this.poseNow();
      this.act = null;
      if (a.type === 'clip') {
        this.atRest = false;
        this.queue = [(q) => q.settle()];
      }
    }
    drawStatic() {
      // reduced motion: the mood's peak pose (mirrored with the canvas for pointRight), no blinks
      const id = this.intent?.still,
        pd = id && X.poseData[id],
        pose = pd ? pd.peak : X.REST;
      this.act = null;
      this.queue = [];
      this.posePose = pose;
      this.draw(pd ? 'peak:' + id : 'rest', () => pose);
    }
  });
}

// Views replace their DOM without telling Xo; a player whose element left the page is destroyed.
function watch() {
  if (watcher) return;
  watcher = new MutationObserver(() => {
    for (const x of live) {
      if (x.el.isConnected) x.attached = true;
      else if (x.attached) x.destroy();
    }
  });
  watcher.observe(document.documentElement, { childList: true, subtree: true });
}
media.addEventListener('change', () => {
  for (const x of live) x.player?.setFlags({ reduced: media.matches });
});

// createXo({ mood, label }) → { el, mood, setMood, replay, hop, destroy }
export function createXo({ mood = 'wave', label = '' } = {}) {
  const el = document.createElement('span');
  el.className = 'xo';
  if (label) {
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', label);
  } else el.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  el.append(canvas);
  let m = mood,
    ro = null,
    flipped = false;
  // pointRight mirrors the canvas about Xo's feet. The swap happens mid-way through a 360ms squash.
  const turn = (X, flip, animate) => {
    if (!!flip === flipped) return;
    const from = flipped ? -1 : 1,
      to = flip ? -1 : 1,
      B = X.bounds;
    flipped = !!flip;
    canvas.style.transformOrigin = (((200 - B[0]) / (B[2] - B[0])) * 100).toFixed(2) + '% 50%';
    canvas.style.transform = to < 0 ? 'scaleX(-1)' : '';
    if (animate && !media.matches)
      canvas.animate(
        [
          { transform: `scaleX(${from})` },
          { transform: `scaleX(${from * 0.78})`, offset: 0.5 },
          { transform: `scaleX(${to * 0.78})`, offset: 0.5 },
          { transform: `scaleX(${to})` },
        ],
        { duration: 360, easing: 'cubic-bezier(.45,0,.55,1)' },
      );
  };
  const api = {
    el,
    player: null,
    attached: false,
    get mood() {
      return m;
    },
    setMood(next) {
      if (!next || next === m) return;
      m = next;
      const p = api.player;
      if (p) {
        const I = intent(m);
        turn(window.XoMorph, I.flip, true);
        if (I.clip) p.busy = true;
        p.set(I, true);
      }
    },
    replay() {
      api.player?.replay();
    },
    hop() {
      api.replay();
    },
    destroy() {
      live.delete(api);
      ro?.disconnect();
      api.player?.destroy();
      api.player = null;
    },
  };
  el._xo = api;
  live.add(api);
  watch();
  morph().then(
    (X) => {
      if (!live.has(api)) return;
      const p = (api.player = new (player(X))(canvas, el));
      p.setFlags({ reduced: media.matches });
      // One Xo animates per screen. A new Xo (tour, toast, a fresh view) takes that slot when it first shows and
      // keeps it (busy) until its mood clip has played, even when another Xo sits closer to the middle.
      let shown = false;
      p.onView = () => {
        if (!shown && p.inView && p.ratio >= 0.6) {
          shown = true;
          if (p.intent?.clip) p.busy = true;
          X.director.claim(p);
        }
      };
      const I = intent(m);
      turn(X, I.flip, false);
      p.set(I, false);
      ro = new ResizeObserver(() => p.redraw());
      ro.observe(el);
    },
    (err) => console.warn(err.message),
  );
  // A click or tap replays the gesture once. No hover replay: at 40px a mouse passing over made him fidget.
  el.addEventListener('click', api.replay);
  return api;
}

// Replace every <span data-xo="mood"> on an account page with a live Xo.
export function mountAll(root = document) {
  root.querySelectorAll('[data-xo]').forEach((slot) => {
    const x = createXo({ mood: slot.dataset.xo });
    x.el.classList.add(...slot.classList);
    slot.replaceWith(x.el);
  });
}
