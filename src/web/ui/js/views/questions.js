// Questions: the buyer questions sent to every engine on every scan.
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
  growText,
  addFieldError,
} from '../lib.js';
import { state } from '../main.js';

export async function renderQuestions(el, ctx) {
  const d = ctx.detail;
  const me = state.me;
  const save = async (path, data) => {
    try {
      ctx.detail = await api(path, { method: 'POST', data });
      draw();
    } catch (err) {
      errorToast(err);
    }
  };
  // The new-baseline note is one quiet line, present from load once a scan exists. Inserting it on focus pushed the
  // field 137px down under the finger (Nina D8); a line that is always there never moves anything.
  const warnSlot = h('div.warn-slot');
  const baselineWarning = () =>
    d.scans.length
      ? h(
          'p.baseline-note',
          icon('info', 16),
          h(
            'span',
            'Changing the question set starts a new baseline. The chart marks where it changed, so before-and-after comparisons stay fair.',
          ),
        )
      : null;

  function row(q) {
    // C4: multi-line, auto-growing wording; Enter still commits (no line breaks in a question).
    const text = growText(
      h(
        'textarea.q-text',
        {
          rows: 1,
          maxlength: 200,
          'aria-label': 'Question text',
          onkeydown: (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.target.blur();
            }
            if (e.key === 'Escape') {
              e.target.value = q.text;
              growText(e.target);
              e.target.blur();
            }
          },
          oninput: (e) => {
            e.target.value = e.target.value.replace(/\n/g, ' ');
            growText(e.target);
          },
          onchange: (e) => {
            const v = e.target.value.trim();
            if (v && v !== q.text) save(`/api/app/questions/${q.id}`, { text: v });
          },
        },
        q.text,
      ),
    );
    const intent = h(
      'select.q-intent',
      {
        'aria-label': 'Intent',
        onchange: (e) => save(`/api/app/questions/${q.id}`, { intent: e.target.value }),
      },
      me.intents.map((i) => h('option', { value: i.id, selected: i.id === q.intent }, i.name)),
    );
    return h(
      'li.q-item',
      { class: q.active ? 'on' : '' },
      h(
        'label.switch-hit',
        h('input.switch', {
          type: 'checkbox',
          checked: q.active,
          'aria-label': q.active ? 'Stop asking this question' : 'Ask this question',
          onchange: (e) => save(`/api/app/questions/${q.id}`, { active: e.target.checked }),
        }),
      ),
      text,
      intent,
      q.leading
        ? h(
            'span.q-warning',
            {
              role: 'note',
              title:
                'This wording assumes the answer. Use a neutral buyer question for a fairer result.',
            },
            icon('alert', 14),
            'Leading wording',
          )
        : null,
      h(
        'button.icon-btn',
        {
          type: 'button',
          'aria-label': 'Delete question',
          title: 'Delete question',
          onclick: (e) => {
            if (!confirm(`Delete “${q.text}”? Past answers stay in the scan history.`)) return;
            busy(e.currentTarget, () => save(`/api/app/questions/${q.id}/delete`, {}));
          },
        },
        icon('trash', 16),
      ),
    );
  }

  async function suggestMore(btn) {
    await busy(btn, async () => {
      const params = new URLSearchParams({ name: d.name, type: d.type, city: d.city });
      const { questions } = await api(`/api/app/suggest?${params}`);
      const have = new Set(ctx.detail.questions.map((q) => q.text.toLowerCase()));
      const fresh = questions.filter((q) => !have.has(q.text.toLowerCase()));
      if (!fresh.length) return toast('You already have every suggestion. Add your own below.');
      clear(
        suggestBox,
        h('h3', 'Suggestions'),
        h(
          'ul.suggest-list',
          fresh.map((q) =>
            h(
              'li',
              h(
                'span',
                q.text,
                h('span.muted', ` · ${me.intents.find((i) => i.id === q.intent).name}`),
              ),
              button(
                'Add',
                {
                  variant: 'secondary',
                  size: 'sm',
                  onclick: (e) =>
                    busy(e.currentTarget, () =>
                      save(`/api/app/clients/${d.id}/questions`, {
                        text: q.text,
                        intent: q.intent,
                      }),
                    ),
                },
                'plus',
              ),
            ),
          ),
        ),
      );
    });
  }
  const suggestBox = h('div.suggest-box');

  function draw() {
    const qs = ctx.detail.questions,
      active = qs.filter((q) => q.active).length;
    const newText = h('input', {
      placeholder: 'Add a question, e.g. “Plumber open on Sunday in Leeds”',
      maxlength: 200,
      'aria-label': 'New question',
    });
    const newIntent = h(
      'select',
      { 'aria-label': 'Intent' },
      me.intents.map((i) => h('option', { value: i.id }, i.name)),
    );
    const addError = addFieldError(newText);
    clear(
      el,
      h(
        'div.section-head',
        h(
          'div',
          h('h2', 'Buyer questions'),
          h(
            'p.muted',
            `${active} active × ${ctx.detail.engines.length} engines = up to ${active * ctx.detail.engines.length} answers per scan. Connected engines determine actual coverage. ${qs.length} of ${ctx.detail.questionLimit} questions.`,
          ),
        ),
        button(
          'Suggest more',
          { variant: 'secondary', onclick: (e) => suggestMore(e.currentTarget) },
          'sparkles',
        ),
      ),
      clear(warnSlot, baselineWarning()),
      suggestBox,
      qs.length
        ? me.intents.map((intent) => {
            const list = qs.filter((q) => q.intent === intent.id);
            return list.length
              ? h(
                  'section.q-group',
                  h('h3', intent.name, h('span.muted', ` · ${intent.hint}`)),
                  h('ul.q-list', list.map(row)),
                )
              : null;
          })
        : h(
            'div.empty.small',
            xo('thinking', 'empty-xo'),
            h('p', 'Pick the questions their customers actually ask.'),
            button(
              'Suggest questions',
              { onclick: (e) => suggestMore(e.currentTarget) },
              'sparkles',
            ),
          ),
      h(
        'form.q-add',
        {
          onsubmit: (e) => {
            e.preventDefault();
            if (!addError.check()) return;
            busy(e.submitter || e.target.querySelector('button'), async () => {
              await save(`/api/app/clients/${d.id}/questions`, {
                text: newText.value.trim(),
                intent: newIntent.value,
              });
              el.querySelector('.q-add input')?.focus({ preventScroll: true });
            });
          },
        },
        newText,
        newIntent,
        h('button.btn.btn-secondary', { type: 'submit' }, icon('plus'), h('span', 'Add')),
      ),
      addError.el,
      h(
        'div.tip',
        icon('lightbulb', 20),
        h(
          'p',
          h('strong', 'Tip: '),
          'phrase questions like a buyer, include the city for local businesses, and mix intents. Rewrite a flagged leading question so it does not assume the answer. Branded questions show what engines say when someone already knows the name.',
        ),
      ),
    );
  }
  draw();
}
