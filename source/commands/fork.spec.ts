import React from 'react';
import test from 'ava';
import {sessionManager} from '@/session/session-manager';
import type {Session} from '@/session/session-manager';
import type {Message} from '@/types/core';
import type {CommandContext} from '@/types/commands';
import {forkCommand} from './fork.js';

const parent: Session = {
	id: '11111111-1111-4111-8111-111111111111',
	title: 'Original',
	createdAt: new Date().toISOString(),
	lastAccessedAt: new Date().toISOString(),
	messageCount: 1,
	provider: 'test',
	model: 'test',
	workingDirectory: '/tmp',
	messages: [{role: 'user', content: 'hello'}],
};

const child: Session = {
	...parent,
	id: '22222222-2222-4222-8222-222222222222',
	title: 'Original (fork)',
	parentId: parent.id,
};

function makeContext(
	overrides: {
		messages?: Message[];
		argText?: string;
		sessionId?: string;
		resumeSession?: (
			session: Session,
			action?: 'resume' | 'fork',
		) => void | Promise<void>;
	} = {},
): {context: CommandContext; queue: React.ReactNode[]} {
	const queue: React.ReactNode[] = [];
	const context: CommandContext = {
		args: overrides.argText ? overrides.argText.split(/\s+/) : [],
		argText: overrides.argText ?? '',
		rawArgs: overrides.argText ? overrides.argText.split(/\s+/) : [],
		handlerMetadata: () => ({
			provider: parent.provider,
			model: parent.model,
			tokens: 0,
			getMessageTokens: () => 0,
			sessionId: overrides.sessionId ?? parent.id,
		}),
		messages: overrides.messages ?? [],
		setMessages: () => {},
		provider: parent.provider,
		model: parent.model,
		client: null,
		providerConfig: null,
		addToChatQueue: node => queue.push(node),
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
		resumeSession: overrides.resumeSession,
		submitChatMessage: async () => {},
	};
	return {context, queue};
}

function messagesInQueue(queue: React.ReactNode[]): string[] {
	return queue.flatMap(node => {
		if (!React.isValidElement(node)) return [];
		const props = node.props as {message?: unknown};
		return typeof props.message === 'string' ? [props.message] : [];
	});
}

/** Replace the methods the command calls and restore them afterwards. */
function stubSessionManager(
	stubs: Partial<Record<keyof typeof sessionManager, unknown>>,
): () => void {
	const original = new Map<string, unknown>();
	for (const [key, value] of Object.entries(stubs)) {
		const manager = sessionManager as unknown as Record<string, unknown>;
		original.set(key, manager[key]);
		manager[key] = value;
	}
	return () => {
		const manager = sessionManager as unknown as Record<string, unknown>;
		for (const [key, value] of original) {
			manager[key] = value;
		}
	};
}

test.serial('fork - saves the live conversation and switches to the fork', async t => {
	const saved: Session[] = [];
	let forkArgs: {id: string; title?: string} | null = null;
	const restore = stubSessionManager({
		initialize: async () => {},
		readSession: async (id: string) => (id === parent.id ? {...parent} : null),
		saveSession: async (session: Session) => {
			saved.push(session);
		},
		forkSession: async (id: string, options?: {title?: string}) => {
			forkArgs = {id, title: options?.title};
			return child;
		},
	});
	try {
		let resumed: Session | null = null;
		let action: string | undefined;
		const {context} = makeContext({
			messages: parent.messages,
			resumeSession: (session, resumedAction) => {
				resumed = session;
				action = resumedAction;
			},
		});

		t.is(await forkCommand.run(context), 'done');
		t.is(saved.length, 1, 'the live conversation is written before forking');
		t.deepEqual(saved[0].messages, parent.messages);
		t.deepEqual(forkArgs, {id: parent.id, title: undefined});
		t.is(resumed?.id, child.id);
		t.is(action, 'fork');
	} finally {
		restore();
	}
});

