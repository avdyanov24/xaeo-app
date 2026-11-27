import { conflict, notFound } from '../../lib/errors.js';
import * as answers from '../../repositories/answer-repository.js';
import * as clients from '../../repositories/client-repository.js';
import * as fixes from '../../repositories/fix-repository.js';
import * as scans from '../../repositories/scan-repository.js';
import { ENGINES } from '../engines/engine.js';

/** What the impact and evidence badges say when hovered. They describe how the rank is read, nothing more. */
export const DEFINITIONS = Object.freeze({
  impact: {
    High: 'Closes a gap an assistant meets on most questions about this business.',
    Medium: 'Closes a gap that matters for some of the questions.',
    Low: 'A smaller gap, worth doing after the others.',
  },
  evidence: {
    Strong: 'Two or more saved answers show the gap directly.',
    Medium: 'One saved answer shows the gap.',
    Weak: 'A judgement call: no saved answer shows it directly.',
  },
});

export const STATUSES = Object.freeze(['todo', 'done', 'wont']);

const engineName = (id) => ENGINES[id]?.name ?? id;

/** The ids go to the browser as strings: the view compares them as text and the CSV carries them as text. */
const publicId = (id) => String(id);

const evidenceItem = (answer) => ({
  id: publicId(answer.id),
  engine: engineName(answer.engine),
  question: answer.questionText,
  label: answer.label,
  position: answer.position,
});

/**
 * Fixes: the ranked list for a client, and marking one done or set aside. Every method takes the
 * workspace id first and passes it to the repositories, so one agency never reads or changes
 * another agency's fixes.
 * @param {{ db: import('node:sqlite').DatabaseSync, now?: () => number }} deps
 */
export function createFixService({ db, now = Date.now }) {
  const mustFindClient = (workspaceId, clientId) => {
    const client = clients.findClient(db, workspaceId, clientId);
    if (!client) throw notFound('Client not found.');
    return client;
  };

  const mustFindFix = (workspaceId, id) => {
    const fix = fixes.findFix(db, workspaceId, id);
    if (!fix) throw notFound('Fix not found.');
    return fix;
  };

  /**
   * The client's latest finished scan with its totals, or null before the first one. A fix is
   * "measured" once a scan finished after it was marked done.
   */
  const latestScan = (workspaceId, clientId) => {
    const scan = scans
      .listScans(db, workspaceId, clientId)
      .find((candidate) => candidate.state === 'done');
    return scan ? { ...scan, ...answers.scanTotals(db, workspaceId, scan.id) } : null;
  };

  const measuredBy = (fix, scan) =>
    Boolean(scan && fix.doneAt && Date.parse(scan.finishedAt) > Date.parse(fix.doneAt));

  /**
   * How many answers name the client now, and how many would if every fix that is still open, or
   * done but not yet measured, wins back the answers it is linked to. An estimate, never a promise.
   */
  const estimate = (list, scan) => {
    if (!scan) return null;
    const pending = list
      .filter((fix) => fix.status === 'todo' || (fix.status === 'done' && !measuredBy(fix, scan)))
      .reduce((sum, fix) => sum + fix.gain, 0);
    return {
      current: scan.mentioned,
      total: scan.ok,
      projected: Math.min(scan.ok, scan.mentioned + pending),
    };
  };

  /** One fix in the shape the Fixes view reads. */
  const present = (fix, { evidence, scan, latestAnswers }) => {
    const measured = fix.status === 'done' && measuredBy(fix, scan);
    // After a rescan, a done fix shows how the answers it was linked to read now.
    const latest = measured
      ? evidence.flatMap((linked) =>
          latestAnswers.filter(
            (answer) =>
              answer.questionId === linked.questionId &&
              answer.engine === linked.engine &&
              answer.status === 'ok',
          ),
        )
      : [];
    return {
      id: publicId(fix.id),
      kind: 'fix',
      title: fix.title,
      type: fix.type,
      status: fix.status,
      impact: fix.impact,
      evidence: fix.evidence,
      url: fix.url,
      engines: fix.engines.map(engineName),
      why: fix.why,
      code: fix.code,
      lang: fix.lang,
      verify: fix.verify,
      gain: fix.gain,
      doneAt: fix.doneAt,
      evidenceAnswers: evidence.map(evidenceItem),
      postDoneScan: measured,
      latestAnswers: latest.map(evidenceItem),
      latestReturned: latest.length,
      nowMentioned: latest.filter((answer) => answer.mentioned).length,
      // Comparing saved website observations needs observations to compare; this build collects none.
      canVerify: false,
      originalObservationId: null,
      verification: { latest: null, history: [] },
    };
  };

  /** The whole Fixes payload for a client, so a page can redraw from one response. */
  const view = (workspaceId, clientId) => {
    const list = fixes.listFixes(db, workspaceId, clientId);
    const evidenceIds = fixes.listEvidence(db, workspaceId, clientId);
    const byId = new Map(
      answers
        .listAnswersByIds(db, workspaceId, [...evidenceIds.values()].flat())
        .map((answer) => [answer.id, answer]),
    );
    const scan = latestScan(workspaceId, clientId);
    const latestAnswers =
      scan && list.some((fix) => measuredBy(fix, scan))
        ? answers.listAnswers(db, workspaceId, scan.id)
        : [];
    return {
      fixes: list.map((fix) =>
        present(fix, {
          evidence: (evidenceIds.get(fix.id) ?? []).map((id) => byId.get(id)).filter(Boolean),
          scan,
          latestAnswers,
        }),
      ),
      estimate: estimate(list, scan),
      allDone: list.length > 0 && list.every((fix) => fix.status === 'done'),
      definitions: DEFINITIONS,
    };
  };

  return {
    /** @throws 404 when the client does not exist in this workspace */
    list(workspaceId, clientId) {
      mustFindClient(workspaceId, clientId);
      return view(workspaceId, clientId);
    },

    /**
     * Marks a fix done, sets it aside or reopens it. Saying the status a fix already has changes
     * nothing, so a repeated request is safe. Done is the agency's own statement: nothing here
     * checks the client's website.
     * @returns the client's fixes, as `list` returns them
     * @throws 404 when the fix does not exist in this workspace
     */
    setStatus(workspaceId, id, status) {
      const fix = mustFindFix(workspaceId, id);
      if (fix.status !== status)
        fixes.setStatus(db, workspaceId, id, {
          status,
          doneAt: status === 'done' ? new Date(now()).toISOString() : null,
        });
      return view(workspaceId, fix.clientId);
    },

    /**
     * Comparing two saved website observations for a fix. This build saves no website observations,
     * so there is never a pair to compare and the request is refused once it is known to be valid.
     * @throws 404 when the fix does not exist in this workspace
     * @throws 409 always, for an existing fix
     */
    verify(workspaceId, id) {
      mustFindFix(workspaceId, id);
      throw conflict('This fix has no saved website observation to compare.');
    },
  };
}
