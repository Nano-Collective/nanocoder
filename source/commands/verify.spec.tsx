import {existsSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {clearAppConfig, getAppConfig, reloadAppConfig} from '@/config/index';
import React from 'react';
import {renderWithTheme} from '../test-utils/render-with-theme.js';
import type {VerificationRunResult} from '../services/verification/runner';
import {Verify, verifyCommand} from './verify';

console.log(`\nverify.spec.tsx`);

function result(
	overrides: Partial<VerificationRunResult> = {},
): VerificationRunResult {
	return {
		status: 'passed',
		exitCode: 0,
		signal: null,
		durationMs: 1230,
		output: 'ok',
		truncated: false,
		...overrides,
	};
}

function render(props: Partial<React.ComponentProps<typeof Verify>>) {
	return renderWithTheme(
		<Verify
			commandDisplay="npm run test:ci"
			result={null}
			automaticDisabled={false}
			cwd="/repo"
			{...props}
		/>,
	);
}

// ============================================================================
// Rendering
// ============================================================================

test('shows the command and where it ran', t => {
	const {lastFrame} = render({result: result()});
	const output = lastFrame()!;
	t.regex(output, /npm run test:ci/);
	t.regex(output, /\/repo/);
});

test('reports a pass', t => {
	const {lastFrame} = render({result: result()});
	const output = lastFrame()!;
	t.regex(output, /passed/);
	// A passing check has nothing to fix; saying so stops the user wondering
	// whether the box is still working.
	t.regex(output, /Nothing to fix/);
});

test('reports a failure with its exit code', t => {
	const {lastFrame} = render({
		result: result({status: 'failed', exitCode: 1, output: '1 test failed'}),
	});
	const output = lastFrame()!;
	t.regex(output, /failed/);
	t.regex(output, /exit 1/);
	t.regex(output, /1 test failed/);
});

test('reports a timeout and names the setting to raise', t => {
	const {lastFrame} = render({
		result: result({
			status: 'timeout',
			exitCode: null,
			durationMs: 120_000,
			output: '',
		}),
	});
	const output = lastFrame()!;
	t.regex(output, /timed out/);
	// Silence here is the confusing part; name the knob.
	t.regex(output, /verification\.timeoutMs/);
});

test('reports a missing command and the spawn error', t => {
	const {lastFrame} = render({
		result: result({
			status: 'unavailable',
			exitCode: null,
			spawnError: 'spawn npm ENOENT',
			output: '',
		}),
	});
	const output = lastFrame()!;
	t.regex(output, /command not found/);
	t.regex(output, /ENOENT/);
	t.regex(output, /PATH/);
});

test('says nothing is configured rather than showing an empty result', t => {
	const {lastFrame} = render({
		commandDisplay: null,
		result: null,
		notConfigured: true,
	});
	const output = lastFrame()!;
	t.regex(output, /No verification command configured/);
	// The point of the unconfigured state is that the user can fix it, so the
	// example has to be on screen rather than just referenced in the docs.
	t.regex(output, /agents\.config\.json/);
	t.regex(output, /"verification"/);
});

test('notes that automatic verification is off on a manual run', t => {
	const {lastFrame} = render({result: result(), automaticDisabled: true});
	const output = lastFrame()!;
	// `enabled: false` suppresses the post-edit loop, not the command. Without
	// this the user cannot tell why their edits stopped triggering checks.
	t.regex(output, /[Aa]utomatic post-edit verification is disabled/);
});

test('caps a huge output for the terminal and says so', t => {
	const huge = Array.from({length: 500}, (_, i) => `line ${i}`).join('\n');
	const {lastFrame} = render({result: result({output: huge})});
	const output = lastFrame()!;
	t.regex(output, /earlier lines omitted/);
	t.regex(output, /line 499/);
	// The head is what gets dropped: a 500-line frame helps nobody.
	t.false(output.includes('line 0\n'));
});

test('mentions truncation when the byte cap bit', t => {
	const {lastFrame} = render({result: result({truncated: true})});
	t.regex(lastFrame()!, /truncated/);
});

// ============================================================================
// Handler, end to end
// ============================================================================
//
// These are the tests that would have caught a config block that parses but
// never reaches a spawn. The rendering tests above pass on a hand-built
// result; these drive the real loader and a real process.

async function withCheck(
	body: string,
	assertion: (output: string) => void,
	verificationOverrides: Record<string, unknown> = {},
): Promise<void> {
	const originalCwd = process.cwd();
	const originalConfigDir = process.env.NANOCODER_CONFIG_DIR;
	const dir = join(tmpdir(), `nanocoder-verify-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, {recursive: true});

	try {
		writeFileSync(join(dir, 'check.mjs'), body, 'utf-8');
		writeFileSync(
			join(dir, 'agents.config.json'),
			JSON.stringify({
				nanocoder: {
					verification: {
						command: [process.execPath, 'check.mjs'],
						...verificationOverrides,
					},
				},
			}),
			'utf-8',
		);
		process.chdir(dir);
		process.env.NANOCODER_CONFIG_DIR = join(dir, 'no-global');
		clearAppConfig();

		const node = await verifyCommand.handler([], [], {
			provider: 'test',
			model: 'test',
			tokens: 0,
			getMessageTokens: () => 0,
		} as never);
		const {lastFrame} = renderWithTheme(<>{node}</>);
		assertion(lastFrame()!);
	} finally {
		process.chdir(originalCwd);
		if (originalConfigDir !== undefined) {
			process.env.NANOCODER_CONFIG_DIR = originalConfigDir;
		} else {
			delete process.env.NANOCODER_CONFIG_DIR;
		}
		clearAppConfig();
		reloadAppConfig();
		if (existsSync(dir)) rmSync(dir, {recursive: true, force: true});
	}
}

test.serial('handler runs the configured command and reports success', async t => {
	await withCheck('console.log("all good");', output => {
		t.regex(output, /passed/);
		// Proof the spawn happened and the output came back, not just that a
		// result object was rendered.
		t.regex(output, /all good/);
	});
});

test.serial('handler reports a non-zero exit as a failure', async t => {
	await withCheck(
		'console.error("FAIL src/a.test.ts"); process.exit(1);',
		output => {
			t.regex(output, /failed/);
			t.regex(output, /exit 1/);
			t.regex(output, /FAIL src\/a\.test\.ts/);
		},
	);
});

test.serial('handler kills a check that outlives its timeout', async t => {
	// A 1s budget, not the 120s default: left at the default this test would
	// hang the suite for two minutes, which is exactly what a runaway check
	// does to a real session.
	await withCheck(
		'setTimeout(() => {}, 60000);',
		output => {
			t.regex(output, /timed out/);
		},
		{timeoutMs: 1000},
	);
});

test.serial('handler surfaces an unconfigured feature without running anything', async t => {
	const originalCwd = process.cwd();
	const dir = join(tmpdir(), `nanocoder-verify-empty-${Date.now()}`);
	mkdirSync(dir, {recursive: true});
	try {
		process.chdir(dir);
		process.env.NANOCODER_CONFIG_DIR = join(dir, 'no-global');
		clearAppConfig();

		t.is(getAppConfig().verification, undefined);
		const node = await verifyCommand.handler([], [], {
			provider: 'test',
			model: 'test',
			tokens: 0,
			getMessageTokens: () => 0,
		} as never);
		const {lastFrame} = renderWithTheme(<>{node}</>);
		t.regex(lastFrame()!, /No verification command configured/);
	} finally {
		process.chdir(originalCwd);
		delete process.env.NANOCODER_CONFIG_DIR;
		clearAppConfig();
		reloadAppConfig();
		if (existsSync(dir)) rmSync(dir, {recursive: true, force: true});
	}
});

test('the command declares the name the registry dispatches on', t => {
	t.is(verifyCommand.name, 'verify');
	// A spinner matters: the handler can sit silent for the whole timeout.
	t.is(verifyCommand.progressLabel, 'Running verification');
});
