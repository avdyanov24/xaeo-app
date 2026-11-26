import { transaction } from '../../db/database.js';
import { HttpError, badRequest, forbidden, notFound } from '../../lib/errors.js';
import * as approvals from '../../repositories/xo-approval-repository.js';
import * as artifacts from '../../repositories/xo-artifact-repository.js';
import * as clients from '../../repositories/client-repository.js';
import { artifactCard } from './cards.js';
import { DRAFTS, approveBlocker, contentHash, fillPlaceholders } from './drafts.js';

const stale = (
  message = 'This draft changed since you opened it. Reload to see the latest version.',
) => new HttpError(409, 'stale_approval', message);

/** Where a draft's file is named after, by kind. */
const FILE = {
  jsonld: { name: 'structured-data.json', type: 'application/json; charset=utf-8' },
  llms_txt: { name: 'llms.txt', type: 'text/plain; charset=utf-8' },
  page: { name: 'page-draft.md', type: 'text/markdown; charset=utf-8' },
  outreach: { name: 'outreach.md', type: 'text/markdown; charset=utf-8' },
  fix: { name: 'fix.md', type: 'text/markdown; charset=utf-8' },
};

/**
 * Drafts, approvals and exports. Every method takes the signed-in session (`user` and the
 * `workspace` with the person's role) and scopes each read and write to that workspace. Only a
 * workspace owner decides; anyone in the workspace may edit a draft, which makes a new version and
 * asks for approval again.
 * @param {{ db: import('node:sqlite').DatabaseSync }} deps
 */
