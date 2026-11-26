import { transaction } from '../../db/database.js';
import { HttpError, notFound } from '../../lib/errors.js';
import * as clients from '../../repositories/client-repository.js';
import * as approvals from '../../repositories/xo-approval-repository.js';
import * as artifacts from '../../repositories/xo-artifact-repository.js';
import * as cards from '../../repositories/xo-card-repository.js';
import * as chats from '../../repositories/xo-conversation-repository.js';
import { ENGINES } from '../engines/engine.js';
import { chatCardId, scanCard } from './cards.js';
import { composeReply, matchIntent } from './replies.js';

/** A chat closes after this many messages, so a history never grows without bound. */
export const MAX_MESSAGES = 40;
const TITLE_LENGTH = 80;

const CARD_ID = /^card-(\d+)$/;

/**
 * Xo's chat: conversations, the scripted reply to each message, the cards it adds and the
 * suggestions in the empty panel. A turn is prepared in one transaction and returned as a list of
 * stream events; the route sends them with a pause between words.
 * @param {{ db: import('node:sqlite').DatabaseSync, clientService: ReturnType<import('../client-service.js').createClientService>, artifactService: ReturnType<import('./artifact-service.js').createArtifactService>, competitors: string[] }} deps
 */
export function createChatService({ db, clientService, artifactService, competitors }) {
  const engines = Object.values(ENGINES);

  /** The client the person is looking at, else the newest active one, as the client list shows it. */
  function pickClient(workspaceId, clientId) {
    const wanted = Number.parseInt(clientId, 10);
    if (
      Number.isInteger(wanted) &&
      clients.findClient(db, workspaceId, wanted)?.archivedAt === null
    )
      return clientService.get(workspaceId, wanted);
    const [first] = clientService.list(workspaceId).clients;
    return first ?? null;
  }

  const pendingCount = (workspaceId) =>
    approvals.listApprovals(db, workspaceId, { status: 'pending' }).length;

  /** One card of a chat, drawn for this person. */
  function drawCard(session, row) {
    const workspaceId = session.workspace.id;
    if (row.kind === 'artifact')
      return artifactService.cardFor(
        session,
        artifacts.findArtifact(db, workspaceId, row.artifactId),
        chatCardId(row.id),
      );
    return scanCard(clientService.get(workspaceId, row.clientId), {
      engines,
      state: row.state,
      cardId: chatCardId(row.id),
    });
  }

  /** The words of a reply split so each piece carries the space that follows it. */
  const words = (text) => text.match(/\S+\s*/g) ?? [];

  return {
    /**
     * Stores the message and the scripted reply, makes any draft or card the reply calls for, and
     * returns the stream events in order. Nothing is streamed from here.
     * @param {{ text: string, conversationId?: number, uiState?: { clientId?: string | null } }} input
     */
    startTurn(session, { text, conversationId, uiState }) {
      const { workspace, user } = session;
      if (conversationId !== undefined) {
        const chat = chats.findConversation(db, workspace.id, user.id, conversationId);
        if (!chat) throw notFound('Chat not found.');
        if (
          chat.status === 'closed' ||
          chats.countMessages(db, workspace.id, conversationId) >= MAX_MESSAGES
        ) {
          // Closing is written before the error, so it is not undone with the turn that never ran.
          chats.closeConversation(db, workspace.id, conversationId);
          throw new HttpError(
            409,
            'conversation_closed',
            'This chat is closed. Start a new one to keep going.',
          );
        }
      }

      return transaction(db, () => {
        const id =
          conversationId ??
          chats.insertConversation(db, {
            workspaceId: workspace.id,
            userId: user.id,
            title: text.slice(0, TITLE_LENGTH),
          });

        const client = pickClient(workspace.id, uiState?.clientId);
        const reply = composeReply(matchIntent(text), {
          client,
          competitors,
          pendingApprovals: pendingCount(workspace.id),
        });
        chats.insertMessage(db, {
          workspaceId: workspace.id,
          conversationId: id,
          role: 'user',
          text,
        });
        chats.insertMessage(db, {
          workspaceId: workspace.id,
          conversationId: id,
          role: 'assistant',
          text: reply.text,
        });
        chats.touchConversation(db, workspace.id, id);

        const events = [{ event: 'start', data: { conversationId: id } }];
        reply.steps.forEach((label, n) => {
          events.push({ event: 'tool', data: { id: `step-${n}`, label, phase: 'start' } });
          events.push({ event: 'tool', data: { id: `step-${n}`, label, phase: 'end', ok: true } });
        });
        for (const delta of words(reply.text)) events.push({ event: 'text', data: { delta } });

        const made = [];
        if (reply.draft) {
          const artifactId = artifactService.createDraft(session, client, reply.draft);
          made.push(
            cards.insertCard(db, {
              workspaceId: workspace.id,
              conversationId: id,
              clientId: client.id,
              kind: 'artifact',
              artifactId,
            }),
          );
        }
        if (reply.scanCard)
          made.push(
            cards.insertCard(db, {
              workspaceId: workspace.id,
              conversationId: id,
              clientId: client.id,
              kind: 'scan',
            }),
          );
        for (const cardId of made)
          events.push({
            event: 'card',
            data: { card: drawCard(session, cards.findCard(db, workspace.id, cardId)) },
          });

        if (reply.ui) events.push({ event: 'ui', data: { hash: reply.ui } });
        if (reply.draft) events.push({ event: 'refresh', data: {} });
        events.push({ event: 'done', data: { grounding: 'workspace', stopReason: 'end_turn' } });
        return events;
      });
    },

    /** A person's chats, most recent first. */
    listConversations(session) {
      return {
        conversations: chats
          .listConversations(db, session.workspace.id, session.user.id)
          .map(({ id, title, status, updatedAt }) => ({ id, title, status, updatedAt })),
      };
    },

    /** A chat with its messages and cards, for the panel to redraw. */
    getConversation(session, id) {
      const { workspace, user } = session;
      const conversation = chats.findConversation(db, workspace.id, user.id, id);
      if (!conversation) throw notFound('Chat not found.');
      return {
        conversation: { id, title: conversation.title, status: conversation.status },
        messages: chats
          .listMessages(db, workspace.id, id)
          .map((message) => ({ ...message, answered: message.role === 'user' ? true : null })),
        cards: cards
          .listCards(db, workspace.id, id)
          .map((row) => ({ createdAt: row.createdAt, card: drawCard(session, row) })),
      };
    },

    /** The chips in the empty panel: questions worth asking now, and where waiting work is. */
    suggestions(session, { clientId } = {}) {
      const client = pickClient(session.workspace.id, clientId);
      if (!client) return { suggestions: [{ label: 'Add your first client', hash: '#/clients' }] };
      const ask = (message) => ({ label: message, message });
      const list = [
        ask(`Why is ${client.name} missing from AI answers?`),
        ask('What should I fix first?'),
        ask('Draft an llms.txt'),
      ];
      const waiting = pendingCount(session.workspace.id);
      if (waiting)
        list.unshift({
          label: `Review ${waiting} ${waiting === 1 ? 'draft' : 'drafts'}`,
          hash: '#/approvals',
        });
      return { suggestions: list };
    },

    /** Scripted replies have no allowance to count, so nothing is ever limited. */
    usage() {
      return { blocked: null, rateLimit: null };
    },

    /** "Not now" on a scan card. A card that is no longer open cannot be dismissed. */
    dismissCard(session, cardId) {
      const workspaceId = session.workspace.id;
      const id = Number(CARD_ID.exec(cardId)?.[1]);
      const row = id ? cards.findCard(db, workspaceId, id) : undefined;
      if (!row || row.kind !== 'scan') throw notFound('Card not found.');
      if (row.state !== 'open')
        throw new HttpError(409, 'card_not_open', 'This card was already answered.');
      cards.setCardState(db, workspaceId, id, 'dismissed');
      return { card: drawCard(session, { ...row, state: 'dismissed' }) };
    },
  };
}
