import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import test from 'ava';
import React from 'react';
import type {CommandContext} from '@/types/index';
import {agentsCommand} from './agents.js';
import {toolsCommand} from './tools.js';
import {SubagentLoader, getSubagentLoader} from '@/subagents/subagent-loader.js';

console.log('\ncreate-scaffold.spec.ts');

// Create a temporary directory for each test
function createTempDir(): string {
	const dir = join(tmpdir(), `nanocoder-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, {recursive: true});
	return dir;
}

function createMockOptions(overrides: Partial<{
	messages: string[];
	chatMessages: string[];
	components: unknown[];
}> = {}) {
	const components: unknown[] = overrides.components ?? [];
	const chatMessages: string[] = overrides.chatMessages ?? [];
	return {
		options: {
			onAddToChatQueue: (component: unknown) => {
				components.push(component);
			},
			onHandleChatMessage: async (msg: string) => {
				chatMessages.push(msg);
			},
			onCommandComplete: () => {},
		},
		components,
		chatMessages,
	};
}

/** The context a `/agents` or `/tools` invocation gets from the dispatcher. */
function contextFor(
	rawArgs: string[],
	options: ReturnType<typeof createMockOptions>['options'],
): CommandContext {
	return {
		rawArgs,
		messages: [],
		addToChatQueue: options.onAddToChatQueue,
		submitChatMessage: options.onHandleChatMessage,
		handlerMetadata: () => ({
			provider: 'test',
			model: 'test',
			tokens: 0,
			getMessageTokens: () => 0,
		}),
	} as unknown as CommandContext;
}

// ============================================================================
// /agents copy
// ============================================================================

test.serial('agents copy - shows error when no name provided', async t => {
	const {options, components} = createMockOptions();

	const completion = await agentsCommand.run(contextFor(['copy'], options));

	t.is(completion, 'done');
	t.is(components.length, 1);
	// Should be an ErrorMessage with usage instructions
	const el = components[0] as React.ReactElement;
	t.is(el.type.name || (el.type as any).displayName, 'ErrorMessage');
});

test.serial('agents copy - shows error for non-existent agent', async t => {
	const {options, components} = createMockOptions();

	const completion = await agentsCommand.run(contextFor(['copy', 'nonexistent-agent-xyz'], options));

	t.is(completion, 'done');
	t.is(components.length, 1);
	const el = components[0] as React.ReactElement;
	t.is(el.type.name || (el.type as any).displayName, 'ErrorMessage');
});

test.serial('agents copy - copies built-in agent to project directory', async t => {
	const tempDir = createTempDir();
	const agentsDir = join(tempDir, '.nanocoder', 'agents');
	const originalCwd = process.cwd();

	try {
		process.chdir(tempDir);

		const {options, components} = createMockOptions();

		const completion = await agentsCommand.run(contextFor(['copy', 'explore'], options));

		t.is(completion, 'done');
		t.is(components.length, 1);

		// Should have created the file
		const filePath = join(agentsDir, 'explore.md');
		t.true(existsSync(filePath), 'explore.md should exist');

		// File should contain the agent content
		const content = readFileSync(filePath, 'utf-8');
		t.true(content.includes('name: explore'), 'Should contain agent name');
		t.true(content.includes('read_file'), 'Should contain tool names');
	} finally {
		process.chdir(originalCwd);
		rmSync(tempDir, {recursive: true, force: true});
	}
});

test.serial('agents copy - shows error if file already exists', async t => {
	const tempDir = createTempDir();
	const agentsDir = join(tempDir, '.nanocoder', 'agents');
	const originalCwd = process.cwd();

	try {
		process.chdir(tempDir);

		// Pre-create the file
		mkdirSync(agentsDir, {recursive: true});
		writeFileSync(join(agentsDir, 'explore.md'), 'existing content');

		const {options, components} = createMockOptions();

		const completion = await agentsCommand.run(contextFor(['copy', 'explore'], options));

		t.is(completion, 'done');
		t.is(components.length, 1);
		const el = components[0] as React.ReactElement;
		t.is(el.type.name || (el.type as any).displayName, 'ErrorMessage');

		// Original content should be preserved
		const content = readFileSync(join(agentsDir, 'explore.md'), 'utf-8');
		t.is(content, 'existing content');
	} finally {
		process.chdir(originalCwd);
		rmSync(tempDir, {recursive: true, force: true});
	}
});

test.serial('agents - other subcommands show the read-only view without copying', async t => {
	const {options, components} = createMockOptions();

	const completion = await agentsCommand.run(contextFor(['show', 'foo'], options));

	t.true(typeof completion === 'object' && 'show' in completion);
	t.is(components.length, 0);
});

// ============================================================================
// /tools create
// ============================================================================

test.serial('tools create - shows error when no name provided', async t => {
	const {options, components} = createMockOptions();

	const completion = await toolsCommand.run(contextFor(['create'], options));

	t.is(completion, 'done');
	t.is(components.length, 1);
	const el = components[0] as React.ReactElement;
	t.is(el.type.name || (el.type as any).displayName, 'ErrorMessage');
});

test.serial('tools create - creates file and asks AI for help', async t => {
	const tempDir = createTempDir();
	const toolsDir = join(tempDir, '.nanocoder', 'tools');
	const originalCwd = process.cwd();

	try {
		process.chdir(tempDir);
		const {options, components, chatMessages} = createMockOptions();

		const completion = await toolsCommand.run(contextFor(['create', 'k8s-pods'], options));

		t.is(completion, 'handed-off', 'the design conversation completes it');
		const filePath = join(toolsDir, 'k8s-pods.md');
		t.true(existsSync(filePath));

		const content = readFileSync(filePath, 'utf-8');
		// Dashes in filenames become underscores in tool names.
		t.true(content.includes('name: k8s_pods'));
		t.true(content.includes('description:'));
		t.true(content.includes('approval: always'));

		// Should have queued a success message AND asked the AI to help.
		t.is(components.length, 1);
		t.is(chatMessages.length, 1);
		t.true(chatMessages[0]!.includes('.nanocoder/tools/k8s-pods.md'));
	} finally {
		process.chdir(originalCwd);
		rmSync(tempDir, {recursive: true, force: true});
	}
});

test.serial('tools create - rejects when file already exists', async t => {
	const tempDir = createTempDir();
	const toolsDir = join(tempDir, '.nanocoder', 'tools');
	const originalCwd = process.cwd();

	try {
		process.chdir(tempDir);
		mkdirSync(toolsDir, {recursive: true});
		writeFileSync(join(toolsDir, 'existing.md'), 'original content');

		const {options, components, chatMessages} = createMockOptions();

		const completion = await toolsCommand.run(contextFor(['create', 'existing'], options));

		t.is(completion, 'done');
		t.is(components.length, 1);
		const el = components[0] as React.ReactElement;
		t.is(el.type.name || (el.type as any).displayName, 'ErrorMessage');
		t.is(chatMessages.length, 0);

		// Original content untouched.
		t.is(readFileSync(join(toolsDir, 'existing.md'), 'utf-8'), 'original content');
	} finally {
		process.chdir(originalCwd);
		rmSync(tempDir, {recursive: true, force: true});
	}
});

test.serial('tools create - appends .md when missing', async t => {
	const tempDir = createTempDir();
	const toolsDir = join(tempDir, '.nanocoder', 'tools');
	const originalCwd = process.cwd();

	try {
		process.chdir(tempDir);
		const {options} = createMockOptions();
		await toolsCommand.run(contextFor(['create', 'mytool'], options));
		t.true(existsSync(join(toolsDir, 'mytool.md')));
	} finally {
		process.chdir(originalCwd);
		rmSync(tempDir, {recursive: true, force: true});
	}
});

test.serial('tools - other subcommands show the read-only view', async t => {
	const {options, components, chatMessages} = createMockOptions();

	for (const rawArgs of [[], ['list']]) {
		const completion = await toolsCommand.run(contextFor(rawArgs, options));
		t.true(typeof completion === 'object' && 'show' in completion);
	}
	t.is(components.length, 0);
	t.is(chatMessages.length, 0);
});
