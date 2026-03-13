import test from 'ava';
import React from 'react';
import {renderWithTheme} from '@/test-utils/render-with-theme';
import {scheduleCommand} from './schedule';

void React; // JSX runtime requires React in scope

// ============================================================================
// Command Definition Tests
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
// List Subcommand Tests
// ============================================================================

test.serial('schedule list returns a renderable element', async t => {
	const result = await scheduleCommand.handler([]);
	t.truthy(result);
	t.true(React.isValidElement(result));
	if (React.isValidElement(result)) {
		const {lastFrame} = renderWithTheme(result);
		const output = lastFrame();
		t.truthy(output);
		// Should show either empty message or schedules list
		t.regex(output!, /No schedules configured|Schedules/);
	}
});

test.serial('schedule list subcommand returns a renderable element', async t => {
	const result = await scheduleCommand.handler(['list']);
	t.truthy(result);
	t.true(React.isValidElement(result));
	if (React.isValidElement(result)) {
		const {lastFrame} = renderWithTheme(result);
		const output = lastFrame();
		t.truthy(output);
		t.regex(output!, /No schedules configured|Schedules/);
	}
});

// ============================================================================
// Add Subcommand Tests
// ============================================================================

test('schedule add with no args shows usage', async t => {
	const result = await scheduleCommand.handler(['add']);
	t.truthy(result);
	if (React.isValidElement(result)) {
		const {lastFrame} = renderWithTheme(result);
		const output = lastFrame();
		t.regex(output!, /Usage/);
	}
});

test('schedule add with invalid cron shows error', async t => {
	const result = await scheduleCommand.handler([
		'add',
		'"not valid cron"',
		'test.md',
	]);
	t.truthy(result);
	if (React.isValidElement(result)) {
		const {lastFrame} = renderWithTheme(result);
		const output = lastFrame();
		t.regex(output!, /Invalid cron expression|Usage/);
	}
});

test('schedule add with missing file shows error', async t => {
	const result = await scheduleCommand.handler([
		'add',
		'"0 9 * * *"',
		'nonexistent-file.md',
	]);
	t.truthy(result);
	if (React.isValidElement(result)) {
		const {lastFrame} = renderWithTheme(result);
		const output = lastFrame();
		t.regex(output!, /not found/i);
	}
});

// ============================================================================
// Remove Subcommand Tests
// ============================================================================

test('schedule remove with no id shows usage', async t => {
	const result = await scheduleCommand.handler(['remove']);
	t.truthy(result);
	if (React.isValidElement(result)) {
		const {lastFrame} = renderWithTheme(result);
		const output = lastFrame();
		t.regex(output!, /Usage/);
	}
});

test('schedule rm alias works', async t => {
	const result = await scheduleCommand.handler(['rm']);
	t.truthy(result);
	if (React.isValidElement(result)) {
		const {lastFrame} = renderWithTheme(result);
		const output = lastFrame();
		t.regex(output!, /Usage/);
	}
});

test('schedule remove with non-existent id shows error', async t => {
	const result = await scheduleCommand.handler(['remove', 'fake-id']);
	t.truthy(result);
	if (React.isValidElement(result)) {
		const {lastFrame} = renderWithTheme(result);
		const output = lastFrame();
		t.regex(output!, /not found/i);
	}
});

// ============================================================================
// Create Subcommand Tests
// ============================================================================

test('schedule create with no name shows usage', async t => {
	const result = await scheduleCommand.handler(['create']);
	t.truthy(result);
	if (React.isValidElement(result)) {
		const {lastFrame} = renderWithTheme(result);
		const output = lastFrame();
		t.regex(output!, /Usage/);
	}
});

// ============================================================================
// Start Subcommand Tests
// ============================================================================

test('schedule start fallback shows error', async t => {
	// When not intercepted by app-util.ts, this should show an error
	const result = await scheduleCommand.handler(['start']);
	t.truthy(result);
	if (React.isValidElement(result)) {
		const {lastFrame} = renderWithTheme(result);
		const output = lastFrame();
		t.regex(output!, /could not be started/i);
	}
});

// ============================================================================
// Logs Subcommand Tests
// ============================================================================

test('schedule logs with no runs shows empty message', async t => {
	const result = await scheduleCommand.handler(['logs']);
	t.truthy(result);
	if (React.isValidElement(result)) {
		const {lastFrame} = renderWithTheme(result);
		const output = lastFrame();
		t.regex(output!, /No schedule runs recorded/i);
	}
});

test('schedule logs with schedule id filter shows filtered message', async t => {
	const result = await scheduleCommand.handler(['logs', 'nonexistent-id']);
	t.truthy(result);
	if (React.isValidElement(result)) {
		const {lastFrame} = renderWithTheme(result);
		const output = lastFrame();
		t.regex(output!, /No runs found/i);
	}
});

// ============================================================================
// Unknown Subcommand Tests
// ============================================================================

test('schedule with unknown subcommand shows error', async t => {
	const result = await scheduleCommand.handler(['foobar']);
	t.truthy(result);
	if (React.isValidElement(result)) {
		const {lastFrame} = renderWithTheme(result);
		const output = lastFrame();
		t.regex(output!, /Unknown subcommand/);
		t.regex(output!, /create/);
		t.regex(output!, /add/);
		t.regex(output!, /list/);
		t.regex(output!, /remove/);
		t.regex(output!, /start/);
		t.regex(output!, /logs/);
	}
});
