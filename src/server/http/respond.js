const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

export function setSecurityHeaders(res) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
}

/** Sends `body` as JSON. API responses are never cached. */
export function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(res.req?.method === 'HEAD' ? undefined : payload);
}

/** Sends the standard error envelope: `{ error: { code, message, ...details } }`. */
export function sendError(res, status, code, message, details) {
  const headers = status === 405 && details?.allowed ? { Allow: details.allowed.join(', ') } : {};
  sendJson(res, status, { error: { code, message, ...details } }, headers);
}

/** Sends a 302 redirect. The browser must not cache it, because where `/` leads can change. */
export function sendRedirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' }).end();
}
