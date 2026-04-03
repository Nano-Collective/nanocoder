import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {themes} from '../config/themes';
import {ThemeContext} from '../hooks/useTheme';
import {TitleShapeContext} from '../hooks/useTitleShape';
import {setupConfigCommand} from './setup-config.js';

console.log('\nsetup-config.spec.tsx');

const MockProviders = ({children}: {children: React.ReactNode}) => {
	const mockTheme = {
		currentTheme: 'tokyo-night' as const,
		colors: themes['tokyo-night'].colors,
		setCurrentTheme: () => {},
	};

	const mockTitleShape = {
		currentTitleShape: 'pill' as const,
		setCurrentTitleShape: () => {},
	};

	return (
		<ThemeContext.Provider value={mockTheme}>
			<TitleShapeContext.Provider value={mockTitleShape}>
				{children}
			</TitleShapeContext.Provider>
		</ThemeContext.Provider>
	);
};

// ============================================================================
// Command Registration Tests
// ============================================================================

test('setup-config command has correct name', t => {
	t.is(setupConfigCommand.name, 'setup-config');
});

test('setup-config command has a description', t => {
	t.truthy(setupConfigCommand.description);
	t.true(setupConfigCommand.description.includes('editor'));
});

test('setup-config command has a handler function', t => {
	t.is(typeof setupConfigCommand.handler, 'function');
});

// ============================================================================
// List Mode Tests (no arguments)
// ============================================================================

test('setup-config with no args returns React element listing config files', async t => {
	const result = await setupConfigCommand.handler([], [], {} as any);
	t.truthy(result);
});

test('setup-config with no args shows Configuration Files title', async t => {
	const result = await setupConfigCommand.handler([], [], {} as any);
	if (!React.isValidElement(result)) {
		t.fail('Expected React element');
		return;
	}

	const {lastFrame} = render(
		<MockProviders>{result}</MockProviders>,
	);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Configuration Files/);
});

test('setup-config with no args shows agents.config.json (global)', async t => {
	const result = await setupConfigCommand.handler([], [], {} as any);
	if (!React.isValidElement(result)) {
		t.fail('Expected React element');
		return;
	}

	const {lastFrame} = render(
		<MockProviders>{result}</MockProviders>,
	);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /agents\.config\.json \(global\)/);
});

test('setup-config with no args shows .mcp.json (global)', async t => {
	const result = await setupConfigCommand.handler([], [], {} as any);
	if (!React.isValidElement(result)) {
		t.fail('Expected React element');
		return;
	}

	const {lastFrame} = render(
		<MockProviders>{result}</MockProviders>,
	);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /\.mcp\.json \(global\)/);
});

test('setup-config with no args shows usage hint', async t => {
	const result = await setupConfigCommand.handler([], [], {} as any);
	if (!React.isValidElement(result)) {
		t.fail('Expected React element');
		return;
	}

	const {lastFrame} = render(
		<MockProviders>{result}</MockProviders>,
	);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /\/setup-config/);
});

// ============================================================================
// Invalid Selection Tests
// ============================================================================

test('setup-config with invalid string arg shows error', async t => {
	const result = await setupConfigCommand.handler(['abc'], [], {} as any);
	if (!React.isValidElement(result)) {
		t.fail('Expected React element');
		return;
	}

	const {lastFrame} = render(
		<MockProviders>{result}</MockProviders>,
	);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Invalid selection/);
});

test('setup-config with 0 shows error', async t => {
	const result = await setupConfigCommand.handler(['0'], [], {} as any);
	if (!React.isValidElement(result)) {
		t.fail('Expected React element');
		return;
	}

	const {lastFrame} = render(
		<MockProviders>{result}</MockProviders>,
	);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Invalid selection/);
});

test('setup-config with negative number shows error', async t => {
	const result = await setupConfigCommand.handler(['-1'], [], {} as any);
	if (!React.isValidElement(result)) {
		t.fail('Expected React element');
		return;
	}

	const {lastFrame} = render(
		<MockProviders>{result}</MockProviders>,
	);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Invalid selection/);
});

test('setup-config with out-of-range number shows error', async t => {
	const result = await setupConfigCommand.handler(['999'], [], {} as any);
	if (!React.isValidElement(result)) {
		t.fail('Expected React element');
		return;
	}

	const {lastFrame} = render(
		<MockProviders>{result}</MockProviders>,
	);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Invalid selection/);
});
