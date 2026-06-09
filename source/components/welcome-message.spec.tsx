import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import test from 'ava';
import React from 'react';
import {renderWithTheme} from '../test-utils/render-with-theme.js';
import WelcomeMessage from './welcome-message';

console.log('\nwelcome-message.spec.tsx');

// Read version from package.json dynamically to avoid hardcoding
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson = JSON.parse(
	fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'),
) as {version: string};
const VERSION = packageJson.version;

// ============================================================================
// Narrow Terminal Tests (width < 80)
// ============================================================================

test('WelcomeMessage renders compact layout for narrow terminal', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 50; // Narrow terminal

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	// BigText renders ASCII art, so we check the output is rendered
	t.true(output!.length > 0);

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage shows version in narrow layout', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 50;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	// Version from package.json should be displayed
	t.regex(output!, new RegExp(VERSION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage shows quick tips in narrow layout', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 50;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Quick tips/);
	t.regex(output!, /Use natural language/);
	t.regex(output!, /\/help for commands/);
	t.regex(output!, /Ctrl\+C to quit/);

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage has bordered box in narrow layout', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 50;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	// Check for border characters
	t.regex(output!, /│/); // Vertical border
	t.regex(output!, /[═─]/); // Horizontal border

	process.stdout.columns = originalColumns;
});

// ============================================================================
// Normal Terminal Tests (80 <= width < 120)
// ============================================================================

test('WelcomeMessage renders full layout for normal terminal', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80; // Normal terminal

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Nanocoder/); // Should show full logo

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage shows welcome message for normal terminal', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Welcome to Nanocoder/);
	t.regex(output!, new RegExp(VERSION.replace(/\./g, '\\.')));

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage shows concise tips for normal terminal', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Tips for getting started/);
	t.regex(output!, /1\. Use natural language to describe your task\./);
	t.regex(output!, /2\. Ask for file analysis, editing, bash commands and more\./);
	t.regex(output!, /3\. Be specific for best results\./);
	t.regex(output!, /4\. Type \/exit or press Ctrl\+C to quit\./);

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage shows help command for normal terminal', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /\/help for help/);

	process.stdout.columns = originalColumns;
});

// ============================================================================
// Wide Terminal Tests (width >= 120)
// ============================================================================

test('WelcomeMessage renders full layout for wide terminal', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 120; // Wide terminal

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Nanocoder/); // Full logo

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage shows verbose tips for wide terminal', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 120;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /1\. Use natural language to describe what you want to build\./);
	t.regex(output!, /3\. Be specific as you would with another engineer for best results\./);

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
	// BigText and Gradient should render something
	t.true(output!.length > 0);

	process.stdout.columns = originalColumns;
});

// ============================================================================
// Edge Cases
// ============================================================================

test('WelcomeMessage handles boundary at width 80', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80; // Boundary between narrow and normal

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	// At width 80, should be normal, not narrow
	t.regex(output!, /Nanocoder/); // Full logo for normal

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage handles boundary at width 120', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 120; // Boundary between normal and wide

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	// At width 120, should be wide
	t.regex(output!, /as you would with another engineer/); // Wide tip

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage handles very narrow terminal', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 30; // Very narrow

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	// BigText renders ASCII art, so we check the output is rendered
	t.true(output!.length > 0);

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage handles very wide terminal', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 200; // Very wide

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Nanocoder/);

	process.stdout.columns = originalColumns;
});
