import test from 'ava';
import React from 'react';
import {renderWithTheme} from '@/test-utils/render-with-theme';
import {commandsCommand} from './custom-commands';

void React; // JSX runtime requires React in scope

// ============================================================================
// Command Definition Tests
// ============================================================================

test('commandsCommand has correct name', t => {
	t.is(commandsCommand.name, 'custom-commands');
});

test('commandsCommand has a description', t => {
	t.truthy(commandsCommand.description);
	t.is(typeof commandsCommand.description, 'string');
});

test('commandsCommand description mentions create subcommand', t => {
	t.regex(commandsCommand.description, /create/);
});

test('commandsCommand has a handler function', t => {
	t.is(typeof commandsCommand.handler, 'function');
});

// ============================================================================
// List Subcommand Tests
// ============================================================================

test.serial('commands list returns a renderable element', async t => {
	const result = await commandsCommand.handler([]);
	t.truthy(result);
	t.true(React.isValidElement(result));
	if (React.isValidElement(result)) {
		const {lastFrame} = renderWithTheme(result);
		const output = lastFrame();
		t.truthy(output);
		t.regex(output!, /No custom commands found|Custom Commands/);
	}
});

// ============================================================================
// Show Subcommand Tests
// ============================================================================

test('commands show with no name shows usage', async t => {
	const result = await commandsCommand.handler(['show']);
	t.truthy(result);
	if (React.isValidElement(result)) {
		const {lastFrame} = renderWithTheme(result);
		const output = lastFrame();
		t.regex(output!, /Usage/);
	}
});

test('commands show with nonexistent name shows not found', async t => {
	const result = await commandsCommand.handler([
		'show',
		'nonexistent-command',
	]);
	t.truthy(result);
	if (React.isValidElement(result)) {
		const {lastFrame} = renderWithTheme(result);
		const output = lastFrame();
		t.regex(output!, /not found/i);
	}
});

// ============================================================================
// Refresh Subcommand Tests
// ============================================================================

test('commands refresh shows refreshed message', async t => {
	const result = await commandsCommand.handler(['refresh']);
	t.truthy(result);
	if (React.isValidElement(result)) {
		const {lastFrame} = renderWithTheme(result);
		const output = lastFrame();
		t.regex(output!, /refreshed/i);
	}
});

// ============================================================================
// Create Subcommand Tests
// ============================================================================

test('commands create shows usage hint', async t => {
	const result = await commandsCommand.handler(['create']);
	t.truthy(result);
	if (React.isValidElement(result)) {
		const {lastFrame} = renderWithTheme(result);
		const output = lastFrame();
		t.regex(output!, /Usage/);
		t.regex(output!, /commands create/);
	}
});

test('commands create usage mentions AI-assisted session', async t => {
	const result = await commandsCommand.handler(['create']);
	t.truthy(result);
	if (React.isValidElement(result)) {
		const {lastFrame} = renderWithTheme(result);
		const output = lastFrame();
		t.regex(output!, /AI-assisted/i);
	}
});
