import test from 'ava';
import type {ProviderConfig} from '@/types/index';
import {
	formatConfigLintIssue,
	lintProviderConfig,
	lintProviderConfigs,
} from './lint.js';

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
	return {
		name: 'OpenRouter',
		baseUrl: 'https://openrouter.ai/api/v1',
		apiKey: 'k',
		models: ['x/y'],
		...overrides,
	};
}

test('clean OpenRouter config produces no issues', t => {
	t.deepEqual(
		lintProviderConfig(
			provider({
				openrouter: {
					provider: {sort: 'price'},
					reasoning: {effort: 'high'},
					service_tier: 'flex',
				},
			}),
		),
		[],
	);
});

test('clean non-OpenRouter config produces no issues', t => {
	t.deepEqual(
		lintProviderConfig(
			provider({name: 'Ollama', baseUrl: 'http://localhost:11434/v1'}),
		),
		[],
	);
});

test('openrouter block on non-OpenRouter-named provider warns', t => {
	const issues = lintProviderConfig(
		provider({
			name: 'OpenRouter Prod',
			openrouter: {service_tier: 'flex'},
		}),
	);
	t.is(issues.length, 1);
	t.is(issues[0]?.level, 'warning');
	t.regex(issues[0]?.message ?? '', /name is not "openrouter"/);
});

test('OpenRouter detection is case-insensitive (no warning)', t => {
	t.deepEqual(
		lintProviderConfig(
			provider({name: 'openrouter', openrouter: {service_tier: 'flex'}}),
		),
		[],
	);
	t.deepEqual(
		lintProviderConfig(
			provider({name: 'OPENROUTER', openrouter: {service_tier: 'flex'}}),
		),
		[],
	);
});

test('unknown openrouter top-level key warns', t => {
	const issues = lintProviderConfig(
		provider({
			openrouter: {
				// @ts-expect-error intentionally invalid
				'service-tier': 'flex',
			},
		}),
	);
	t.is(issues.length, 1);
	t.regex(issues[0]?.message ?? '', /Unknown key "openrouter.service-tier"/);
});

test('invalid service_tier value warns', t => {
	const issues = lintProviderConfig(
		provider({
			// @ts-expect-error intentionally invalid runtime value
			openrouter: {service_tier: 'auto'},
		}),
	);
	t.is(issues.length, 1);
	t.regex(issues[0]?.message ?? '', /service_tier must be "flex" or "priority"/);
	t.regex(issues[0]?.message ?? '', /auto/);
});

test('invalid reasoning.effort value warns', t => {
	const issues = lintProviderConfig(
		provider({
			openrouter: {
				// @ts-expect-error intentionally invalid runtime value
				reasoning: {effort: 'extreme'},
			},
		}),
	);
	t.is(issues.length, 1);
	t.regex(issues[0]?.message ?? '', /reasoning.effort must be one of/);
});

test('invalid sort string warns; valid object sort does not', t => {
	const bad = lintProviderConfig(
		provider({
			openrouter: {
				// @ts-expect-error intentionally invalid runtime value
				provider: {sort: 'cheapest'},
			},
		}),
	);
	t.is(bad.length, 1);
	t.regex(bad[0]?.message ?? '', /sort must be "price"/);

	const good = lintProviderConfig(
		provider({
			openrouter: {
				provider: {sort: {by: 'latency', partition: 'model'}},
			},
		}),
	);
	t.deepEqual(good, []);
});

test('invalid data_collection value warns', t => {
	const issues = lintProviderConfig(
		provider({
			openrouter: {
				// @ts-expect-error intentionally invalid runtime value
				provider: {data_collection: 'sometimes'},
			},
		}),
	);
	t.is(issues.length, 1);
	t.regex(
		issues[0]?.message ?? '',
		/data_collection must be "allow" or "deny"/,
	);
});

test('lintProviderConfigs aggregates across multiple providers', t => {
	const issues = lintProviderConfigs([
		provider({name: 'Ollama'}),
		provider({
			name: 'OpenRouter Prod',
			openrouter: {service_tier: 'flex'},
		}),
		provider({
			openrouter: {
				// @ts-expect-error intentionally invalid runtime value
				reasoning: {effort: 'extreme'},
			},
		}),
	]);
	t.is(issues.length, 2);
});

test('formatConfigLintIssue prefixes with [config]', t => {
	t.is(
		formatConfigLintIssue({
			level: 'warning',
			provider: 'OpenRouter',
			message: 'hi',
		}),
		'[config] hi',
	);
});
