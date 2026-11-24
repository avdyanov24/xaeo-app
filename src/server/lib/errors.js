/**
 * Errors that carry an HTTP status and a stable machine-readable code.
 * Services throw these; the HTTP layer turns them into the JSON error envelope.
 */
export class HttpError extends Error {
  /**
   * @param {number} status HTTP status code
   * @param {string} code stable snake_case code clients can branch on
   * @param {string} message human-readable message, safe to show to users
   * @param {object} [details] optional extra fields (for example validation issues)
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export const badRequest = (message = 'The request is invalid.', details) =>
  new HttpError(400, 'bad_request', message, details);
export const validationFailed = (issues) =>
  new HttpError(422, 'validation_failed', 'Some fields are invalid.', { issues });
export const unauthorized = (message = 'Sign in to continue.') =>
  new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have access to this resource.') =>
  new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Not found.') => new HttpError(404, 'not_found', message);
export const methodNotAllowed = (allowed) =>
  new HttpError(405, 'method_not_allowed', 'Method not allowed.', { allowed });
export const conflict = (message = 'The resource already exists.') =>
  new HttpError(409, 'conflict', message);
export const payloadTooLarge = (limit) =>
  new HttpError(413, 'payload_too_large', `Request body is larger than ${limit} bytes.`);
export const unsupportedMediaType = (expected) =>
  new HttpError(415, 'unsupported_media_type', `Expected ${expected}.`);
