import test from 'ava';
import type {ContextManagementConfig} from '@/types/config';
import type {Message} from '@/types/core';
import {checkBudget, computeMaxInputTokens} from './context-budget';

const defaultConfig: ContextManagementConfig = {
	maxContextTokens: 10000,
	reservedOutputTokens: 1000,
};

test('computeMaxInputTokens subtracts reserved from total', t => {
	const config: ContextManagementConfig = {
		maxContextTokens: 10000,
		reservedOutputTokens: 2000,
	};
	const max = computeMaxInputTokens(config);
	t.is(max, 8000);
});

test('computeMaxInputTokens uses defaults', t => {
	const config: ContextManagementConfig = {};
	const max = computeMaxInputTokens(config);
	// Should use defaults: 128000 - 4096 = 123904
	t.is(max, 123904);
});

test('checkBudget returns accurate calculation', t => {
	const messages: Message[] = [
		{role: 'user', content: 'Hello'},
	];
	const config: ContextManagementConfig = {
		maxContextTokens: 1000,
		reservedOutputTokens: 100,
	};

	const result = checkBudget(messages, config);

	t.is(result.maxInputTokens, 900);
	t.true(result.currentTokens > 0);
	t.is(result.availableTokens, result.maxInputTokens - result.currentTokens);
});

test('checkBudget shows within budget when tokens are low', t => {
	const messages: Message[] = [
		{role: 'user', content: 'Hello'},
	];
	const config: ContextManagementConfig = {
		maxContextTokens: 10000,
		reservedOutputTokens: 1000,
	};

	const result = checkBudget(messages, config);

	t.true(result.withinBudget);
	t.true(result.utilizationPercent < 100);
});

test('checkBudget calculates utilization percent', t => {
	const messages: Message[] = [
		{role: 'user', content: 'x'.repeat(10000)}, // Large message
	];
	const config: ContextManagementConfig = {
		maxContextTokens: 1000,
		reservedOutputTokens: 100,
	};

	const result = checkBudget(messages, config);

	t.true(result.utilizationPercent >= 0);
	t.true(result.utilizationPercent <= 1000); // Can exceed 100%
});

test('checkBudget detects overage', t => {
	const messages: Message[] = [
		{role: 'user', content: 'x'.repeat(50000)}, // Very large message
	];
	const config: ContextManagementConfig = {
		maxContextTokens: 1000,
		reservedOutputTokens: 100,
	};

	const result = checkBudget(messages, config);

	t.false(result.withinBudget);
	t.true(result.currentTokens > result.maxInputTokens);
});

test('checkBudget with provider and model parameters', t => {
	const messages: Message[] = [
		{role: 'user', content: 'Test'},
	];
	const config: ContextManagementConfig = {
		maxContextTokens: 10000,
		reservedOutputTokens: 1000,
	};

	const result = checkBudget(
		messages,
		config,
		'anthropic',
		'claude-3-5-sonnet-20241022',
	);

	t.is(result.maxInputTokens, 9000);
	t.true(result.currentTokens > 0);
	t.true(result.withinBudget);
});
