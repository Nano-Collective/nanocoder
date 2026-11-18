import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'ava';
import {
	resetSessionCwd,
	setProjectRoot,
	setSessionCwd,
} from '@/services/session-cwd';
import {
	enforceFirewall,
	evaluateMutationEnvelope,
	evaluatePathMutation,
	getFirewallConfig,
	isProtectedPath,
	resetFirewallConfig,
	setFirewallConfig,
} from './mutation-firewall';

test.beforeEach(() => {
	resetFirewallConfig();
});

test('defaults to disabled (opt-in)', (t) => {
	const config = getFirewallConfig();
	t.false(config.enabled);
	t.is(config.mode, 'disabled');

	const result = evaluateMutationEnvelope('package.json', '{}', '{"a": 1}');
	t.true(result.allowed);
	t.is(result.violations.length, 0);
});

test('allows harmless mutations without violations in strict mode', (t) => {
	setFirewallConfig({ mode: 'strict' });
	const oldCode = `export function add(a: number, b: number): number { return a + b; }`;
	const newCode = `export function add(a: number, b: number): number { return (a + b); }`;

	const result = evaluateMutationEnvelope('source/calc.ts', oldCode, newCode);
	t.true(result.allowed);
	t.is(result.violations.length, 0);
});

test('blocks modification to protected configuration files', (t) => {
	setFirewallConfig({ mode: 'strict', protectedPatterns: ['package.json'] });
	const oldContent = `{"name": "test"}`;
	const newContent = `{"name": "test", "version": "1.0.0"}`;

	const result = evaluateMutationEnvelope('package.json', oldContent, newContent);
	t.false(result.allowed);
	t.is(result.violations.length, 1);
	t.is(result.violations[0].rule, 'protect_config_files');
});

test('anchors protected patterns and does not match unanchored suffixes', (t) => {
	setFirewallConfig({ mode: 'strict', protectedPatterns: ['package.json'] });
	const result = evaluateMutationEnvelope('my-package.json', '{}', '{"a": 1}');
	t.true(result.allowed);
	t.is(result.violations.length, 0);
});

test('setFirewallConfig synchronizes enabled when mode changes', (t) => {
	setFirewallConfig({ mode: 'disabled' });
	t.false(getFirewallConfig().enabled);
	t.is(getFirewallConfig().mode, 'disabled');

	setFirewallConfig({ mode: 'strict' });
	t.true(getFirewallConfig().enabled);
	t.is(getFirewallConfig().mode, 'strict');
});

test('allows protected config files when disabled or lenient', (t) => {
	setFirewallConfig({ protectedPatterns: ['package.json'], mode: 'lenient' });
	const result = evaluateMutationEnvelope('package.json', '{}', '{"a": 1}');
	t.true(result.allowed);
	t.is(result.violations.length, 1);

	setFirewallConfig({ protectedPatterns: ['package.json'], mode: 'disabled' });
	const disabledResult = evaluateMutationEnvelope('package.json', '{}', '{"a": 1}');
	t.true(disabledResult.allowed);
	t.is(disabledResult.violations.length, 0);
});

test('blocks injection of any types in strict mode', (t) => {
	setFirewallConfig({ mode: 'strict' });
	const oldCode = `const x: number = 1;`;
	const newCode = `const x: any = 1;`;

	const result = evaluateMutationEnvelope('source/test.ts', oldCode, newCode);
	t.false(result.allowed);
	t.is(result.violations.length, 1);
	t.is(result.violations[0].rule, 'block_any_types');
	t.truthy(result.summary);
});

test('blocks test deletion in test files', (t) => {
	setFirewallConfig({ mode: 'strict' });
	const oldCode = `test('case 1', () => {});\ntest('case 2', () => {});`;
	const newCode = `test('case 1', () => {});`;

	const result = evaluateMutationEnvelope('source/app.spec.ts', oldCode, newCode);
	t.false(result.allowed);
	t.is(result.violations.length, 1);
	t.is(result.violations[0].rule, 'protect_test_cases');
});

test('can configure custom protected patterns', (t) => {
	setFirewallConfig({ mode: 'strict', protectedPatterns: ['secrets/**', 'config.yaml'] });
	const config = getFirewallConfig();
	t.deepEqual(config.protectedPatterns, ['secrets/**', 'config.yaml']);

	const result = evaluateMutationEnvelope('secrets/prod.env', 'A=1', 'A=2');
	t.false(result.allowed);
	t.is(result.violations[0].rule, 'protect_config_files');
});

