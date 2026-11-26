// Scripts for the account pages (login and signup). The page says which one it is in <body data-page>.
const page = document.body.dataset.page;

const NETWORK_TEXT = 'We couldn’t reach Xaeo. Check your connection, then try again.';
const OFFLINE_TEXT = 'You seem to be offline. Check your connection, then try again.';
const SERVER_TEXT =
  'Something on our side didn’t work. Your details are still here; try again in a moment.';

/**
 * Calls the JSON API. Errors carry the server's `{ error: { code, message } }` as `status`, `code` and a message
 * written for people. Network failures and 5xx never show raw text; the form keeps its input, so submitting again
 * is the retry.
 */
async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch {
    throw Object.assign(new Error(navigator.onLine === false ? OFFLINE_TEXT : NETWORK_TEXT), {
      kind: 'network',
    });
  }
  let body;
  try {
    body = response.status === 204 ? null : await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const error = body?.error;
    const server = response.status >= 500 || !error?.message;
    throw Object.assign(new Error(server ? SERVER_TEXT : error.message), {
      status: response.status,
      code: error?.code ?? null,
      issues: error?.issues ?? [],
      retryAfter: Number(response.headers.get('retry-after')) || null,
    });
  }
  return body;
}

function showMessage(id, message, kind = 'error') {
  const node = document.getElementById(id);
  node.textContent = message;
  node.dataset.kind = kind;
}
function busy(form, value) {
  form.querySelector('button[type="submit"]').disabled = value;
}
function fieldValues(form) {
  return Object.fromEntries(new FormData(form));
}
function bindPasswordToggle() {
  const toggle = document.querySelector('[data-password-toggle]');
  const password = toggle.previousElementSibling;
  toggle.addEventListener('click', () => {
    const visible = password.type === 'password';
    password.type = visible ? 'text' : 'password';
    toggle.textContent = visible ? 'Hide' : 'Show';
    toggle.setAttribute('aria-pressed', String(visible));
    password.focus();
  });
}
/** Shakes the form once, the nudge for a wrong password. */
function shake(form) {
  form.classList.remove('shake');
  void form.offsetWidth;
  form.classList.add('shake');
  form.addEventListener('animationend', () => form.classList.remove('shake'), { once: true });
}

/**
 * Where to go after signing in. `next` is honoured only for in-app paths, so a crafted link cannot send a user
 * to another site; anything else lands on /app.
 */
function destinationAfterSignIn() {
  const next = new URLSearchParams(location.search).get('next');
  return next && /^\/app(?:#\/[A-Za-z0-9/=&_.?-]{0,120})?$/.test(next) ? next : '/app';
}

if (page === 'login') {
  const form = document.getElementById('login-form');
  const password = document.getElementById('password');
  bindPasswordToggle();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    busy(form, true);
    showMessage('login-message', '', 'normal');
    form
      .querySelectorAll('[aria-invalid]')
      .forEach((input) => input.removeAttribute('aria-invalid'));
    try {
      await api('/api/login', { method: 'POST', body: JSON.stringify(fieldValues(form)) });
      location.assign(destinationAfterSignIn());
    } catch (error) {
      const minutes = error.retryAfter ? Math.ceil(error.retryAfter / 60) : 15;
      showMessage(
        'login-message',
        error.status === 429
          ? `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
          : error.message,
      );
      busy(form, false);
      if (error.status === 401) {
        form.elements.namedItem('email').setAttribute('aria-invalid', 'true');
        password.setAttribute('aria-invalid', 'true');
        // The password is selected so a retry is one keystroke.
        shake(form);
        password.focus();
        password.select();
      }
    }
  });
}

// Which input each API field belongs to, so a 422 marks the right one.
const SIGNUP_FIELDS = {
  name: 'name',
  workspaceName: 'agency-name',
  email: 'work-email',
  password: 'signup-password',
};

if (page === 'signup') {
  const form = document.getElementById('signup-form');
  bindPasswordToggle();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage('signup-message', '', 'normal');
    form
      .querySelectorAll('[aria-invalid]')
      .forEach((input) => input.removeAttribute('aria-invalid'));
    const password = form.elements.namedItem('password');
    const confirm = form.elements.namedItem('confirmPassword');
    if (password.value !== confirm.value) {
      confirm.setAttribute('aria-invalid', 'true');
      showMessage('signup-message', 'Passwords do not match.');
      confirm.focus();
      return;
    }
    busy(form, true);
    try {
      const values = fieldValues(form);
      delete values.confirmPassword;
      await api('/api/signup', { method: 'POST', body: JSON.stringify(values) });
      location.assign('/app');
    } catch (error) {
      const inputs = error.issues
        .map((issue) => document.getElementById(SIGNUP_FIELDS[issue.field]))
        .filter(Boolean);
      inputs.forEach((input) => input.setAttribute('aria-invalid', 'true'));
      const text =
        error.status === 409
          ? 'An account with this email already exists. Log in instead.'
          : error.issues.length
            ? `${document.querySelector(`label[for="${inputs[0]?.id}"]`)?.textContent ?? 'A field'} ${error.issues[0].message}.`
            : error.message;
      showMessage('signup-message', text);
      inputs[0]?.focus();
      busy(form, false);
    }
  });
}

// Required and format checks use the designed inline error (the field's edge and the form's status line), not the
// browser's bubble. One capture-phase gate runs before each page's own submit handler and stops it when a field fails.
function fieldProblem(input) {
  const label = (
    document.querySelector(`label[for="${input.id}"]`)?.textContent || 'this field'
  ).trim();
  const name = label.toLowerCase().replace(/^your /, '');
  const validity = input.validity;
  const confirm = /^confirm /.test(name);
  if (validity.valueMissing) {
    if (confirm) return `Confirm your ${name.slice(8)}.`;
    if (input.autocomplete === 'new-password') return 'Choose a password.';
    return `Enter your ${name}.`;
  }
  if (validity.typeMismatch && input.type === 'email')
    return 'Enter a full email address, like name@agency.com.';
  if (validity.tooShort)
    return confirm
      ? 'Type the same password again to confirm it.'
      : `${label} needs at least ${input.minLength} characters.`;
  return input.validationMessage;
}

document.querySelectorAll('form').forEach((form) => {
  form.noValidate = true;
  form.addEventListener('input', (event) => {
    if (event.target.dataset.gate) {
      event.target.removeAttribute('aria-invalid');
      delete event.target.dataset.gate;
    }
  });
});

document.addEventListener(
  'submit',
  (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    form.querySelectorAll('[data-gate]').forEach((el) => {
      el.removeAttribute('aria-invalid');
      delete el.dataset.gate;
    });
    const invalid = [...form.elements].filter((el) => el.willValidate && !el.checkValidity());
    if (!invalid.length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    invalid.forEach((el) => {
      el.setAttribute('aria-invalid', 'true');
      el.dataset.gate = '1';
    });
    const status = form.querySelector('.form-message[id]');
    if (status) showMessage(status.id, fieldProblem(invalid[0]));
    invalid[0].focus();
  },
  true,
);
