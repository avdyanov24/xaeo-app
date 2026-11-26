import { notFound } from '../lib/errors.js';
import * as answers from '../repositories/answer-repository.js';
import * as scans from '../repositories/scan-repository.js';
import { idParam } from './clients.js';

/** A scan with its answer totals: how many came back, how many name the client, how many failed. */
function present(db, workspaceId, scan) {
  return { ...scan, ...answers.scanTotals(db, workspaceId, scan.id) };
}

/** Starting, watching, cancelling and retrying scans. */
export function registerScanRoutes(router, { sessionHttp, scanRunner, db }) {
  const route = (handler) =>
    sessionHttp.requireUser((ctx) => handler(ctx, ctx.session.workspace.id));

  router.post(
    '/api/app/clients/:id/scans',
    route((ctx, workspaceId) => ({
      status: 201,
      body: present(db, workspaceId, scanRunner.startScan(workspaceId, idParam(ctx.params))),
    })),
  );

  // The web app polls this while a scan runs to draw its progress.
  router.get(
    '/api/app/scans/:id',
    route((ctx, workspaceId) => {
      const scan = scans.findScan(db, workspaceId, idParam(ctx.params));
      if (!scan) throw notFound('Scan not found.');
      return present(db, workspaceId, scan);
    }),
  );

  router.post(
    '/api/app/scans/:id/cancel',
    route((ctx, workspaceId) =>
      present(db, workspaceId, scanRunner.cancelScan(workspaceId, idParam(ctx.params))),
    ),
  );

  router.post(
    '/api/app/scans/:id/retry',
    route((ctx, workspaceId) =>
      present(db, workspaceId, scanRunner.retryScan(workspaceId, idParam(ctx.params))),
    ),
  );
}