test('isProtectedPath table-driven path validation', (t) => {
	t.true(isProtectedPath('package.json', ['package.json']));
	t.true(isProtectedPath('./package.json', ['package.json']));
	t.false(isProtectedPath('my-package.json', ['package.json']));
	t.true(isProtectedPath('package.json', ['/package.json']));
	t.false(isProtectedPath('src/package.json', ['/package.json']));
	t.true(isProtectedPath('.github/workflows/ci.yml', ['.github/workflows/**']));
	t.true(isProtectedPath('.github\\workflows\\ci.yml', ['.github/workflows/**']));
	t.true(isProtectedPath('deep/nested/yarn.lock', ['**/*.lock']));
	t.false(isProtectedPath('deep/nested/yarn.lock.backup', ['**/*.lock']));
	t.false(isProtectedPath('docs/readme.md', ['docs/**', '!docs/readme.md']));
	t.false(isProtectedPath('any/path.ts', ['[invalid-glob']));
	t.true(isProtectedPath('../other/package.json', ['package.json']));
});

test('lenient mode allows the mutation but keeps a warning summary', (t) => {
	setFirewallConfig({ protectedPatterns: ['package.json'], mode: 'lenient' });
	const result = evaluateMutationEnvelope('package.json', '{}', '{"a": 1}');
	t.true(result.allowed);
	t.regex(result.summary ?? '', /^\[Mutation Firewall\] Warning \(lenient mode/);
	// A tool appends this to its result, so the model sees the violation.
	t.regex(enforceFirewall(result), /^\n\n\[Mutation Firewall\] Warning/);
});

test('enforceFirewall throws when strict mode blocks, and adds nothing when clean', (t) => {
	setFirewallConfig({ protectedPatterns: ['package.json'], mode: 'strict' });
	const blocked = evaluateMutationEnvelope('package.json', '{}', '{"a": 1}');
	t.throws(() => enforceFirewall(blocked), {
		message: /^\[Mutation Firewall\] Blocked mutation/,
	});
	const clean = evaluateMutationEnvelope('src/app.ts', 'a', 'b');
	t.is(enforceFirewall(clean), '');
});

test('isProtectedPath resolves relative paths against the session cwd, not process.cwd()', (t) => {
	const root = join(tmpdir(), 'fw-project');
	const sub = join(root, 'packages', 'web');
	// A tool in a session whose cwd moved into packages/web edits
	// `package.json`, which is packages/web/package.json under the project.
	t.true(isProtectedPath('package.json', ['packages/web/package.json'], sub, root));
	t.false(isProtectedPath('package.json', ['/package.json'], sub, root));
	t.true(isProtectedPath(join(sub, 'package.json'), ['packages/**'], sub, root));
});

test('isProtectedPath defaults to the session cwd and project root', (t) => {
	const root = join(tmpdir(), 'fw-default-root');
	const sub = join(root, 'pkg');
	mkdirSync(sub, { recursive: true });
	setProjectRoot(root);
	setSessionCwd(sub);
	t.teardown(() => {
		resetSessionCwd();
		rmSync(root, { recursive: true, force: true });
	});
	t.true(isProtectedPath('yarn.lock', ['pkg/yarn.lock']));
	t.false(isProtectedPath('yarn.lock', ['/yarn.lock']));
});

test('evaluatePathMutation checks the paths a delete, move or copy changes', (t) => {
	setFirewallConfig({ protectedPatterns: ['locked.json'], mode: 'strict' });
	t.false(evaluatePathMutation('delete', { source: 'locked.json' }).allowed);
	t.false(
		evaluatePathMutation('move', { source: 'locked.json', destination: 'x.json' })
			.allowed,
	);
	t.false(
		evaluatePathMutation('move', { source: 'x.json', destination: 'locked.json' })
			.allowed,
	);
	t.false(
		evaluatePathMutation('copy', { source: 'x.json', destination: 'locked.json' })
			.allowed,
	);
	// Copying a protected file leaves it untouched.
	t.true(
		evaluatePathMutation('copy', { source: 'locked.json', destination: 'x.json' })
			.allowed,
	);

	setFirewallConfig({ mode: 'disabled' });
	t.true(evaluatePathMutation('delete', { source: 'locked.json' }).allowed);
});
