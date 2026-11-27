import * as answers from '../repositories/answer-repository.js';
import * as scans from '../repositories/scan-repository.js';
import { ENGINES } from './engines/engine.js';
import { compareScans, competitorsOf, kpisOf, sourcesOf } from './overview-metrics.js';
import { compareToPrevious, describeConfiguration } from './scan-comparison.js';

/** Scans in these states hold answers worth charting; a queued or running scan is reported as `running`. */
const FINISHED_STATES = ['done', 'cancelled'];

/** The overview does arithmetic on times (fix markers on the chart), so it reads milliseconds. */
const toMs = (iso) => (iso ? Date.parse(iso) : null);

/** Answers that came back, how many of those name the client, and how many failed. */
function totalsOf(rows) {
  const ok = rows.filter((row) => row.status === 'ok');
  return {
    ok: ok.length,
    mentioned: ok.filter((row) => row.mentioned).length,
    failed: rows.length - ok.length,
  };
}

/** What the overview shows when there is no finished scan yet: every engine listed, nothing counted. */
const EMPTY = Object.freeze({
  kpis: null,
  comparison: null,
  changes: { gained: [], lost: [] },
  competitors: [],
  sources: [],
  failed: 0,
  skipped: 0,
  latestScanId: null,
  latestConfiguration: null,
  comparisonAvailability: null,
});

/**
 * Everything the client overview page reads beyond the client's own details: the scans to plot,
 * the result tiles, per-engine totals, rivals, sources, what changed since the scan before and the
 * fix the page suggests next. Every method takes the workspace id first.
 * @param {{ db: import('node:sqlite').DatabaseSync, fixService: ReturnType<import('./fixes/fix-service.js').createFixService> }} deps
 */
export function createClientOverview({ db, fixService }) {
  return {
    /**
     * Adds the overview fields to a client's detail.
     * @param {number} workspaceId
     * @param {object} detail what `clientService.get` returned
     * @returns {object} the detail with `scans` finished and oldest first, `latest` and every scan
     *   timed in milliseconds, and the overview fields
     */
    extend(workspaceId, detail) {
      const finished = scans
        .listScans(db, workspaceId, detail.id)
        .filter((scan) => FINISHED_STATES.includes(scan.state))
        .reverse();
      const rowsByScan = answers.listAnswersByScans(
        db,
        workspaceId,
        finished.map((scan) => scan.id),
      );
      const rowsOf = (scan) => rowsByScan.get(scan.id) ?? [];
      const plotted = finished.map((scan, index) => ({
        ...scan,
        ...totalsOf(rowsOf(scan)),
        finishedAt: toMs(scan.finishedAt),
        comparisonToPrevious: compareToPrevious(
          rowsOf(scan),
          index ? rowsOf(finished[index - 1]) : undefined,
        ),
      }));

      const { fixes, estimate } = fixService.list(workspaceId, detail.id);
      const base = {
        ...detail,
        scans: plotted,
        estimate,
        topFix: fixes.find((fix) => fix.status === 'todo') ?? null,
        doneMarkers: fixes
          .filter((fix) => fix.status === 'done' && fix.doneAt)
          .map((fix) => ({ doneAt: toMs(fix.doneAt), title: fix.title })),
      };

      const done = finished.filter((scan) => scan.state === 'done');
      const latest = done.at(-1);
      const engineTotals = new Map(
        latest
          ? answers.scanEngineTotals(db, workspaceId, latest.id).map((e) => [e.engine, e])
          : [],
      );
      const engines = Object.values(ENGINES).map(({ id, name }) => ({
        id,
        name,
        ok: engineTotals.get(id)?.ok ?? 0,
        mentioned: engineTotals.get(id)?.mentioned ?? 0,
      }));
      if (!latest) return { ...base, ...EMPTY, engines };

      const rows = rowsOf(latest);
      const previousRows = done.length > 1 ? rowsOf(done.at(-2)) : undefined;
      const availability = compareToPrevious(rows, previousRows);
      const compared = previousRows ? compareScans(rows, previousRows) : null;
      return {
        ...base,
        engines,
        latest: { ...detail.latest, finishedAt: toMs(latest.finishedAt) },
        kpis: kpisOf(rows, { done: detail.fixes.done, total: detail.fixes.total }),
        comparison: compared?.comparison ?? null,
        changes: compared?.changes ?? EMPTY.changes,
        competitors: competitorsOf(rows),
        sources: sourcesOf(rows, detail.domain),
        failed: totalsOf(rows).failed,
        skipped: 0,
        latestScanId: latest.id,
        latestConfiguration: describeConfiguration(rows),
        comparisonAvailability: availability,
      };
    },
  };
}
