// Client settings: details, weekly rescans, archive.
import {
  api,
  h,
  clear,
  icon,
  zonedRun,
  timeZones,
  browserZone,
  button,
  errorToast,
  toast,
  busy,
  friendlyError,
  reducedMotion,
} from '../lib.js';
import { state, go } from '../main.js';

// Workspace time zone: one setting for every client's Monday 09:00 rescan. Owners change it in Settings > Workspace
// and brand (U25: client settings only shows it); members read it. Only canonical IANA ids (or UTC) are accepted by the server.
export function timeZoneBlock(ctx) {
  const current = state.me.workspace?.timezone || 'UTC';
  const pretty = (z) => z.replace(/_/g, ' ');
  if (state.me.user.workspaceRole !== 'owner') {
    return h(
      'p.tz-note.small',
      icon('calendar', 16),
      h(
        'span',
        'Times use the workspace time zone, ',
        h('strong', pretty(current)),
        '. An owner can change it.',
      ),
    );
  }
  const zones = timeZones(),
    own = browserZone();
  if (!zones.includes(current)) zones.unshift(current);
  // Grouped by region so the native picker (and its type-to-find) stays usable on phones.
  const groups = new Map();
  for (const z of zones) {
    const region = z.includes('/') ? z.split('/')[0] : 'Other';
    if (!groups.has(region)) groups.set(region, []);
    groups.get(region).push(z);
  }
  const select = h(
    'select#tz-select',
    { 'aria-describedby': 'tz-help tz-error' },
    [...groups].map(([region, list]) =>
      h(
        'optgroup',
        { label: region },
        list.map((z) => h('option', { value: z, selected: z === current }, pretty(z))),
      ),
    ),
  );
  const error = h('p.field-error#tz-error', { role: 'alert', hidden: true });
  const save = h('button.btn.btn-sm', { type: 'submit', disabled: true }, 'Save time zone');
  const sync = () => {
    save.disabled = select.value === (state.me.workspace?.timezone || 'UTC');
    error.hidden = true;
    select.removeAttribute('aria-invalid');
  };
  select.addEventListener('change', sync);
  const useMine =
    own && own !== current && zones.includes(own)
      ? h(
          'button.btn.btn-ghost.btn-sm',
          {
            type: 'button',
            onclick: () => {
              select.value = own;
              sync();
              select.focus();
            },
          },
          `Use my time zone (${pretty(own)})`,
        )
      : null;
  return h(
    'form.tz-form',
    {
      onsubmit: (e) => {
        e.preventDefault();
        busy(save, async () => {
          try {
            const res = await api('/api/app/workspace/timezone', {
              method: 'POST',
              data: { timezone: select.value },
            });
            state.me.workspace.timezone = res.timezone;
            toast(`Time zone saved. Weekly rescans run Mondays at 09:00 ${pretty(res.timezone)}.`);
            await ctx.refresh();
            document.getElementById('tz-select')?.focus({ preventScroll: true }); // the tab redraws; keep the keyboard place
          } catch (err) {
            // 400: not a zone the server accepts; 403: no longer an owner. Say it next to the field, keep the choice.
            error.textContent =
              err.status === 403
                ? 'Only workspace owners can change the time zone.'
                : err.status === 400
                  ? 'That time zone is not supported. Pick a city in the list, for example Europe/London.'
                  : friendlyError(err);
            error.hidden = false;
            select.setAttribute('aria-invalid', 'true');
            select.focus();
          }
        });
      },
    },
    h(
      'div.field',
      h('label.field-label', { for: 'tz-select' }, 'Workspace time zone'),
      select,
      h(
        'span.field-note#tz-help',
        'Applies to every client in this workspace. Changing it moves each scheduled Monday 09:00 rescan.',
      ),
      error,
    ),
    h('div.tz-actions', save, useMine),
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const longDate = (ms) => {
  const x = new Date(ms);
  return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
};

// A native dialog: focus moves in (to Cancel: the safe choice for an action that deletes), Escape cancels, focus
// returns to the button that opened it. R10: styled by app.css .confirm-dialog (themed surface, scrim, flat edge).
function confirmDeletion(opener, d, ctx) {
  // R11: it sinks out (150ms ease-in, faster than the 240ms rise) before closing; instant under reduced motion.
  const close = () => {
    if (dialog.classList.contains('closing')) return;
    let closed = false;
    const done = () => {
      if (closed) return;
      closed = true;
      dialog.close();
      dialog.remove();
      opener.focus();
    };
    if (reducedMotion()) return done();
    dialog.classList.add('closing');
    dialog.addEventListener('animationend', (e) => {
      if (e.target === dialog && !e.pseudoElement) done();
    });
    setTimeout(done, 260);
  };
  const submit = h('button.btn', { type: 'submit' }, 'Request deletion');
  const cancel = h(
    'button.btn.btn-secondary',
    { type: 'button', onclick: close },
    'Keep the client',
  );
  const dialog = h(
    'dialog.confirm-dialog',
    {
      'aria-labelledby': 'del-title',
      'aria-describedby': 'del-desc',
      onclose: () => dialog.remove(),
      oncancel: (e) => {
        e.preventDefault();
        close();
      },
    },
    h(
      'form',
      {
        method: 'dialog',
        onsubmit: (e) => {
          e.preventDefault();
          busy(submit, async () => {
            try {
              await api(`/api/app/clients/${d.id}/deletion-request`, { method: 'POST' });
              close();
              toast('Deletion requested. You can cancel it on this tab.');
              await ctx.refresh();
            } catch (err) {
              errorToast(err);
            }
          });
        },
      },
      h('h2#del-title', `Delete ${d.name}?`),
      h(
        'div#del-desc.confirm-body',
        h('p', 'Its questions, scans, answers, fixes and saved reports are deleted with it.'),
        h(
          'ul.confirm-points',
          h(
            'li',
            icon('clock', 16),
            h(
              'span',
              'Nothing goes right away. You can cancel on this tab until the deletion runs.',
            ),
          ),
          h(
            'li',
            icon('users', 16),
            h('span', 'Members you shared it with lose it when it is deleted.'),
          ),
          h(
            'li',
            icon('database', 16),
            h('span', 'Backups are overwritten in the normal backup cycle.'),
          ),
        ),
      ),
      h('div.confirm-actions', cancel, submit),
    ),
  );
  document.body.append(dialog);
  dialog.showModal();
  cancel.focus();
}

export async function renderSettings(el, ctx) {
  const d = ctx.detail;
  const tz = state.me.workspace?.timezone || 'UTC';
  const form = { name: d.name, type: d.type, city: d.city, country: d.country };
  const field = (label, key, props = {}) =>
    h(
      'label.field',
      h('span.field-label', label),
      h('input', {
        value: form[key],
        oninput: (e) => {
          form[key] = e.target.value;
        },
        ...props,
      }),
    );
  const details = h(
    'form.card.form-card',
    {
      onsubmit: (e) => {
        e.preventDefault();
        busy(e.target.querySelector('button[type=submit]'), async () => {
          try {
            await api(`/api/app/clients/${d.id}`, { method: 'POST', data: form });
            toast('Saved');
            await ctx.refresh();
          } catch (err) {
            errorToast(err);
          }
        });
      },
    },
    h('h2', 'Client details'),
    field('Business name', 'name', { required: true, maxlength: 100 }),
    h(
      'p.field-note',
      `Website: ${d.domain}. To change the website, add a new client and archive this one.`,
    ),
    h(
      'div.field-row',
      field('What they do', 'type', { maxlength: 60 }),
      field('City or area', 'city', { maxlength: 80 }),
    ),
    h(
      'label.field',
      h('span.field-label', 'Country'),
      h(
        'select',
        {
          onchange: (e) => {
            form.country = e.target.value;
          },
        },
        state.me.countries.map(([c, n]) =>
          h('option', { value: c, selected: c === form.country }, n),
        ),
      ),
    ),
    h('div.form-actions', h('button.btn', { type: 'submit' }, 'Save details')),
  );
  const weekly = h(
    'section.card.client-set',
    { dataset: { tour: 'weekly' } },
    h('h2', 'Weekly rescans'),
    h(
      'label.check',
      h('input.switch', {
        type: 'checkbox',
        checked: d.weekly && d.status !== 'archived',
        disabled: d.status === 'archived',
        onchange: async (e) => {
          try {
            await api(`/api/app/clients/${d.id}`, {
              method: 'POST',
              data: { weekly: e.target.checked },
            });
            toast(e.target.checked ? 'Weekly rescans on' : 'Weekly rescans off');
            await ctx.refresh();
          } catch (err) {
            errorToast(err);
          }
        },
      }),
      h(
        'span',
        h('strong', 'Rescan every Monday'),
        h(
          'span.muted',
          d.status === 'archived'
            ? ' · paused while archived'
            : d.nextRunAt
              ? ` · next run ${zonedRun(d.nextRunAt, tz)}`
              : state.me?.rescansPaused
                ? ' · paused for now'
                : ' · off',
        ),
      ),
    ),
    h(
      'p.muted.small',
      'Each active question is asked on every connected, eligible engine. Only returned answers count; successful rescans add a new chart point.',
    ),
    // U25: the workspace time zone is set in one place (Settings > Workspace); here it is a read-only line.
    h(
      'p.tz-note.small',
      icon('calendar', 16),
      h(
        'span',
        'Rescans run in ',
        h('strong', tz.replace(/_/g, ' ')),
        '. ',
        state.me.user.workspaceRole === 'owner'
          ? h('a', { href: '#/settings/workspace' }, 'Change in Settings')
          : 'An owner can change it in Settings.',
      ),
    ),
  );
  const archived = d.status === 'archived';
  const archive = h(
    'section.card.client-set',
    h('h2', archived ? 'Unarchive' : 'Archive this client'),
    h(
      'p.muted',
      archived
        ? 'Bring the client back to your list and turn scans on again.'
        : 'The client leaves your list and stops rescanning. History stays readable. Nothing is deleted.',
    ),
    button(
      archived ? 'Unarchive client' : 'Archive client',
      {
        variant: 'secondary',
        onclick: (e) =>
          busy(e.currentTarget, async () => {
            try {
              await api(`/api/app/clients/${d.id}/${archived ? 'unarchive' : 'archive'}`, {
                method: 'POST',
              });
              if (archived) {
                toast('Client unarchived');
                await ctx.refresh();
                return;
              }
              // Undo for 8s: one POST restores the client and reopens it.
              toast(`${d.name} archived`, {
                action: {
                  label: 'Undo',
                  onClick: async () => {
                    try {
                      await api(`/api/app/clients/${d.id}/unarchive`, { method: 'POST' });
                      toast(`${d.name} restored`);
                      go(`#/clients/${d.id}/overview`);
                    } catch (err) {
                      errorToast(err);
                    }
                  },
                },
              });
              go('#/');
            } catch (err) {
              errorToast(err);
            }
          }),
      },
      archived ? 'undo' : 'archive',
    ),
  );
  const owner = state.me.user.workspaceRole === 'owner';
  const pending =
    archived && owner
      ? (await api(`/api/app/lifecycle/clients/${d.id}`).catch(() => ({ deletion: null }))).deletion
      : null;
  const deletion =
    archived && owner
      ? h(
          'section.card.client-set',
          { id: 'client-deletion' },
          h('h2', 'Client deletion'),
          pending
            ? [
                h(
                  'p',
                  h('span.pill', 'Deletion requested'),
                  ' ',
                  pending.executeAfter
                    ? `Scheduled for ${longDate(pending.executeAfter)}.`
                    : 'Deletion requested. The date shows here once it is confirmed.',
                ),
                h(
                  'p.muted',
                  'Until then the client stays archived and readable. You can cancel at any time.',
                ),
                button('Cancel deletion', {
                  variant: 'secondary',
                  onclick: (e) =>
                    busy(e.currentTarget, async () => {
                      try {
                        await api(`/api/app/lifecycle/clients/${d.id}/deletion-cancel`, {
                          method: 'POST',
                        });
                        toast(`Deletion cancelled. ${d.name} stays archived.`);
                        await ctx.refresh();
                      } catch (err) {
                        errorToast(err);
                      }
                    }),
                }),
              ]
            : [
                h(
                  'p.muted',
                  'This deletes the client with its questions, scans, answers, fixes and saved reports. Until then you can cancel. Shared members lose this client when it is deleted. Backups are overwritten in the normal backup cycle.',
                ),
                button('Request client deletion', {
                  variant: 'secondary',
                  onclick: (e) => confirmDeletion(e.currentTarget, d, ctx),
                }),
              ],
        )
      : null;
  clear(el, h('div.grid-2.align-start', details, h('div.stack', weekly, archive, deletion)));
}
