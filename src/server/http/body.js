import { badRequest, payloadTooLarge, unsupportedMediaType } from '../lib/errors.js';

export const DEFAULT_BODY_LIMIT = 100 * 1024;

/**
 * Reads a JSON request body with a size limit. An empty body reads as `{}`.
 * @param {import('node:http').IncomingMessage} req
 * @param {{ limit?: number }} [options]
 */
export async function readJson(req, { limit = DEFAULT_BODY_LIMIT } = {}) {
  const type = req.headers['content-type'] ?? '';
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > limit) throw payloadTooLarge(limit);

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw payloadTooLarge(limit);
    chunks.push(chunk);
  }
  if (size === 0) return {};
  if (!type.toLowerCase().startsWith('application/json'))
    throw unsupportedMediaType('application/json');

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw badRequest('Request body is not valid JSON.');
  }
}
