import { approveBlocker, isWhiteLabel, placeholdersIn } from './drafts.js';

/**
 * Builds the card JSON the web app draws. `actions` only says which buttons to show; every button
 * posts to a route that checks the role and the state again.
 */

const SHIPPED = ['approved', 'applied'];

/** Cards in the approvals list are not tied to a chat, so their id comes from the draft. */
export const artifactCardId = (artifactId) => `art-${artifactId}`;
export const chatCardId = (id) => `card-${id}`;

/** Which buttons a draft offers this person, from its state and their role. */
export function artifactActions({ state, blocked, canDecide }) {
  const actions = [];
  if (state === 'pending' && canDecide) {
    if (!blocked) actions.push('approve');
    actions.push('reject');
  }
  if (SHIPPED.includes(state)) actions.push('copy', 'download');
  actions.push('edit');
  return actions;
}

/**
 * @param {{ artifact: import('../../repositories/xo-artifact-repository.js').ArtifactRow,
 *   approval?: { id: number, contentHash: string } | null,
 *   client: { id: number, name: string },
 *   canDecide: boolean, cardId?: string }} input
 */
export function artifactCard({ artifact, approval, client, canDecide, cardId }) {
  const placeholders = placeholdersIn(artifact.code);
  const blocked = approveBlocker(artifact);
  return {
    cardId: cardId ?? artifactCardId(artifact.id),
    kind: 'artifact',
    clientId: client.id,
    clientName: client.name,
    state: artifact.state,
    actions: artifactActions({ state: artifact.state, blocked, canDecide }),
    artifact: {
      artifactId: artifact.id,
      approvalId: approval?.id ?? null,
      kind: artifact.kind,
      title: artifact.title,
      summary: artifact.summary,
      targetUrl: artifact.targetUrl,
      lang: artifact.lang,
      risk: artifact.risk,
      code: artifact.code,
      version: artifact.version,
      notes: artifact.notes,
      unsupportedClaims: placeholders.length ? artifact.claims : [],
      placeholders,
      whiteLabelOk: isWhiteLabel(artifact.code),
      approveBlockedBy: blocked,
      contentHash: approval?.contentHash ?? null,
      downloadPath: SHIPPED.includes(artifact.state)
        ? `/api/app/xo/artifacts/${artifact.id}/download`
        : null,
    },
  };
}

/**
 * The card that offers to start a scan.
 * @param {{ id: number, name: string, questions: number, runningId: number | null }} client
 * @param {{ engines: { name: string }[], state: string, cardId: string }} options
 */
export function scanCard(client, { engines, state, cardId }) {
  return {
    cardId,
    kind: 'scan',
    clientId: client.id,
    clientName: client.name,
    state,
    actions: state === 'open' ? ['run_scan', 'dismiss'] : [],
    scan: {
      questions: client.questions,
      engines: engines.map(({ name }) => ({ name })),
      running: client.runningId !== null,
      dailyBudgetState: 'ok',
    },
  };
}
