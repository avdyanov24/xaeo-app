import { badRequest, payloadTooLarge, unsupportedMediaType } from '../lib/errors.js';

export const DEFAULT_BODY_LIMIT = 100 * 1024;

/**
 * Reads a request body into one Buffer, stopping with 413 as soon as it is over `limit` bytes, by
 * the declared length or by what actually arrives. An empty body is an empty Buffer.
 * @param {import('node:http').IncomingMessage} req
 * @param {{ limit?: number }} [options]
 */
export async function readBuffer(req, { limit = DEFAULT_BODY_LIMIT } = {}) {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > limit) throw payloadTooLarge(limit);

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw payloadTooLarge(limit);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Reads a JSON request body with a size limit. An empty body reads as `{}`.
 * @param {import('node:http').IncomingMessage} req
 * @param {{ limit?: number }} [options]
 */
export async function readJson(req, { limit = DEFAULT_BODY_LIMIT } = {}) {
  const body = await readBuffer(req, { limit });
  if (body.length === 0) return {};
  const type = req.headers['content-type'] ?? '';
  if (!type.toLowerCase().startsWith('application/json'))
    throw unsupportedMediaType('application/json');

  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw badRequest('Request body is not valid JSON.');
  }
}
