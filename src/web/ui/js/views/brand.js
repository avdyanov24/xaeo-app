// Agency brand (name, logo, color, website, contact line) with a live preview of the report cover, and the team and
// data cards. Both live in Settings (views/settings-page.js); #/brand redirects to Settings > Workspace and brand.
// Owners edit; members see the values read-only (docs/app.md permission matrix).
import { api, h, clear, icon, button, errorToast, toast, busy } from '../lib.js';
import { state, refreshMe } from '../main.js';
import { brandTokens, isHex } from '../brand-color.js';

const SWATCHES = [
  ['Cobalt', '#1F3BFF'],
  ['Ink', '#0A0F33'],
  ['Teal', '#0F766E'],
  ['Plum', '#6D28D9'],
  ['Forest', '#166534'],
  ['Rust', '#C2410C'],
];
const isOwner = () => state.me.user.workspaceRole === 'owner';

export function brandSection() {
  const w = state.me.workspace;
  const form = { name: w.name, color: w.color, website: w.website, contact: w.contact };
  let logo = w.logo;
  const preview = h('div.cover-preview.theme-light'); // the report is always light, so its preview is too
  const contrastNote = h('p.field-note');
  const drawPreview = () => {
    // Information, not an error: light colours are auto-corrected in reports (same hue, darker shade for text and charts).
    const t = brandTokens(form.color);
    if (!isHex(form.color))
      clear(contrastNote, icon('info', 14), ' Use a 6-digit hex color, like #1F3BFF.');
    else if (!t.corrected)
      clear(
        contrastNote,
        h('span.note-ok', icon('check', 14)),
        ` Readable on white (${t.ratio}:1). Reports use this exact color for headings and numbers.`,
      );
    else
      clear(
        contrastNote,
        icon('info', 14),
        ` Too light for text on white (${t.ratio}:1). Reports keep it for the color band and use a darker shade, ${t.ink}, for headings, numbers and charts.`,
        h('span.ink-swatch', { style: { background: t.ink }, 'aria-hidden': 'true' }),
      );
    clear(
      preview,
      h('div.cover-band', { style: { background: t.brand } }),
      h(
        'div.cover-body',
        logo
          ? h('img.cover-logo', { src: logo, alt: '' })
          : h('div.cover-logo-placeholder', 'Your logo'),
        h('p.cover-kicker', { style: { color: t.ink } }, 'AI visibility report'),
        h('h3', 'Northside Plumbing'),
        h('p.muted', `Prepared by ${form.name || 'your agency'}`),
      ),
      h(
        'div.cover-foot',
        form.website || 'youragency.com',
        form.contact ? ` · ${form.contact}` : '',
      ),
    );
  };
  const previewCol = h(
    'section.brand-preview',
    { 'aria-label': 'Report cover preview' },
    h('p.eyebrow', 'Report cover preview'),
    preview,
  );
  if (!isOwner()) {
    drawPreview();
    const row = (label, value, empty) =>
      h('div.ro-row', h('dt', label), h('dd', value || h('span.muted', empty)));
    return h(
      'div.brand-layout',
      h(
        'section.card.settings-card',
        h('h3', 'Agency brand'),
        h(
          'dl.ro-list',
          row('Agency name', w.name),
          row(
            'Brand color',
            w.color
              ? h(
                  'span.ro-color',
                  h('span.ink-swatch', { style: { background: w.color }, 'aria-hidden': 'true' }),
                  w.color,
                )
              : null,
            'Not set',
          ),
          row('Logo', w.logo ? 'Uploaded' : null, 'No logo yet'),
          row('Website', w.website, 'No website added yet'),
          row('Contact line', w.contact, 'No contact line added yet'),
        ),
        h(
          'p.field-note',
          icon('lock', 14),
          ' Only the workspace owner can change the agency name, logo, color or contact details.',
        ),
      ),
      previewCol,
    );
  }
  const input = (key, props) =>
    h('input', {
      value: form[key] || '',
      oninput: (e) => {
        form[key] = e.target.value;
        drawPreview();
      },
      ...props,
    });
  const colorPicker = h('input', {
    type: 'color',
    value: form.color,
    'aria-label': 'Pick a color',
    oninput: (e) => {
      form.color = e.target.value.toUpperCase();
      hex.value = form.color;
      drawPreview();
    },
  });
  const hex = h('input.hex', {
    value: form.color,
    maxlength: 7,
    'aria-label': 'Color hex code',
    oninput: (e) => {
      form.color = e.target.value;
      if (/^#[0-9a-f]{6}$/i.test(form.color)) colorPicker.value = form.color;
      drawPreview();
    },
  });
  const upload = async (f) => {
    if (!f) return;
    if (!['image/png', 'image/jpeg', 'image/svg+xml'].includes(f.type))
      return errorToast(new Error('Upload a PNG, JPG or SVG'));
    if (f.size > 300 * 1024) return errorToast(new Error('Use a logo under 300 KB'));
    try {
      const me = await api('/api/app/brand/logo', { method: 'POST', raw: f, type: f.type });
      logo = me.workspace.logo;
      await refreshMe(true);
      drawPreview();
      drawLogo();
      toast('Logo uploaded', { pose: 'happy' });
    } catch (err) {
      errorToast(err);
    }
  };
  const file = h('input', {
    type: 'file',
    accept: 'image/png,image/jpeg,image/svg+xml',
    hidden: true,
    onchange: async (e) => {
      await upload(e.target.files[0]);
      e.target.value = '';
    },
  });
  // Drop a logo straight onto the box.
  const logoBox = h('div.logo-box', {
    ondragover: (e) => {
      e.preventDefault();
      logoBox.classList.add('drag');
    },
    ondragleave: () => logoBox.classList.remove('drag'),
    ondrop: (e) => {
      e.preventDefault();
      logoBox.classList.remove('drag');
      upload(e.dataTransfer.files[0]);
    },
  });
  const drawLogo = () =>
    clear(
      logoBox,
      logo
        ? h('img', { src: logo, alt: 'Current logo' })
        : h(
            'span.logo-empty',
            icon('upload', 20),
            h('span', h('strong', 'Drop your logo here'), h('span.muted', ' or upload it')),
          ),
      h(
        'div.row',
        button(
          logo ? 'Replace logo' : 'Upload logo',
          { variant: 'secondary', size: 'sm', onclick: () => file.click() },
          'plus',
        ),
        logo
          ? button('Remove', {
              variant: 'ghost',
              size: 'sm',
              onclick: async () => {
                try {
                  await api('/api/app/brand/logo/delete', { method: 'POST' });
                  logo = null;
                  await refreshMe(true);
                  drawPreview();
                  drawLogo();
                } catch (err) {
                  errorToast(err);
                }
              },
            })
          : null,
      ),
      file,
    );
  drawLogo();
  drawPreview();
  const field = (label, control, note) =>
    h(
      'label.field',
      h('span.field-label', label),
      control,
      note ? (typeof note === 'string' ? h('span.field-note', note) : note) : null,
    );
  return h(
    'div.brand-layout',
    h(
      'form.card.form-card.settings-card',
      {
        dataset: { tour: 'brand-form' },
        'aria-labelledby': 'brand-form-title',
        onsubmit: (e) => {
          e.preventDefault();
          busy(e.target.querySelector('button[type=submit]'), async () => {
            try {
              await api('/api/app/brand', { method: 'POST', data: form });
              await refreshMe(true);
              toast('Saved');
            } catch (err) {
              errorToast(err);
            }
          });
        },
      },
      h('h3#brand-form-title', 'Agency brand'),
      field('Agency name', input('name', { required: true, maxlength: 100 })),
      h(
        'div.field',
        h('span.field-label', 'Logo'),
        logoBox,
        h(
          'span.field-note',
          'PNG, JPG or SVG, up to 300 KB. A wide logo on a transparent background works best.',
        ),
      ),
      field(
        'Brand color',
        h(
          'div.color-row',
          colorPicker,
          hex,
          h(
            'div.swatches',
            { role: 'group', 'aria-label': 'Suggested colors' },
            SWATCHES.map(([name, c]) =>
              h('button.swatch', {
                type: 'button',
                title: name,
                'aria-label': `Use ${name}`,
                style: { background: c },
                onclick: () => {
                  form.color = c;
                  hex.value = c;
                  colorPicker.value = c;
                  drawPreview();
                },
              }),
            ),
          ),
        ),
        contrastNote,
      ),
      field(
        'Website',
        input('website', { placeholder: 'e.g. brightline.digital', maxlength: 253 }),
        'Shown in the footer of every report page.',
      ),
      field(
        'Contact line',
        input('contact', {
          placeholder: 'e.g. hello@brightline.digital · 0113 496 0000',
          maxlength: 160,
        }),
        'Shown at the end of every report.',
      ),
      h('div.form-actions', h('button.btn', { type: 'submit' }, 'Save brand')),
    ),
    previewCol,
  );
}

// Team and data: the team page (read-only for members), the account export and, for owners, the workspace export.
export function dataSection() {
  const owner = isOwner();
  return [
    h(
      'section.card.settings-card.data-card',
      h('h3', 'Team'),
      h(
        'p.muted',
        owner
          ? 'Invite people, change roles and see invitation history.'
          : 'See who is in this workspace. The owner manages invitations and roles.',
      ),
      h(
        'a.btn.btn-secondary',
        { href: '/team' },
        icon('users'),
        owner ? 'Manage team' : 'View team',
      ),
    ),
    owner
      ? h(
          'section.card.settings-card.data-card',
          h('h3', 'Workspace data'),
          h(
            'p.muted',
            'Download this workspace’s branding, team directory, clients, questions, scans, answers, fixes and saved reports. Passwords and session tokens are excluded.',
          ),
          h(
            'a.btn.btn-secondary',
            { href: '/api/app/export', download: 'xaeo-workspace-export.json' },
            icon('download'),
            'Download workspace JSON',
          ),
        )
      : null,
    h(
      'section.card.settings-card.data-card',
      h('h3', 'Your account data'),
      h(
        'p.muted',
        'Download your account details, saved briefs, access request and workspace memberships. Other members’ private details and login secrets are excluded.',
      ),
      h(
        'div.row',
        h(
          'a.btn.btn-secondary',
          { href: '/api/account/export', download: 'xaeo-account-export.json' },
          icon('download'),
          'Download account JSON',
        ),
        h(
          'a.btn.btn-ghost',
          { href: '/account#delete' },
          'Account and data settings',
          icon('chevronRight', 16),
        ),
      ),
    ),
  ];
}
