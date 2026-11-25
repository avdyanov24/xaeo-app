import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, join, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { methodNotAllowed, notFound } from '../lib/errors.js';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

// Pages must always revalidate so a deploy shows up on the next navigation.
// Everything else is versioned with a `?v=` query in the markup, so a short cache is safe.
const HTML_CACHE = 'no-cache';
const ASSET_CACHE = 'public, max-age=300';

/**
 * Serves files from one directory. It never lists directories, never follows a path outside
 * `root` (including through symlinks) and never serves dotfiles.
 * @param {{ root: string }} options absolute path of the directory to serve
 */
export function createStaticFiles({ root }) {
  // Resolved on first use so building the handler never touches the disk.
  let rootReal;

  /** Maps a URL pathname to a file below `root`, or null when the path is not allowed. */
  async function resolve(pathname) {
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return null;
    }
    if (decoded.includes('\0') || decoded.includes('\\')) return null;

    const segments = decoded.split('/').filter(Boolean);
    // Rejecting every dot-prefixed segment covers `..`, `.env`, `.git` and friends in one rule.
    if (segments.length === 0 || segments.some((segment) => segment.startsWith('.'))) return null;

    try {
      const base = await (rootReal ??= realpath(root));
      const file = await realpath(join(base, ...segments));
      if (!file.startsWith(base + sep)) return null;
      const info = await stat(file);
      return info.isFile() ? { file, info } : null;
    } catch {
      return null;
    }
  }

  /**
   * Sends the file at `pathname` (relative to `root`) for a GET or HEAD request.
   * Throws a 404 for anything that is missing or not allowed, a 405 for other methods.
   */
  async function serve(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw methodNotAllowed(['GET', 'HEAD']);
    const found = await resolve(pathname);
    if (!found) throw notFound();

    const { file, info } = found;
    const type = CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
    // A weak ETag from size and mtime is enough here: files only change on deploy.
    const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
    const headers = {
      'Content-Type': type,
      'Cache-Control': type.startsWith('text/html') ? HTML_CACHE : ASSET_CACHE,
      ETag: etag,
      'Last-Modified': info.mtime.toUTCString(),
    };

    const candidates = (req.headers['if-none-match'] ?? '').split(',').map((v) => v.trim());
    if (candidates.includes(etag)) {
      res.writeHead(304, headers).end();
      return;
    }

    res.writeHead(200, { ...headers, 'Content-Length': info.size });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    await pipeline(createReadStream(file), res);
  }

  return { serve };
}
