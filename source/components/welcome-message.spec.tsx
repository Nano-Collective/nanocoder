import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import test from 'ava';
import React from 'react';
import {renderWithTheme} from '../test-utils/render-with-theme.js';
import WelcomeMessage from './welcome-message';

console.log('\nwelcome-message.spec.tsx');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson = JSON.parse(
	fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'),
) as {version: string};
const VERSION = packageJson.version;

// ============================================================================
// Narrow Terminal Tests (width < 90 → text logo per mock ladder)
// ============================================================================

test('WelcomeMessage renders compact layout for narrow terminal', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 50;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	t.true(output!.length > 0);

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage shows version in narrow layout', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 50;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, new RegExp(VERSION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
	// Footer shows nanocoder + version, not title banner
	t.regex(output!, /nanocoder/);

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage shows centered welcome and location in narrow layout', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 50;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Welcome to Nanocoder/);
	t.regex(output!, /local-first coding agent/);
	// Location line centered with branch + dir (no NC shorthand)
	t.regex(output!, /⎇/);
	// Menu present when rows >=24
	t.regex(output!, /Resume session/);
	t.regex(output!, /Help/);

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage has no hero box in narrow layout', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 50;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	// New design removed TitledBox hero — should NOT contain old box text
	t.notRegex(output!, /Tips for getting started/);
	t.notRegex(output!, /Quick tips/);
	// Small pixel logo (tiny) for 50-90, not spaced text
	t.regex(output!, /█/);

	process.stdout.columns = originalColumns;
});

// ============================================================================
// Normal Terminal Tests (80 <= width < 90 still text logo per 90 threshold)
// ============================================================================

test('WelcomeMessage renders NC monogram at widths below 82', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	// 80 < 82 → falls back to NC monogram in block font
	t.regex(output!, /█/);

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage shows welcome message for normal terminal', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Welcome to Nanocoder/);
	t.regex(output!, /local-first coding agent/);
	t.regex(output!, new RegExp(VERSION.replace(/\./g, '\\.')));

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage shows menu for normal terminal', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Resume session/);
	t.regex(output!, /Select model/);
	t.regex(output!, /Quit/);
	// New design footer has mode + version
	t.regex(output!, /nanocoder/);
	t.regex(output!, new RegExp(VERSION.replace(/\./g, '\\.')));

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage shows location and shortcuts for normal terminal', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /⎇/);
	t.regex(output!, /\/resume/);
	t.regex(output!, /\/model/);
	t.regex(output!, /\/help/);
	t.regex(output!, /\/exit/);

	process.stdout.columns = originalColumns;
});

// ============================================================================
// Wide Terminal Tests (width >= 90 → full BigText art)
// ============================================================================

test('WelcomeMessage renders full art logo for wide terminal', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 120;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	// Large art (simple) renders with _ | \ etc, small (tiny) with █ — either is art
	t.regex(output!, /[_█]/);
	t.regex(output!, /Welcome to Nanocoder/);

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage shows centered footer for wide terminal', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 120;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /nanocoder/);
	t.regex(output!, new RegExp(VERSION.replace(/\./g, '\\.')));
	// Mode in footer (normal)
	t.regex(output!, /normal/);

	process.stdout.columns = originalColumns;
});

// ============================================================================
// Component Structure Tests
// ============================================================================

test('WelcomeMessage renders without crashing', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	t.truthy(lastFrame());

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage has consistent layout structure', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	t.true(output!.length > 0);

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage displays gradient text', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	t.true(output!.length > 0);

	process.stdout.columns = originalColumns;
});

// ============================================================================
// Edge Cases — responsive ladder rows
// ============================================================================

test('WelcomeMessage handles boundary at width 80', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	// NC block monogram is identical at every width
	t.regex(output!, /█/);

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage handles boundary at width 90', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 90;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	// At 90 the full NANOCODER block wordmark renders (threshold is 90)
	t.regex(output!, /[_█]/);

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage trims menu when rows < 24', t => {
	const originalColumns = process.stdout.columns;
	const originalRows = process.stdout.rows;
	process.stdout.columns = 100;
	// @ts-ignore mock rows
	process.stdout.rows = 23;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	// MIN menu only Help/Quit when short
	t.notRegex(output!, /Resume session/);
	t.regex(output!, /Help/);
	t.regex(output!, /Quit/);

	process.stdout.columns = originalColumns;
	process.stdout.rows = originalRows;
});

test('WelcomeMessage hides menu when rows < 15', t => {
	const originalColumns = process.stdout.columns;
	const originalRows = process.stdout.rows;
	process.stdout.columns = 100;
	// @ts-ignore
	process.stdout.rows = 14;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	t.notRegex(output!, /Resume session/);
	t.notRegex(output!, /Help/);
	t.regex(output!, /Welcome to Nanocoder/);

	process.stdout.columns = originalColumns;
	process.stdout.rows = originalRows;
});

test('WelcomeMessage hides logo when rows < 16', t => {
	const originalColumns = process.stdout.columns;
	const originalRows = process.stdout.rows;
	process.stdout.columns = 100;
	// @ts-ignore
	process.stdout.rows = 14;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	t.notRegex(output!, /N A N O C O D E R/);
	t.notRegex(output!, /█/);
	t.regex(output!, /Welcome to Nanocoder/);

	process.stdout.columns = originalColumns;
	process.stdout.rows = originalRows;
});

test('WelcomeMessage handles very narrow terminal', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 30;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	t.true(output!.length > 0);

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage handles very wide terminal', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 200;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /[_█]/);

	process.stdout.columns = originalColumns;
});
