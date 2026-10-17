import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {getAppConfig} from '@/config/index';
import {getProjectRoot, setProjectRoot} from '@/services/session-cwd';
// Registers write_file as a file-mutating tool, as the tool manager does.
import '@/tools/file-ops/write-file';
import type {ToolCall, ToolResult} from '@/types/core';
import {
	type CompletionLedger,
	createCompletionLedger,
	formatVerificationSummary,
	isEvidenceRejectionMessage,
	recordToolOutcome,
	takeEvidenceRejection,
} from './completion-ledger';

console.log('\ncompletion-ledger.spec.ts');

const originalVerify = getAppConfig().verify;
const originalRoot = getProjectRoot();

test.afterEach.always(() => {
	getAppConfig().verify = originalVerify;
	setProjectRoot(originalRoot);
});

function ledgerFor(required: string[] | 'auto'): CompletionLedger {
	getAppConfig().verify = {required};
	return createCompletionLedger();
}

let nextId = 0;
function toolCall(name: string, args: Record<string, unknown>): ToolCall {
	return {id: `call-${nextId++}`, function: {name, arguments: args}};
}

function result(content: string, isError = false): ToolResult {
	return {tool_call_id: 'x', role: 'tool', name: 'x', content, isError};
}

function edit(ledger: CompletionLedger) {
	recordToolOutcome(
		ledger,
		toolCall('write_file', {path: 'a.ts', content: 'x'}),
		result('File written'),
	);
}

/** A finished execute_bash run, shaped like the tool's real output. */
function run(ledger: CompletionLedger, command: string, exitCode: number) {
	recordToolOutcome(
		ledger,
		toolCall('execute_bash', {command}),
		result(`EXIT_CODE: ${exitCode}\noutput`, exitCode !== 0),
	);
}

test.serial('nothing is required unless nanocoder.verify is set', t => {
	getAppConfig().verify = undefined;
	const ledger = createCompletionLedger();
	edit(ledger);
	t.deepEqual(ledger.required, []);
	t.is(takeEvidenceRejection(ledger), null);
	t.is(formatVerificationSummary(ledger), null);
});

test.serial('a turn that edited nothing is never sent back', t => {
	const ledger = ledgerFor(['pnpm test']);
	t.is(takeEvidenceRejection(ledger), null);
	t.is(formatVerificationSummary(ledger), null);
});

test.serial('an edit without the required run is rejected', t => {
	const ledger = ledgerFor(['pnpm test']);
	edit(ledger);

	const rejection = takeEvidenceRejection(ledger);
	t.truthy(rejection);
	t.is(rejection?.role, 'user');
	t.true(rejection?.content.includes('`pnpm test` (not run)'));
	t.true(rejection && isEvidenceRejectionMessage(rejection));
});

test.serial('an exit 0 run after the last edit is accepted and summarised', t => {
	const ledger = ledgerFor(['pnpm test']);
	edit(ledger);
	run(ledger, 'pnpm test', 0);

	t.is(takeEvidenceRejection(ledger), null);
	t.is(formatVerificationSummary(ledger), 'Verification: ✓ pnpm test (exit 0)');
});

test.serial('evidence from before the last edit is stale', t => {
	const ledger = ledgerFor(['pnpm test']);
	edit(ledger);
	run(ledger, 'pnpm test', 0);
	edit(ledger);

	const rejection = takeEvidenceRejection(ledger);
	t.true(rejection?.content.includes('not run since your last edit'));
	t.is(
		formatVerificationSummary(ledger),
		'Verification: ✗ pnpm test (not run since your last edit)',
	);
});

test.serial('a failed run is not evidence and the exit code is reported', t => {
	const ledger = ledgerFor(['pnpm test']);
	edit(ledger);
	run(ledger, 'pnpm test', 1);

	t.true(takeEvidenceRejection(ledger)?.content.includes('last run exited 1'));
});

test.serial('a later passing run replaces an earlier failure', t => {
	const ledger = ledgerFor(['pnpm test']);
	edit(ledger);
	run(ledger, 'pnpm test', 1);
	run(ledger, 'pnpm test', 0);

	t.is(takeEvidenceRejection(ledger), null);
});

test.serial('every required command needs its own evidence', t => {
	const ledger = ledgerFor(['pnpm test', 'pnpm lint']);
	edit(ledger);
	run(ledger, 'pnpm test', 0);

	const content = takeEvidenceRejection(ledger)?.content ?? '';
	t.true(content.includes('`pnpm lint` (not run)'));
	t.false(content.includes('`pnpm test`'));
});

