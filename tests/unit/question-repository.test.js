import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { openDatabase } from '../../src/server/db/database.js';
import * as clients from '../../src/server/repositories/client-repository.js';
import * as questions from '../../src/server/repositories/question-repository.js';
import * as workspaces from '../../src/server/repositories/workspace-repository.js';

let db;
let workspaceId;
let clientId;

beforeEach(() => {
  db = openDatabase(':memory:');
  workspaceId = workspaces.insertWorkspace(db, 'Mine');
  clientId = clients.insertClient(db, { workspaceId, name: 'Acme Plumbing', domain: 'acme.test' });
});

const ask = (text, extra = {}) =>
  questions.insertQuestion(db, { workspaceId, clientId, text, ...extra });

describe('question repository', () => {
  it('defaults a new question to the find intent and switched on', () => {
    const question = questions.findQuestion(db, workspaceId, ask('Who is the best plumber?'));
    assert.equal(question.intent, 'find');
    assert.equal(question.active, true);
  });

  it('numbers positions from the highest one, so a deleted question leaves no clash', () => {
    ask('First?');
    const second = ask('Second?');
    questions.deleteQuestion(db, workspaceId, second);
    const third = questions.findQuestion(db, workspaceId, ask('Third?'));
    assert.equal(third.position, 3);
  });

  it('ignores fields that are not editable', () => {
    const id = ask('Original?');
    const changed = questions.updateQuestion(db, workspaceId, id, { position: 9, clientId: 99 });
    assert.equal(changed, true);
    const question = questions.findQuestion(db, workspaceId, id);
    assert.equal(question.position, 1);
    assert.equal(question.clientId, clientId);
  });

  it('reports a missing question when there is nothing to change', () => {
    assert.equal(questions.updateQuestion(db, workspaceId, 999, {}), false);
  });

  it('knows whether any question is switched on', () => {
    assert.equal(questions.hasActiveQuestions(db, workspaceId), false);
    const id = ask('Quiet?', { active: false });
    assert.equal(questions.hasActiveQuestions(db, workspaceId), false);
    questions.updateQuestion(db, workspaceId, id, { active: true });
    assert.equal(questions.hasActiveQuestions(db, workspaceId), true);
  });

  it('does not count deleted questions or archived clients', () => {
    const id = ask('Counted?');
    questions.deleteQuestion(db, workspaceId, id);
    assert.equal(questions.hasActiveQuestions(db, workspaceId), false);

    ask('Counted now?');
    assert.equal(questions.hasActiveQuestions(db, workspaceId), true);
    clients.setArchivedAt(db, workspaceId, clientId, '2026-11-27T10:00:00.000Z');
    assert.equal(questions.hasActiveQuestions(db, workspaceId), false);
  });

  it('does not count another workspace', () => {
    ask('Mine?');
    const other = workspaces.insertWorkspace(db, 'Theirs');
    assert.equal(questions.hasActiveQuestions(db, other), false);
  });
});
