import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {reloadAppConfig} from '@/config/index';
import {createFileToolApproval} from './tool-approval';

console.log('\ntool-approval.spec.ts');

test('returns a function', t => {
	const approvalFn = createFileToolApproval('write_file');
	t.is(typeof approvalFn, 'function');
});

test('returned function returns a boolean', t => {
	const approvalFn = createFileToolApproval('write_file');
	const result = approvalFn();
	t.is(typeof result, 'boolean');
});

test('different tool names produce independent functions', t => {
	const fn1 = createFileToolApproval('write_file');
	const fn2 = createFileToolApproval('delete_file');
	t.not(fn1, fn2);
});

// ============================================================================
// alwaysAllow integration: a tool listed in agents.config.json's top-level
// alwaysAllow should short-circuit approval to `false` regardless of mode.
// ============================================================================

test.serial('alwaysAllow short-circuits approval for the listed tool', async t => {
	const dir = await mkdtemp(join(tmpdir(), 'cfg-'));
	const originalConfigDir = process.env.NANOCODER_CONFIG_DIR;
	process.env.NANOCODER_CONFIG_DIR = dir;

	try {
		await writeFile(
			join(dir, 'agents.config.json'),
			JSON.stringify({
				nanocoder: {
					alwaysAllow: ['execute_bash'],
				},
			}),
			'utf-8',
		);
		reloadAppConfig();

		const approvalFn = createFileToolApproval('execute_bash');
		t.false(approvalFn(), 'always-allowed tool should not need approval');

		const other = createFileToolApproval('write_file');
		// `write_file` isn't in alwaysAllow; result depends on current mode,
		// but the function shouldn't short-circuit to false through the
		// alwaysAllow path. We assert it's a boolean (mode-driven outcome).
		t.is(typeof other(), 'boolean');
	} finally {
		if (originalConfigDir === undefined) {
			delete process.env.NANOCODER_CONFIG_DIR;
		} else {
			process.env.NANOCODER_CONFIG_DIR = originalConfigDir;
		}
		reloadAppConfig();
		await rm(dir, {recursive: true, force: true});
	}
});