export function createArtifactService({ db }) {
  const canDecide = (session) => session.workspace.role === 'owner';

  const mustFind = (workspaceId, id) => {
    const artifact = artifacts.findArtifact(db, workspaceId, id);
    if (!artifact) throw notFound('Draft not found.');
    return artifact;
  };

  /** The card for a draft as this person sees it. */
  const cardFor = (session, artifact, cardId) => {
    const workspaceId = session.workspace.id;
    return artifactCard({
      artifact,
      approval: approvals.findApprovalForVersion(db, workspaceId, artifact.id, artifact.version),
      client: clients.findClient(db, workspaceId, artifact.clientId),
      canDecide: canDecide(session),
      cardId,
    });
  };

  const event = (session, artifact, action, actor = 'user') =>
    artifacts.insertEvent(db, {
      workspaceId: session.workspace.id,
      artifactId: artifact.id,
      action,
      version: artifact.version,
      actorType: actor,
      actorName: actor === 'user' ? session.user.name : '',
    });

  return {
    cardFor,

    /**
     * Prepares a draft for a client from its record and asks for approval. Xo is the author.
     * @param {'jsonld' | 'llms_txt'} draftName
     * @returns {number} the draft's id
     */
    createDraft(session, client, draftName) {
      const workspaceId = session.workspace.id;
      const draft = DRAFTS[draftName](client);
      return transaction(db, () => {
        const hash = contentHash(draft.code);
        const id = artifacts.insertArtifact(db, {
          ...draft,
          workspaceId,
          clientId: client.id,
          contentHash: hash,
        });
        approvals.insertApproval(db, {
          workspaceId,
          artifactId: id,
          version: 1,
          contentHash: hash,
        });
        artifacts.insertEvent(db, {
          workspaceId,
          artifactId: id,
          action: 'artifact_created',
          version: 1,
          actorType: 'xo',
        });
        artifacts.insertEvent(db, {
          workspaceId,
          artifactId: id,
          action: 'approval_requested',
          version: 1,
          actorType: 'xo',
        });
        return id;
      });
    },

    /** One draft with its versions and history, for the drawer. */
    get(session, id) {
      const artifact = mustFind(session.workspace.id, id);
      return {
        card: cardFor(session, artifact),
        versions: artifacts.listVersions(db, id),
        audit: artifacts.listEvents(db, session.workspace.id, id),
      };
    },

    /** The approvals queue. `pendingCount` counts the whole workspace, whatever the filter. */
    listApprovals(session, { status = 'pending', clientId } = {}) {
      const workspaceId = session.workspace.id;
      const rows = approvals.listApprovals(db, workspaceId, {
        status: status === 'all' ? undefined : status,
        clientId,
      });
      const client = clientId === undefined ? null : clients.findClient(db, workspaceId, clientId);
      return {
        approvals: rows.map((row) => {
          const artifact = artifacts.findArtifact(db, workspaceId, row.artifactId);
          return {
            id: row.id,
            artifactId: row.artifactId,
            status: row.status,
            kind: artifact.kind,
            title: artifact.title,
            requestedAt: row.createdAt,
            clientName: clients.findClient(db, workspaceId, artifact.clientId)?.name ?? '',
            card: cardFor(session, artifact),
          };
        }),
        pendingCount: approvals.listApprovals(db, workspaceId, { status: 'pending' }).length,
        client: client && { id: client.id, name: client.name },
      };
    },

    /**
     * Approves or rejects the request for a draft's current version. The caller sends the hash of
     * the content they reviewed; if the draft changed since, nothing is decided.
     */
    decide(session, approvalId, { decision, contentHash: reviewed }) {
      if (!canDecide(session))
        throw forbidden('Only a workspace owner can approve or reject a draft.');
      const workspaceId = session.workspace.id;
      const approval = approvals.findApproval(db, workspaceId, approvalId);
      if (!approval) throw notFound('Approval request not found.');
      const artifact = mustFind(workspaceId, approval.artifactId);
      if (approval.status !== 'pending' || approval.version !== artifact.version)
        throw stale(
          'This request was already decided or the draft was edited. Reload to see where it stands.',
        );
      if (reviewed !== approval.contentHash) throw stale();
      if (decision === 'approve') {
        const blocker = approveBlocker(artifact);
        if (blocker) throw new HttpError(409, 'approve_blocked', blocker);
      }
      const approve = decision === 'approve';
      transaction(db, () => {
        approvals.decideApproval(db, workspaceId, approvalId, {
          status: approve ? 'approved' : 'rejected',
          userId: session.user.id,
        });
        artifacts.setArtifactState(db, workspaceId, artifact.id, approve ? 'approved' : 'rejected');
        event(session, artifact, approve ? 'approved' : 'rejected');
      });
      return { card: cardFor(session, mustFind(workspaceId, artifact.id)) };
    },

    /**
     * Saves an edit as a new version: new title, new code, or values for placeholders. Earlier
     * requests for the draft go stale and a new one is opened for the new version. An edit that
     * changes nothing saves nothing.
     */
    edit(session, id, { version, title, code, fill }) {
      const workspaceId = session.workspace.id;
      const artifact = mustFind(workspaceId, id);
      if (version !== artifact.version) throw stale();
      const nextCode = fillPlaceholders(code ?? artifact.code, artifact.lang, fill ?? {});
      const nextTitle = title ?? artifact.title;
      if (nextCode === artifact.code && nextTitle === artifact.title)
        return {
          card: cardFor(session, artifact),
          artifact: { version: artifact.version },
          staleApprovalIds: [],
        };

      const staleApprovalIds = transaction(db, () => {
        const open = approvals
          .listApprovals(db, workspaceId, { status: 'pending' })
          .filter((row) => row.artifactId === id)
          .map((row) => row.id);
        approvals.markStale(db, workspaceId, id);
        const hash = contentHash(nextCode);
        const next = artifacts.addVersion(db, workspaceId, id, {
          code: nextCode,
          contentHash: hash,
          title,
        });
        approvals.insertApproval(db, {
          workspaceId,
          artifactId: id,
          version: next,
          contentHash: hash,
        });
        const saved = { ...artifact, version: next };
        event(session, saved, 'artifact_edited');
        event(session, saved, 'approval_requested');
        return open;
      });
      const saved = mustFind(workspaceId, id);
      return {
        card: cardFor(session, saved),
        artifact: { version: saved.version },
        staleApprovalIds,
      };
    },

    /**
     * Marks an approved draft as exported. Repeating it is safe: the draft stays exported and the
     * repeat is noted in its history.
     */
    apply(session, id, { approvalId }) {
      const workspaceId = session.workspace.id;
      const artifact = mustFind(workspaceId, id);
      const approval = approvals.findApproval(db, workspaceId, approvalId);
      if (
        !approval ||
        approval.artifactId !== id ||
        approval.version !== artifact.version ||
        approval.status !== 'approved'
      )
        throw stale('Only an approved version can be exported. Reload to see where it stands.');
      if (!['approved', 'applied'].includes(artifact.state)) throw stale();
      transaction(db, () => {
        event(session, artifact, artifact.state === 'applied' ? 'apply_duplicate' : 'applied');
        artifacts.setArtifactState(db, workspaceId, id, 'applied');
      });
      const card = cardFor(session, mustFind(workspaceId, id));
      return { card, downloadPath: card.artifact.downloadPath };
    },

    /** The file for an approved or exported draft. */
    download(session, id) {
      const workspaceId = session.workspace.id;
      const artifact = mustFind(workspaceId, id);
      if (!['approved', 'applied'].includes(artifact.state))
        throw badRequest('Approve the draft before downloading it.');
      const client = clients.findClient(db, workspaceId, artifact.clientId);
      const { name, type } = FILE[artifact.kind];
      const file = artifact.kind === 'llms_txt' ? name : `${client.domain}-${name}`;
      return { filename: file, type, body: artifact.code };
    },
  };
}