test.serial('fork - passes a custom title to the fork', async t => {
	let forkTitle: string | undefined;
	const restore = stubSessionManager({
		initialize: async () => {},
		readSession: async (id: string) => (id === parent.id ? {...parent} : null),
		saveSession: async () => {},
		forkSession: async (_id: string, options?: {title?: string}) => {
			forkTitle = options?.title;
			return {...child, title: 'try another way'};
		},
	});
	try {
		const {context} = makeContext({
			messages: parent.messages,
			argText: 'try another way',
			resumeSession: () => {},
		});

		t.is(await forkCommand.run(context), 'done');
		t.is(forkTitle, 'try another way');
	} finally {
		restore();
	}
});

test.serial('fork - creates the parent session when it is not on disk', async t => {
	let created: {id?: string; messages?: Message[]} | null = null;
	const restore = stubSessionManager({
		initialize: async () => {},
		readSession: async () => null,
		createSession: async (data: {
			id?: string;
			messages?: Message[];
		}) => {
			created = {id: data.id, messages: data.messages};
			return {...parent, id: data.id ?? parent.id};
		},
		forkSession: async () => child,
	});
	try {
		const {context} = makeContext({
			messages: parent.messages,
			resumeSession: () => {},
		});

		t.is(await forkCommand.run(context), 'done');
		t.deepEqual(created, {id: parent.id, messages: parent.messages});
	} finally {
		restore();
	}
});

test.serial('fork - refuses to fork an empty conversation', async t => {
	let forked = false;
	const restore = stubSessionManager({
		initialize: async () => {},
		forkSession: async () => {
			forked = true;
			return child;
		},
	});
	try {
		const {context, queue} = makeContext({resumeSession: () => {}});

		t.is(await forkCommand.run(context), 'done');
		t.false(forked);
		t.true(
			messagesInQueue(queue).some(message =>
				message.includes('Nothing to fork yet'),
			),
		);
	} finally {
		restore();
	}
});

test.serial('fork - rejects an over-long title', async t => {
	let forked = false;
	const restore = stubSessionManager({
		initialize: async () => {},
		forkSession: async () => {
			forked = true;
			return child;
		},
	});
	try {
		const {context, queue} = makeContext({
			messages: parent.messages,
			argText: 'x'.repeat(101),
			resumeSession: () => {},
		});

		t.is(await forkCommand.run(context), 'done');
		t.false(forked);
		t.true(
			messagesInQueue(queue).some(message =>
				message.includes('100 characters or less'),
			),
		);
	} finally {
		restore();
	}
});

test.serial('fork - reports when the session to fork is gone', async t => {
	const restore = stubSessionManager({
		initialize: async () => {},
		readSession: async () => null,
		createSession: async () => parent,
		forkSession: async () => null,
	});
	try {
		const {context, queue} = makeContext({
			messages: parent.messages,
			resumeSession: () => {},
		});

		t.is(await forkCommand.run(context), 'done');
		t.true(
			messagesInQueue(queue).some(message =>
				message.includes('Session to fork was not found'),
			),
		);
	} finally {
		restore();
	}
});

test.serial('fork - reports a failure to save or fork', async t => {
	const restore = stubSessionManager({
		initialize: async () => {},
		readSession: async () => {
			throw new Error('disk on fire');
		},
	});
	try {
		const {context, queue} = makeContext({
			messages: parent.messages,
			resumeSession: () => {},
		});

		t.is(await forkCommand.run(context), 'done');
		t.true(
			messagesInQueue(queue).some(message =>
				message.includes('Failed to fork session: disk on fire'),
			),
		);
	} finally {
		restore();
	}
});

test.serial('fork - explains when sessions are unavailable', async t => {
	const {context, queue} = makeContext({messages: parent.messages});

	t.is(await forkCommand.run(context), 'done');
	t.true(
		messagesInQueue(queue).some(message =>
			message.includes('Session management is not available'),
		),
	);
});