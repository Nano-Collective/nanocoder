import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import React from 'react';
import {reloadAppConfig} from '@/config/index';
import {setProjectRoot} from '@/services/session-cwd';
import type {HooksConfig} from '@/types/config';
import {runStreamingBashTool} from './streaming-bash-tool';

test('runStreamingBashTool propagates AbortSignal to underlying bash execution', async t => {
	const controller = new AbortController();
	
	const toolCall = {
		id: 'call_123',
		type: 'function',
		function: {
			name: 'execute_bash',
			arguments: '{"command":"sleep 10"}'
		}
	} as any;

	const setLiveComponent = () => {};

	// Abort immediately
	controller.abort();
	
	const start = Date.now();
	const result = await runStreamingBashTool(
		toolCall, 
		null, 
		setLiveComponent, 
		'test', 
		controller.signal
	);
	const elapsed = Date.now() - start;

	t.true(elapsed < 1000, 'Command should abort immediately instead of sleeping');
	t.truthy(result.bashState);
	t.is(result.bashState!.error, 'Cancelled via AbortSignal');
});

// ============================================================================
// Lifecycle hooks on the streamed bash path.
//
// The interactive TUI runs execute_bash through here rather than through
// processToolUse, so a policy hook on execute_bash would be silently skipped
// on exactly the surface where it matters most unless the gate is repeated.
// ============================================================================

const BASH_HOOK_DIR = join(tmpdir(), `nanocoder-bash-hooks-${Date.now()}`);

function enterBashHookFixture(hooks: HooksConfig): () => void {
	const previousCwd = process.cwd();
	const previousConfigDir = process.env.NANOCODER_CONFIG_DIR;
	mkdirSync(BASH_HOOK_DIR, {recursive: true});
	process.env.NANOCODER_CONFIG_DIR = join(BASH_HOOK_DIR, 'no-global-config');
	process.chdir(BASH_HOOK_DIR);
	setProjectRoot(BASH_HOOK_DIR);
	writeFileSync(
		join(BASH_HOOK_DIR, 'agents.config.json'),
		JSON.stringify({nanocoder: {hooks}}),
		'utf-8',
	);
	reloadAppConfig();
	return () => {
		process.chdir(previousCwd);
		if (previousConfigDir === undefined) {
			delete process.env.NANOCODER_CONFIG_DIR;
		} else {
			process.env.NANOCODER_CONFIG_DIR = previousConfigDir;
		}
		setProjectRoot(previousCwd);
		reloadAppConfig();
	};
}

// Portable hook body: `sh -c` on POSIX, `cmd /c` on Windows.
const bashHookNode = (script: string) => `node -e "${script}"`;

const bashCall = (command: string) =>
	({
		id: 'call_hook',
		type: 'function',
		function: {
			name: 'execute_bash',
			arguments: JSON.stringify({command}),
		},
		// biome-ignore lint/suspicious/noExplicitAny: matching the file's existing style
	}) as any;

test.serial('a pre-tool-use veto blocks a streamed bash command', async t => {
	const marker = join(BASH_HOOK_DIR, 'should-not-exist.txt');
	const leave = enterBashHookFixture({
		'pre-tool-use': [
			{
				name: 'no-push',
				matchTools: ['execute_bash'],
				command: bashHookNode(
					"console.log('pushing to main is not allowed');process.exit(1)",
				),
			},
		],
	});

	let result: Awaited<ReturnType<typeof runStreamingBashTool>>;
	try {
		result = await runStreamingBashTool(
			bashCall(`node -e "require('fs').writeFileSync('${'should-not-exist.txt'}','x')"`),
			null,
			() => {},
			'test',
		);
	} finally {
		leave();
	}

	t.is(
		result.result.content,
		'Error: Blocked by hook "no-push": pushing to main is not allowed',
	);
	t.true(result.result.isError);
	t.falsy(result.bashState, 'the command must never have run');
	t.false(existsSync(marker), 'and it must not have had any effect');
});

test.serial('NANOCODER_COMMAND reaches a streamed bash hook', async t => {
	const leave = enterBashHookFixture({
		'pre-tool-use': [
			{
				matchTools: ['execute_bash'],
				command: bashHookNode(
					"process.exit(process.env.NANOCODER_COMMAND === 'echo hooked' ? 1 : 0)",
				),
			},
		],
	});

	let result: Awaited<ReturnType<typeof runStreamingBashTool>>;
	try {
		result = await runStreamingBashTool(
			bashCall('echo hooked'),
			null,
			() => {},
			'test',
		);
	} finally {
		leave();
	}

	// The hook only vetoes when it saw the exact command, so a block here is
	// the assertion that NANOCODER_COMMAND arrived intact.
	t.true(result.result.isError);
	t.true(String(result.result.content).includes('Blocked by hook'));
});

test.serial('post-tool-use output is folded into a streamed bash result', async t => {
	const leave = enterBashHookFixture({
		'post-tool-use': [
			{matchTools: ['execute_bash'], command: bashHookNode("console.log('observed')")},
		],
	});

	let result: Awaited<ReturnType<typeof runStreamingBashTool>>;
	try {
		result = await runStreamingBashTool(
			bashCall('echo hello'),
			null,
			() => {},
			'test',
		);
	} finally {
		leave();
	}

	t.true(
		String(result.result.content).includes(
			'<hook-output event="post-tool-use">\nobserved\n</hook-output>',
		),
		`expected the hook output folded in, got: ${result.result.content}`,
	);
});
