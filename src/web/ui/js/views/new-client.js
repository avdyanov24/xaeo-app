// Add a client in 2 steps: who they are, then the buyer questions to ask the engines (PLAN §P2 flows A and C).
import {
  api,
  h,
  clear,
  icon,
  xo,
  button,
  errorToast,
  toast,
  busy,
  reducedMotion,
  growText,
  addFieldError,
  desk,
} from '../lib.js';
import { state, go } from '../main.js';
import { hint } from '../charts.js';

const TYPES = [
  'plumber',
  'electrician',
  'dentist',
  'accountant',
  'solicitor',
  'roofer',
  'locksmith',
  'builder',
  'cleaner',
  'mechanic',
  'physiotherapist',
  'vet',
  'estate agent',
  'hairdresser',
  'photographer',
  'restaurant',
  'hvac contractor',
  'gardener',
  'painter',
];

export async function renderNewClient(view) {
  const me = state.me;
  const form = { name: '', domain: '', type: '', city: '', country: 'GB' };
  let questions = [];
  let step = 1,
    dir = 'none';

  // Fields: a real <label for>, the note and the error linked with aria-describedby (not inside the label).
  const field = (label, control, note, key) => {
    const id = key ? `nc-${key}` : null,
      el = control.matches('input, select') ? control : control.querySelector('input');
    if (id) el.id = id;
    const noteEl = note ? h('span.field-note', { id: id && `${id}-note` }, note) : null;
    const err = key ? h('p.field-error', { id: `${id}-error`, hidden: true }) : null;
    if (id)
      el.setAttribute(
        'aria-describedby',
        [noteEl && `${id}-note`, `${id}-error`].filter(Boolean).join(' '),
      );
    return h('div.field', h('label.field-label', { for: id }, label), control, noteEl, err);
  };
  const input = (key, props) =>
    h('input', {
      value: form[key],
      oninput: (e) => {
        form[key] = e.target.value;
        if (e.target.getAttribute('aria-invalid')) check(key, e.target.closest('form'));
      },
      ...props,
    });
  // Same domain rule as the server (cleanDomain in server/app/api.mjs), so a bad website is caught on step 1.
  const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
  const validDomain = (v) => {
    const d = v
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split(/[/?#]/)[0];
    return d.length <= 253 && new RegExp(`^(?:${LABEL}\\.)+${LABEL}$`).test(d);
  };
  const RULES = {
    domain: (v) =>
      !v.trim()
        ? 'Enter the client’s website, like northsideplumbing.co.uk.'
        : validDomain(v)
          ? ''
          : 'That doesn’t look like a website. Use the domain only, like northsideplumbing.co.uk.',
    name: (v) => (v.trim().length >= 2 ? '' : 'Enter the business name, at least 2 characters.'),
    type: (v) => (v.trim() ? '' : 'Enter what they do, like plumber.'),
    city: (v) => (v.trim() ? '' : 'Enter the city or area they serve, like Leeds.'),
  };
  // Shows or clears one field's error; returns the input when it is invalid.
  function check(key, f) {
    const el = f.querySelector(`#nc-${key}`),
      err = f.querySelector(`#nc-${key}-error`),
      msg = RULES[key](form[key]);
    if (msg) {
      el.setAttribute('aria-invalid', 'true');
      clear(err, icon('alert', 16), h('span', msg));
      err.hidden = false;
      return el;
    }
    el.removeAttribute('aria-invalid');
    err.hidden = true;
    clear(err);
    return null;
  }

  function stepOne() {
    const country = h(
      'select',
      {
        onchange: (e) => {
          form.country = e.target.value;
        },
      },
      me.countries.map(([code, name]) =>
        h('option', { value: code, selected: code === form.country }, name),
      ),
    );
    const f = h(
      'form.card.form-card',
      {
        novalidate: true,
        onsubmit: async (e) => {
          e.preventDefault();
          const bad = Object.keys(RULES)
            .map((key) => check(key, f))
            .filter(Boolean);
          if (bad.length) return bad[0].focus();
          const btn = f.querySelector('button[type=submit]');
          await busy(btn, async () => {
            try {
              const params = new URLSearchParams({
                name: form.name,
                type: form.type,
                city: form.city,
              });
              const { questions: suggested } = await api(`/api/app/suggest?${params}`);
              const custom = questions.filter((q) => q.custom);
              questions = [...suggested.map((q) => ({ ...q })), ...custom];
              step = 2;
              dir = 'right';
              draw();
            } catch (err) {
              errorToast(err);
            }
          });
        },
      },
      h('h2', 'The client'),
      field(
        'Website',
        input('domain', {
          required: true,
          placeholder: 'e.g. northsideplumbing.co.uk',
          autocomplete: 'off',
          inputmode: 'url',
        }),
        'We only use the domain to spot when engines cite the client’s site.',
        'domain',
      ),
      field(
        'Business name',
        input('name', {
          required: true,
          minlength: 2,
          maxlength: 100,
          placeholder: 'e.g. Northside Plumbing',
        }),
        'Exactly as buyers see it. We look for this name in every answer.',
        'name',
      ),
      h(
        'div.field-row',
        field(
          'What they do',
          h(
            'span',
            input('type', {
              required: true,
              list: 'types',
              placeholder: 'e.g. plumber',
              maxlength: 60,
            }),
            h(
              'datalist#types',
              TYPES.map((t) => h('option', { value: t })),
            ),
          ),
          null,
          'type',
        ),
        field(
          'City or area',
          input('city', { required: true, placeholder: 'e.g. Leeds', maxlength: 80 }),
          null,
          'city',
        ),
      ),
      field('Country', country, null, 'country'),
      h(
        'div.form-actions',
        h('a.btn.btn-ghost', { href: '#/' }, 'Cancel'),
        h(
          'button.btn',
          { type: 'submit' },
          h('span', 'Next: pick questions'),
          icon('chevronRight'),
        ),
      ),
    );
    return f;
  }

  function stepTwo() {
    const count = () => questions.filter((q) => q.on).length;
    const counter = h('p.counter');
    const updateCount = () => {
      const n = count();
      clear(
        counter,
        h('strong', String(n)),
        ` question${n === 1 ? '' : 's'} × ${me.engines.length} engines = up to `,
        h('strong', String(n * me.engines.length)),
        ' answers per scan',
      );
      counter.classList.remove('bump');
      void counter.offsetWidth;
      counter.classList.add('bump');
      save.disabled = saveOnly.disabled = n === 0;
    };
    // Each intent group redraws on its own, so adding a question never rebuilds the step (no jump to the top).
    const drawers = {},
      lists = {};
    const groups = me.intents.map((intent) => {
      const list = h('ul.q-list');
      const draw = () =>
        clear(
          list,
          questions
            .filter((q) => q.intent === intent.id)
            .map((q) => {
              const id = `q-${questions.indexOf(q)}`;
              return h(
                'li.q-item',
                { class: q.on ? 'on' : '' },
                h(
                  'label.switch-hit',
                  h('input.switch', {
                    type: 'checkbox',
                    id,
                    checked: q.on,
                    'aria-label': `Ask “${q.text}”`,
                    onchange: (e) => {
                      q.on = e.target.checked;
                      e.target.closest('li').classList.toggle('on', q.on);
                      updateCount();
                    },
                  }),
                ),
                // C4: the wording wraps onto as many lines as it needs (auto-growing, never truncated); Enter still submits.
                growText(
                  h(
                    'textarea.q-text',
                    {
                      rows: 1,
                      'aria-label': 'Question text',
                      maxlength: 200,
                      onkeydown: (e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          e.target.form?.requestSubmit();
                        }
                      },
                      oninput: (e) => {
                        e.target.value = e.target.value.replace(/\n/g, ' ');
                        q.text = e.target.value;
                        growText(e.target);
                      },
                    },
                    q.text,
                  ),
                ),
              );
            }),
        );
      draw();
      drawers[intent.id] = draw;
      lists[intent.id] = list;
      return h('section.q-group', h('h3', intent.name, h('span.muted', ` · ${intent.hint}`)), list);
    });
    const newText = h('input', {
      placeholder: 'Add your own question',
      'aria-label': 'Add your own question',
      maxlength: 200,
    });
    const newIntent = h(
      'select',
      { 'aria-label': 'Intent' },
      me.intents.map((i) => h('option', { value: i.id }, i.name)),
    );
    const addError = addFieldError(newText),
      added = h('p.visually-hidden', { role: 'status' });
    const addCustom = (e) => {
      e.preventDefault();
      if (!addError.check()) return;
      const intent = newIntent.value;
      questions.push({ intent, text: newText.value.trim(), on: true, custom: true });
      newText.value = '';
      drawers[intent]?.();
      updateCount();
      newText.focus({ preventScroll: true });
      // The new row rises in place. The page does not scroll to it (a keyboard user keeps their place at the add field);
      // the counter bump and the status line say where it went.
      lists[intent]?.lastElementChild?.classList.add('just-added');
      added.textContent = `Added to ${me.intents.find((i) => i.id === intent)?.name || 'the list'}.`;
    };
    const create = (scan) => async (e) =>
      busy(e.currentTarget, async () => {
        try {
          const first = state.me?.onboarding && !state.me.onboarding.client;
          const { id, scanNote } = await api('/api/app/clients', {
            method: 'POST',
            data: {
              ...form,
              questions: questions
                .filter((q) => q.on && q.text.trim().length >= 3)
                .map(({ text, intent }) => ({ text, intent })),
              scan,
            },
          });
          // U5: the workspace's first client gets a wave from the Overview's Xo (read once by overview.js).
          if (first) {
            try {
              sessionStorage.setItem('xaeo-first-client', id);
            } catch {
              /* storage off */
            }
          }
          // U10: the sidebar lists the new client at once (main.js refreshes it on xaeo:clients).
          dispatchEvent(new CustomEvent('xaeo:clients'));
          go(`#/clients/${id}/overview`);
          // The client is saved but the server refused the first scan (paused, over a limit, no live engine): say why, in its words.
          if (scanNote)
            toast(`Client saved. The first scan didn’t start. ${scanNote}`, { tone: 'error' });
        } catch (err) {
          errorToast(err);
        }
      });
    // U17: one sticky footer row at every width: Back (labelled), the quiet save, the primary. Phones get the short
    // labels (CSS swaps the spans; the hidden one leaves the accessibility tree, so the name always matches the text).
    const labels = (full, short) => [h('span.lbl-full', full), h('span.lbl-short', short)];
    const save = button(
      labels('Save and run first scan', 'Save and scan'),
      { class: 'wf-primary', onclick: create(true) },
      'play',
    );
    const saveOnly = button(labels('Save without scanning', 'Save only'), {
      variant: 'ghost',
      class: 'save-only',
      onclick: create(false),
    });
    const back = button(
      'Back',
      {
        variant: 'secondary',
        class: 'wf-back',
        onclick: () => {
          step = 1;
          dir = 'left';
          draw();
        },
      },
      'chevronLeft',
    );
    // Phones: the questions start right under the intro (the tip lives in a hint), and the footer is one row.
    const box = h(
      'div.card.form-card',
      h('h2', `Buyer questions for ${form.name}`),
      h(
        'p.muted',
        'We picked the most useful ones. Turn them on or off and edit the wording.',
        desk.matches
          ? null
          : hint(
              'Phrase each question the way a buyer would type it, and include the city for local businesses. Keep the wording stable so rescans compare like with like.',
            ),
      ),
      groups,
      h(
        'form.q-add',
        { onsubmit: addCustom },
        newText,
        newIntent,
        h('button.btn.btn-secondary', { type: 'submit' }, icon('plus'), h('span', 'Add')),
      ),
      addError.el,
      added,
      counter,
      h(
        'div.form-actions.wizard-foot',
        back,
        h('span.wf-gap', { 'aria-hidden': 'true' }),
        saveOnly,
        save,
      ),
    );
    updateCount();
    return box;
  }

  // What happens next, so nobody wonders what the button does.
  function aside() {
    const items = [
      [
        'message',
        'We suggest buyer questions',
        'Based on what they do and where. You can edit every one.',
      ],
      [
        'zap',
        'The first scan takes about a minute',
        'Each question goes to both engines: ChatGPT and Claude.',
      ],
      ['list', 'Fixes appear, ranked', 'Every fix has the exact code and the answers behind it.'],
      ['download', 'Export a white‑label report', 'Your logo and colors. Never ours.'],
    ];
    // Xo shows on step 1 only; later steps keep the aside calm.
    return h(
      'aside.wizard-aside',
      step === 1 ? xo('curious', 'wizard-xo') : null,
      h('h3', 'What happens next'),
      h(
        'ol.next-steps',
        items.map(([ic, title, text], i) =>
          h(
            'li',
            { class: i < step ? 'now' : '' },
            h('span.next-icon', icon(ic, 16)),
            h('div', h('strong', title), h('span.muted.small', text)),
          ),
        ),
      ),
    );
  }

  function draw() {
    clear(
      view,
      h(
        'div.page-head',
        h(
          'div',
          h('a.crumb', { href: '#/' }, icon('chevronLeft', 16), 'Clients'),
          h('h1', 'Add a client'),
          h(
            'ol.wizard-steps',
            { 'aria-label': 'Steps' },
            h(
              `li${step === 1 ? '.current' : '.done'}`,
              { 'aria-current': step === 1 ? 'step' : null },
              h('span.ws-mark', step === 1 ? '1' : icon('check', 14)),
              'The client',
            ),
            h('li.ws-line', { 'aria-hidden': 'true' }, h('span')),
            h(
              `li${step === 2 ? '.current' : ''}`,
              { 'aria-current': step === 2 ? 'step' : null },
              h('span.ws-mark', '2'),
              'Buyer questions',
            ),
          ),
        ),
      ),
      h(
        'div.wizard-layout',
        h('div.wizard-pane', { class: `from-${dir}` }, step === 1 ? stepOne() : stepTwo()),
        aside(),
      ),
    );
    view.querySelector('input')?.focus({ preventScroll: true });
    if (!reducedMotion()) scrollTo({ top: 0, behavior: 'smooth' });
  }
  draw();
}
