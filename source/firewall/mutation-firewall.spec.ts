import test from 'ava';
import {
	evaluateMutationEnvelope,
	getFirewallConfig,
	resetFirewallConfig,
	setFirewallConfig,
} from './mutation-firewall';

test.beforeEach(() => {
	resetFirewallConfig();
});

test('allows harmless mutations without violations', (t) => {
	const oldCode = `export function add(a: number, b: number): number { return a + b; }`;
	const newCode = `export function add(a: number, b: number): number { return (a + b); }`;

	const result = evaluateMutationEnvelope('source/calc.ts', oldCode, newCode);
	t.true(result.allowed);
	t.is(result.violations.length, 0);
});

test('blocks modification to protected configuration files', (t) => {
	const oldContent = `{"name": "test"}`;
	const newContent = `{"name": "test", "version": "1.0.0"}`;

	const result = evaluateMutationEnvelope('package.json', oldContent, newContent);
	t.false(result.allowed);
	t.is(result.violations.length, 1);
	t.is(result.violations[0].rule, 'protect_config_files');
});

test('allows protected config files when disabled or lenient', (t) => {
	setFirewallConfig({ mode: 'lenient' });
	const result = evaluateMutationEnvelope('package.json', '{}', '{"a": 1}');
	t.true(result.allowed);
	t.is(result.violations.length, 1);

	setFirewallConfig({ mode: 'disabled' });
	const disabledResult = evaluateMutationEnvelope('package.json', '{}', '{"a": 1}');
	t.true(disabledResult.allowed);
	t.is(disabledResult.violations.length, 0);
});

test('blocks injection of any types in strict mode', (t) => {
	const oldCode = `const x: number = 1;`;
	const newCode = `const x: any = 1;`;

	const result = evaluateMutationEnvelope('source/test.ts', oldCode, newCode);
	t.false(result.allowed);
	t.is(result.violations.length, 1);
	t.is(result.violations[0].rule, 'block_any_types');
	t.truthy(result.summary);
});

test('blocks test deletion in test files', (t) => {
	const oldCode = `test('case 1', () => {});\ntest('case 2', () => {});`;
	const newCode = `test('case 1', () => {});`;

	const result = evaluateMutationEnvelope('source/app.spec.ts', oldCode, newCode);
	t.false(result.allowed);
	t.is(result.violations.length, 1);
	t.is(result.violations[0].rule, 'protect_test_cases');
});

test('can configure custom protected patterns', (t) => {
	setFirewallConfig({ protectedPatterns: ['secrets/**', 'config.yaml'] });
	const config = getFirewallConfig();
	t.deepEqual(config.protectedPatterns, ['secrets/**', 'config.yaml']);

	const result = evaluateMutationEnvelope('secrets/prod.env', 'A=1', 'A=2');
	t.false(result.allowed);
	t.is(result.violations[0].rule, 'protect_config_files');
});
