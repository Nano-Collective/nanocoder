import test from 'ava';
import {calculateEffectiveTimeout} from './useNonInteractiveMode.js';
import {TIMEOUT_EXECUTION_MAX_MS} from '../constants.js';
import type {LLMClient} from '../types/index.js';

test('calculateEffectiveTimeout returns default when client is null', t => {
	const result = calculateEffectiveTimeout(null);
	t.is(result, TIMEOUT_EXECUTION_MAX_MS);
});

test('calculateEffectiveTimeout returns default when provider config has no timeouts', t => {
	const mockClient = {
		getTimeout: () => undefined,
	} as unknown as LLMClient;

	const result = calculateEffectiveTimeout(mockClient);
	t.is(result, TIMEOUT_EXECUTION_MAX_MS);
});

test('calculateEffectiveTimeout returns max safe integer when timeout is -1', t => {
	const mockClient = {
		getTimeout: () => -1,
	} as unknown as LLMClient;

	const result = calculateEffectiveTimeout(mockClient);
	t.is(result, Number.MAX_SAFE_INTEGER);
});

test('calculateEffectiveTimeout returns buffered socketTimeout when provided', t => {
	const socketTimeout = 400000; // > 5 mins (300000ms)
	const mockClient = {
		getTimeout: () => socketTimeout,
	} as unknown as LLMClient;

	const result = calculateEffectiveTimeout(mockClient);
	t.is(result, socketTimeout * 2);
});

test('calculateEffectiveTimeout fallbacks to requestTimeout if socketTimeout is missing', t => {
	const requestTimeout = 500000;
	const mockClient = {
		getTimeout: () => requestTimeout,
	} as unknown as LLMClient;

	const result = calculateEffectiveTimeout(mockClient);
	t.is(result, requestTimeout * 2);
});

test('calculateEffectiveTimeout prefers socketTimeout over requestTimeout', t => {
	const socketTimeout = 400000;
	const mockClient = {
		getTimeout: () => socketTimeout,
	} as unknown as LLMClient;

	const result = calculateEffectiveTimeout(mockClient);
	t.is(result, socketTimeout * 2);
});

test('calculateEffectiveTimeout respects TIMEOUT_EXECUTION_MAX_MS as minimum', t => {
	const socketTimeout = 50000; // Small timeout
	const mockClient = {
		getTimeout: () => socketTimeout,
	} as unknown as LLMClient;

	const result = calculateEffectiveTimeout(mockClient);
	t.is(result, TIMEOUT_EXECUTION_MAX_MS);
});
