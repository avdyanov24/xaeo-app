import { badRequest, notFound, unsupportedMediaType, validationFailed } from '../lib/errors.js';
import * as workspaces from '../repositories/workspace-repository.js';

/** The brand colour a workspace has until its owner picks one: the colour of the app itself. */
export const DEFAULT_BRAND_COLOR = '#1F3BFF';

/** Logos are shown on reports, so they are small files in formats every browser draws. */
export const MAX_LOGO_BYTES = 300 * 1024;
export const LOGO_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/svg+xml']);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

// An SVG is a document that can carry script, so one that could run anything in a browser is refused
// outright. The file is also served with a policy that blocks scripts, in case one is opened directly.
const ACTIVE_SVG =
  /<script|<foreignObject|<iframe|<embed|<object|javascript:|\son[a-z]+\s*=|<!ENTITY/i;

const invalidLogo = (what) => validationFailed([{ field: 'logo', message: what }]);

/**
 * Checks that the bytes really are the image type the upload claims, not only that the header says so.
 * @param {Buffer} data
 * @param {string} type the media type from the request, without parameters
 * @throws 415 for a type that is not PNG, JPEG or SVG; 422 when the bytes are not that kind of image, or empty
 */
export function checkLogo(data, type) {
  if (!LOGO_TYPES.includes(type))
    throw unsupportedMediaType('image/png, image/jpeg or image/svg+xml');
  if (data.length === 0) throw invalidLogo('is required');
  if (type === 'image/png' && !data.subarray(0, 8).equals(PNG_SIGNATURE))
    throw invalidLogo('is not a PNG image');
  if (type === 'image/jpeg' && !data.subarray(0, 3).equals(JPEG_SIGNATURE))
    throw invalidLogo('is not a JPEG image');
  if (type === 'image/svg+xml') {
    const text = data.toString('utf8');
    if (!/<svg[\s>]/i.test(text)) throw invalidLogo('is not an SVG image');
    if (ACTIVE_SVG.test(text)) throw invalidLogo('must not contain scripts or embedded content');
  }
}

/**
 * Whether the runtime knows this time zone. Only IANA names such as Europe/London, or UTC, are
 * accepted: the runtime would also take offsets like +01:00, which a weekly schedule cannot use.
 */
export function isSupportedTimezone(zone) {
  if (zone === 'UTC') return true;
  if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){1,2}$/.test(zone)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The workspace as the web app reads it. The logo is a URL, versioned so a new upload shows at once. */
export function publicWorkspace(settings) {
  const { hasLogo, logoUpdatedAt, ...rest } = settings;
  return {
    ...rest,
    logo: hasLogo ? `/api/app/brand/logo?v=${Date.parse(logoUpdatedAt)}` : null,
  };
}

/**
 * The agency's own settings: brand, logo and time zone. Every method takes the workspace id and
 * changes only that workspace. Who may call them (owners) is decided by the routes.
 * @param {{ db: import('node:sqlite').DatabaseSync, now?: () => number }} deps
 */
export function createWorkspaceService({ db, now = Date.now }) {
  const read = (id) => publicWorkspace(workspaces.findWorkspaceSettings(db, id));

  return {
    get: read,

    /** Changes the agency name and brand. @returns the workspace as `get` returns it */
    updateBrand(workspaceId, brand) {
      workspaces.updateBrand(db, workspaceId, brand);
      return read(workspaceId);
    },

    /**
     * @returns {{ timezone: string }}
     * @throws 400 for a zone the server does not know; the web app words that case on its own
     */
    setTimezone(workspaceId, timezone) {
      if (!isSupportedTimezone(timezone)) throw badRequest('That time zone is not supported.');
      workspaces.setTimezone(db, workspaceId, timezone);
      return { timezone };
    },

    /** Stores the logo after checking it. @returns the workspace as `get` returns it */
    setLogo(workspaceId, { data, type }) {
      checkLogo(data, type);
      workspaces.setLogo(db, workspaceId, { data, type, updatedAt: new Date(now()).toISOString() });
      return read(workspaceId);
    },

    removeLogo(workspaceId) {
      workspaces.clearLogo(db, workspaceId);
      return read(workspaceId);
    },

    /** @throws 404 when the workspace has no logo */
    logo(workspaceId) {
      const logo = workspaces.findLogo(db, workspaceId);
      if (!logo) throw notFound('No logo.');
      return logo;
    },
  };
}
