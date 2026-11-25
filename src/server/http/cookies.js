/**
 * Parses a Cookie request header into a plain object. Malformed pairs are skipped;
 * when a name repeats, the first value wins, as browsers send the most specific first.
 * @param {string | undefined} header
 * @returns {Record<string, string>}
 */
export function parseCookies(header) {
  const cookies = {};
  for (const raw of (header ?? '').split(';')) {
    const pair = raw.trim();
    const index = pair.indexOf('=');
    if (index < 1) continue;
    const name = pair.slice(0, index).trim();
    if (name in cookies) continue;
    let value = pair.slice(index + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      // A value that is not valid percent-encoding is ignored rather than failing the request.
    }
  }
  return cookies;
}

/**
 * Builds a Set-Cookie header value.
 * @param {string} name
 * @param {string} value
 * @param {{ maxAgeSeconds?: number, httpOnly?: boolean, secure?: boolean, sameSite?: 'Strict' | 'Lax' | 'None', path?: string }} [options]
 */
export function serializeCookie(name, value, options = {}) {
  const { maxAgeSeconds, httpOnly = true, secure = false, sameSite = 'Lax', path = '/' } = options;
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`];
  if (maxAgeSeconds !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`);
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  parts.push(`SameSite=${sameSite}`);
  return parts.join('; ');
}
