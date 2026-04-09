import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import test from 'ava';
import React from 'react';
import {handleAgentCopy} from './create-handler.js';
import {SubagentLoader, getSubagentLoader} from '@/subagents/subagent-loader.js';

console.log('\ncreate-handler.spec.ts');

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
	let keyCounter = 0;

	return {
		options: {
			onAddToChatQueue: (component: unknown) => {
				components.push(component);
			},
			onHandleChatMessage: async (msg: string) => {
				chatMessages.push(msg);
			},
			onCommandComplete: () => {},
			getNextComponentKey: () => keyCounter++,
		},
		components,
		chatMessages,
	};
}

// ============================================================================
// /agents copy
// ============================================================================

test.serial('agents copy - shows error when no name provided', async t => {
	const {options, components} = createMockOptions();

	const handled = await handleAgentCopy(
		['agents', 'copy'],
		options as any,
	);

	t.true(handled);
	t.is(components.length, 1);
	// Should be an ErrorMessage with usage instructions
	const el = components[0] as React.ReactElement;
	t.is(el.type.name || (el.type as any).displayName, 'ErrorMessage');
});

test.serial('agents copy - shows error for non-existent agent', async t => {
	const {options, components} = createMockOptions();

	const handled = await handleAgentCopy(
		['agents', 'copy', 'nonexistent-agent-xyz'],
		options as any,
	);

	t.true(handled);
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

		const handled = await handleAgentCopy(
			['agents', 'copy', 'explore'],
			options as any,
		);

		t.true(handled);
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

		const handled = await handleAgentCopy(
			['agents', 'copy', 'explore'],
			options as any,
		);

		t.true(handled);
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

test.serial('agents copy - does not handle non-copy commands', async t => {
	const {options} = createMockOptions();

	t.false(await handleAgentCopy(['agents', 'create', 'foo'], options as any));
	t.false(await handleAgentCopy(['agents', 'show', 'foo'], options as any));
	t.false(await handleAgentCopy(['other', 'copy', 'foo'], options as any));
});
