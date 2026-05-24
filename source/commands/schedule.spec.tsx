import test from 'ava';
import React from 'react';
import {renderWithTheme} from '@/test-utils/render-with-theme';
import {scheduleCommand} from './schedule';

void React; // JSX runtime requires React in scope

// ============================================================================
// Command Definition
// ============================================================================

test('scheduleCommand has correct name', t => {
	t.is(scheduleCommand.name, 'schedule');
});

test('scheduleCommand has a description', t => {
	t.truthy(scheduleCommand.description);
	t.is(typeof scheduleCommand.description, 'string');
});

test('scheduleCommand has a handler function', t => {
	t.is(typeof scheduleCommand.handler, 'function');
});

// ============================================================================
// Default invocation — renders the read-only schedules view
// ============================================================================

test.serial('schedule with no args renders the schedules view', async t => {
	const result = await scheduleCommand.handler([]);
	t.truthy(result);
	t.true(React.isValidElement(result));
	if (React.isValidElement(result)) {
		const {lastFrame} = renderWithTheme(result);
		const output = lastFrame();
		t.truthy(output);
		t.regex(output!, /Schedules|No cron subscriptions declared/);
	}
});

// ============================================================================
// Any args → usage message (subcommands like `list` and `add` are gone)
// ============================================================================

test('schedule with any subcommand falls through to usage', async t => {
	const result = await scheduleCommand.handler(['anything']);
	t.truthy(result);
	if (React.isValidElement(result)) {
		const {lastFrame} = renderWithTheme(result);
		const output = lastFrame();
		t.regex(output!, /Usage: \/schedule/);
		t.notRegex(output!, /\blist\b/);
		t.notRegex(output!, /\badd\b/);
	}
});

test('schedule list is no longer a recognized subcommand', async t => {
	const result = await scheduleCommand.handler(['list']);
	if (React.isValidElement(result)) {
		const {lastFrame} = renderWithTheme(result);
		const output = lastFrame();
		t.regex(output!, /Usage: \/schedule/);
	}
});

test('schedule add is no longer a recognized subcommand', async t => {
	const result = await scheduleCommand.handler(['add', '"0 9 * * *"', 'x.md']);
	if (React.isValidElement(result)) {
		const {lastFrame} = renderWithTheme(result);
		const output = lastFrame();
		t.regex(output!, /Usage: \/schedule/);
	}
});
