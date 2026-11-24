import { validationFailed } from './errors.js';

/**
 * Small declarative validator for request input.
 *
 * A schema maps field names to rules:
 *   { name: { type: 'string', required: true, min: 1, max: 120 },
 *     limit: { type: 'integer', min: 1, max: 100, default: 20 },
 *     kind: { type: 'enum', values: ['a', 'b'] } }
 *
 * Returns a new object with only the declared fields (unknown fields are dropped),
 * strings trimmed and defaults applied. Throws a 422 HttpError listing every issue.
 */
export function validate(schema, input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const output = {};
  const issues = [];

  for (const [field, rule] of Object.entries(schema)) {
    let value = source[field];
    if (typeof value === 'string' && rule.type !== 'raw') value = value.trim();

    if (value === undefined || value === null || value === '') {
      if (rule.required) issues.push({ field, message: 'is required' });
      else if (rule.default !== undefined) output[field] = rule.default;
      continue;
    }

    const issue = check(rule, value);
    if (issue) issues.push({ field, message: issue });
    else output[field] = rule.type === 'integer' ? Number(value) : value;
  }

  if (issues.length) throw validationFailed(issues);
  return output;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function check(rule, value) {
  switch (rule.type) {
    case 'string':
    case 'email':
      if (typeof value !== 'string') return 'must be a string';
      if (rule.min !== undefined && value.length < rule.min)
        return `must be at least ${rule.min} characters`;
      if (rule.max !== undefined && value.length > rule.max)
        return `must be at most ${rule.max} characters`;
      if (rule.type === 'email' && !EMAIL.test(value)) return 'must be an email address';
      if (rule.pattern && !rule.pattern.test(value)) return 'has an invalid format';
      return null;
    case 'integer': {
      const n = typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value;
      if (!Number.isInteger(n)) return 'must be an integer';
      if (rule.min !== undefined && n < rule.min) return `must be at least ${rule.min}`;
      if (rule.max !== undefined && n > rule.max) return `must be at most ${rule.max}`;
      return null;
    }
    case 'boolean':
      return typeof value === 'boolean' ? null : 'must be true or false';
    case 'enum':
      return rule.values.includes(value) ? null : `must be one of: ${rule.values.join(', ')}`;
    case 'raw':
      return null;
    default:
      throw new Error(`Unknown validation type: ${rule.type}`);
  }
}
