import test from 'ava';
import type {
	Session,
	SessionMetadata,
} from '@/session/session-manager';
import {sessionManager} from '@/session/session-manager';
import type {CommandContext} from '@/types/index';
import {resumeCommand} from './resume';

console.log('\nresume.spec.ts');

const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const metadata: SessionMetadata = {
	id: sessionId,
	title: 'Pasted secrets',
	createdAt: '2026-01-01T00:00:00.000Z',
	lastAccessedAt: '2026-01-02T00:00:00.000Z',
	messageCount: 2,
	provider: 'test',
	model: 'test',
	workingDirectory: process.cwd(),
};

const session: Session = {...metadata, messages: []};

interface Calls {
	queue: unknown[];
	selector: boolean[];
	resumed: Session[];
	deleted: string[];
	pinned: Array<[string, boolean]>;
}

function makeContext(argText: string, calls: Calls): CommandContext {
	const args = argText ? argText.split(/\s+/) : [];
	return {
		args,
		argText,
		rawArgs: args,
		handlerMetadata: () => ({
			provider: 'test',
			model: 'test',
			tokens: 0,
			getMessageTokens: () => 0,
		}),
		messages: [],
		setMessages: () => {},
		provider: 'test',
		model: 'test',
		client: null,
		providerConfig: null,
		addToChatQueue: component => calls.queue.push(component),
		setLiveComponent: () => {},
		setLiveComponentCapturesInput: () => {},
		setIsToolExecuting: () => {},
		clearMessages: async () => {},
		notifyCleared: () => {},
		renameSession: () => {},
		showStatus: () => {},
		enterModelSelectionMode: () => {},
		enterModelDatabaseMode: () => {},
		enterSettingsMode: () => {},
		enterExplorerMode: () => {},
		enterIdeSelectionMode: () => {},
		enterTune: () => {},
		enterCheckpointLoadMode: () => {},
		enterSessionSelectorMode: showAll => calls.selector.push(showAll ?? false),
		resumeSession: async resumed => {
			calls.resumed.push(resumed);
		},
		deleteSession: async id => {
			calls.deleted.push(id);
		},
		setSessionPinned: async (id, pinned) => {
			calls.pinned.push([id, pinned]);
		},
		submitChatMessage: async () => {},
	};
}

function makeCalls(): Calls {
	return {queue: [], selector: [], resumed: [], deleted: [], pinned: []};
}

function stubManager(stored: SessionMetadata | null, calls: Calls) {
	const original = {
		initialize: sessionManager.initialize,
		listSessions: sessionManager.listSessions,
		loadSession: sessionManager.loadSession,
	};
	sessionManager.initialize = async () => {};
	sessionManager.listSessions = async () => (stored ? [stored] : []);
	sessionManager.loadSession = async id =>
		stored?.id === id ? {...session, pinned: stored.pinned} : null;
	return () => Object.assign(sessionManager, original);
}

test.serial('/resume delete <index> deletes the session without resuming it', async t => {
	const calls = makeCalls();
	const restore = stubManager(metadata, calls);
	try {
		await resumeCommand.run(makeContext('delete 1', calls));
		t.deepEqual(calls.deleted, [sessionId]);
		t.deepEqual(calls.resumed, []);
		t.deepEqual(calls.queue.length, 1, 'reports the deletion in chat');
	} finally {
		restore();
	}
});

test.serial('/resume pin <id> toggles the pin without resuming it', async t => {
	const calls = makeCalls();
	const restore = stubManager(metadata, calls);
	try {
		await resumeCommand.run(makeContext(`pin ${sessionId}`, calls));
		t.deepEqual(calls.pinned, [[sessionId, true]]);
		t.deepEqual(calls.resumed, []);
	} finally {
		restore();
	}
});

test.serial('/resume pin unpins an already pinned session', async t => {
	const calls = makeCalls();
	const restore = stubManager({...metadata, pinned: true}, calls);
	try {
		await resumeCommand.run(makeContext('pin 1', calls));
		t.deepEqual(calls.pinned, [[sessionId, false]]);
	} finally {
		restore();
	}
});

test.serial('/resume delete without a target reports usage', async t => {
	const calls = makeCalls();
	const restore = stubManager(metadata, calls);
	try {
		await resumeCommand.run(makeContext('delete', calls));
		t.deepEqual(calls.deleted, []);
		t.deepEqual(calls.queue.length, 1);
	} finally {
		restore();
	}
});

test.serial('/resume still resumes by index when no action is given', async t => {
	const calls = makeCalls();
	const restore = stubManager(metadata, calls);
	try {
		await resumeCommand.run(makeContext('1', calls));
		t.is(calls.resumed.length, 1);
		t.is(calls.resumed[0]?.id, sessionId);
		t.deepEqual(calls.deleted, []);
		t.deepEqual(calls.pinned, []);
	} finally {
		restore();
	}
});
