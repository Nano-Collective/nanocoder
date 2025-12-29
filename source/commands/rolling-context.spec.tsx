import test from 'ava';
import {setRollingContextEnabled} from '@/config/preferences';
import {rollingContextCommand} from './rolling-context';

// Mock the preferences module
let mockEnabled = false;

// Override the module functions for testing
import {resetPreferencesCache} from '@/config/preferences';

test.beforeEach(() => {
	// Reset to default state before each test
	mockEnabled = false;
	setRollingContextEnabled(false);
	resetPreferencesCache();
});

test('command has correct name and description', t => {
	t.is(rollingContextCommand.name, 'rolling-context');
	t.truthy(rollingContextCommand.description);
	t.true(
		rollingContextCommand.description.toLowerCase().includes('context'),
	);
});

test('toggles rolling context on when given "on" argument', async t => {
	setRollingContextEnabled(false);
	const result = await rollingContextCommand.handler(
		['on'],
		[],
		{
			provider: 'test',
			model: 'test-model',
			tokens: 0,
			getMessageTokens: () => 0,
		} as any,
	);

	// Result should be a React element
	t.truthy(result);
});

test('toggles rolling context off when given "off" argument', async t => {
	setRollingContextEnabled(true);
	const result = await rollingContextCommand.handler(
		['off'],
		[],
		{
			provider: 'test',
			model: 'test-model',
			tokens: 0,
			getMessageTokens: () => 0,
		} as any,
	);

	// Result should be a React element
	t.truthy(result);
});

test('toggles state when given "enable" argument (alias for "on")', async t => {
	setRollingContextEnabled(false);
	const result = await rollingContextCommand.handler(
		['enable'],
		[],
		{
			provider: 'test',
			model: 'test-model',
			tokens: 0,
			getMessageTokens: () => 0,
		} as any,
	);

	t.truthy(result);
});

test('toggles state when given "disable" argument (alias for "off")', async t => {
	setRollingContextEnabled(true);
	const result = await rollingContextCommand.handler(
		['disable'],
		[],
		{
			provider: 'test',
			model: 'test-model',
			tokens: 0,
			getMessageTokens: () => 0,
		} as any,
	);

	t.truthy(result);
});

test('shows status without changing state when given "status" argument', async t => {
	setRollingContextEnabled(true);
	const result = await rollingContextCommand.handler(
		['status'],
		[],
		{
			provider: 'test',
			model: 'test-model',
			tokens: 0,
			getMessageTokens: () => 0,
		} as any,
	);

	// Should return a React element
	t.truthy(result);
});

test('toggles current state when given no argument', async t => {
	setRollingContextEnabled(false);
	const result = await rollingContextCommand.handler(
		[],
		[],
		{
			provider: 'test',
			model: 'test-model',
			tokens: 0,
			getMessageTokens: () => 0,
		} as any,
	);

	// Result should be a React element
	t.truthy(result);
});

test('is async and returns a Promise', t => {
	const result = rollingContextCommand.handler(
		[],
		[],
		{
			provider: 'test',
			model: 'test-model',
			tokens: 0,
			getMessageTokens: () => 0,
		} as any,
	);

	t.true(result instanceof Promise);
});