test.serial('a failed edit does not make evidence stale', t => {
	const ledger = ledgerFor(['pnpm test']);
	edit(ledger);
	run(ledger, 'pnpm test', 0);
	recordToolOutcome(
		ledger,
		toolCall('write_file', {path: 'a.ts', content: 'y'}),
		result('Error: permission denied', true),
	);

	t.is(takeEvidenceRejection(ledger), null);
});

test.serial('a pipe, `;` or `||` can hide the exit code, so it is not evidence', t => {
	for (const command of [
		'pnpm test | tail -5',
		'pnpm test; echo done',
		'pnpm test || true',
		'pnpm test &',
	]) {
		const ledger = ledgerFor(['pnpm test']);
		edit(ledger);
		run(ledger, command, 0);
		t.true(
			takeEvidenceRejection(ledger)?.content.includes('hidden by a pipe'),
			command,
		);
	}
});

test.serial('`&&` chains and arguments still count', t => {
	for (const command of [
		'cd app && pnpm test',
		'pnpm test && echo ok',
		'pnpm test -- --watch=false',
	]) {
		const ledger = ledgerFor(['pnpm test']);
		edit(ledger);
		run(ledger, command, 0);
		t.is(takeEvidenceRejection(ledger), null, command);
	}
});

test.serial('a command only matches as whole words', t => {
	const ledger = ledgerFor(['pnpm test']);
	edit(ledger);
	run(ledger, 'pnpm test:all', 0);
	run(ledger, 'mypnpm test', 0);

	t.truthy(takeEvidenceRejection(ledger));
});

test.serial('a run with no exit code is not evidence', t => {
	const ledger = ledgerFor(['pnpm test']);
	edit(ledger);
	recordToolOutcome(
		ledger,
		toolCall('execute_bash', {command: 'pnpm test'}),
		result('Error: command timed out', true),
	);

	t.true(
		takeEvidenceRejection(ledger)?.content.includes('without an exit code'),
	);
});

test.serial('the model is sent back twice, then may finish unverified', t => {
	const ledger = ledgerFor(['pnpm test']);
	edit(ledger);

	t.truthy(takeEvidenceRejection(ledger));
	t.truthy(takeEvidenceRejection(ledger));
	t.is(takeEvidenceRejection(ledger), null);
	t.is(
		formatVerificationSummary(ledger),
		'Verification: ✗ pnpm test (not run)',
	);
});

test.serial('tool arguments given as a JSON string are understood', t => {
	const ledger = ledgerFor(['pnpm test']);
	edit(ledger);
	recordToolOutcome(
		ledger,
		{
			id: 'str',
			function: {
				name: 'execute_bash',
				arguments: JSON.stringify({command: 'pnpm test'}) as never,
			},
		},
		result('EXIT_CODE: 0\nok'),
	);

	t.is(takeEvidenceRejection(ledger), null);
});

test.serial('entries keep the command, exit code and a timestamp', t => {
	const ledger = ledgerFor(['pnpm test']);
	run(ledger, 'pnpm test', 2);

	t.is(ledger.entries.length, 1);
	t.is(ledger.entries[0]?.command, 'pnpm test');
	t.is(ledger.entries[0]?.exitCode, 2);
	t.false(Number.isNaN(Date.parse(ledger.entries[0]?.at ?? '')));
});

test.serial('"auto" requires the test, typecheck and lint scripts it finds', t => {
	const root = mkdtempSync(join(tmpdir(), 'ledger-auto-'));
	try {
		writeFileSync(
			join(root, 'package.json'),
			JSON.stringify({scripts: {test: 'x', lint: 'y', build: 'z'}}),
		);
		writeFileSync(join(root, 'pnpm-lock.yaml'), '');
		setProjectRoot(root);

		const ledger = ledgerFor('auto');
		t.deepEqual(
			ledger.required.map(item => item.label),
			['pnpm test', 'pnpm run lint'],
		);

		edit(ledger);
		run(ledger, 'npm run lint', 0);
		run(ledger, 'pnpm run test', 0);
		t.is(takeEvidenceRejection(ledger), null);
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test.serial('"auto" falls back to npm and requires nothing without scripts', t => {
	const root = mkdtempSync(join(tmpdir(), 'ledger-auto-'));
	try {
		setProjectRoot(root);
		t.deepEqual(ledgerFor('auto').required, []);

		mkdirSync(join(root, 'sub'));
		writeFileSync(
			join(root, 'package.json'),
			JSON.stringify({scripts: {test: 'x'}}),
		);
		t.deepEqual(
			ledgerFor('auto').required.map(item => item.label),
			['npm test'],
		);

		writeFileSync(join(root, 'package.json'), 'not json');
		t.deepEqual(ledgerFor('auto').required, []);
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});
