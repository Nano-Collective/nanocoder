import React from 'react';
import test from 'ava';
import {render} from 'ink-testing-library';
import {executeBashTool} from './execute-bash';
import {ThemeContext} from '../hooks/useTheme';
import {themes} from '../config/themes';

// ============================================================================
// Test Helpers
// ============================================================================

console.log(`\nexecute-bash.spec.tsx – ${React.version}`);

// Create a mock theme provider for tests
function TestThemeProvider({children}: {children: React.ReactNode}) {
	const themeContextValue = {
		currentTheme: 'tokyo-night' as const,
		colors: themes['tokyo-night'].colors,
		setCurrentTheme: () => {},
	};

	return (
		<ThemeContext.Provider value={themeContextValue}>
			{children}
		</ThemeContext.Provider>
	);
}

// ============================================================================
// Tests for ExecuteBashFormatter Component Rendering
// ============================================================================

test('ExecuteBashFormatter renders with command', t => {
	const formatter = executeBashTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({command: 'echo "hello"'}, 'hello');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /execute_bash/);
	t.regex(output!, /echo "hello"/);
});

test('ExecuteBashFormatter displays output size', t => {
	const formatter = executeBashTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const result = 'test output';
	const element = formatter({command: 'echo test'}, result);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /characters/);
	t.regex(output!, /tokens/);
});

test('ExecuteBashFormatter renders without result', t => {
	const formatter = executeBashTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({command: 'ls'});
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /execute_bash/);
	t.regex(output!, /ls/);
});

test('ExecuteBashFormatter handles complex commands', t => {
	const formatter = executeBashTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const command = 'find . -name "*.ts" | grep -v node_modules';
	const element = formatter({command}, 'file1.ts\nfile2.ts');
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /find/);
});

// ============================================================================
// Tests for execute_bash Tool Handler - Basic Functionality
// ============================================================================

test('execute_bash runs simple echo command', async t => {
	const result = await executeBashTool.tool.execute!(
		{command: 'echo "test output"'},
		{toolCallId: 'test', messages: []},
	);

	t.truthy(result);
	t.true(result.includes('test output'));
});

test('execute_bash returns output from ls command', async t => {
	const result = await executeBashTool.tool.execute!(
		{command: 'ls'},
		{toolCallId: 'test', messages: []},
	);

	t.truthy(result);
	t.is(typeof result, 'string');
});

test('execute_bash handles command with pipes', async t => {
	const result = await executeBashTool.tool.execute!(
		{
			command: 'echo "line1\nline2\nline3" | grep line2',
		},
		{toolCallId: 'test', messages: []},
	);

	t.truthy(result);
	t.true(result.includes('line2'));
	t.false(result.includes('line1'));
});

test('execute_bash handles command with redirects', async t => {
	const result = await executeBashTool.tool.execute!(
		{
			command: 'echo "test" 2>&1',
		},
		{toolCallId: 'test', messages: []},
	);

	t.truthy(result);
	t.true(result.includes('test'));
});

test('execute_bash preserves multiline output', async t => {
	const result = await executeBashTool.tool.execute!(
		{
			command: 'echo "line1"; echo "line2"; echo "line3"',
		},
		{toolCallId: 'test', messages: []},
	);

	t.truthy(result);
	t.true(result.includes('line1'));
	t.true(result.includes('line2'));
	t.true(result.includes('line3'));
});

// ============================================================================
// Tests for execute_bash Tool Handler - Error Handling
// ============================================================================

test('execute_bash captures stderr output', async t => {
	const result = await executeBashTool.tool.execute!(
		{
			command: 'echo "error message" >&2',
		},
		{toolCallId: 'test', messages: []},
	);

	t.truthy(result);
	// Should include STDERR label when stderr is present
	t.true(result.includes('STDERR') || result.includes('error message'));
});

test('execute_bash handles command not found', async t => {
	const result = await executeBashTool.tool.execute!(
		{
			command: 'nonexistentcommand12345',
		},
		{toolCallId: 'test', messages: []},
	);

	t.truthy(result);
	// Should capture the error output
	t.true(
		result.includes('not found') ||
			result.includes('command not found') ||
			result.includes('STDERR'),
	);
});

test('execute_bash handles syntax errors', async t => {
	const result = await executeBashTool.tool.execute!(
		{
			command: 'echo "unclosed quote',
		},
		{toolCallId: 'test', messages: []},
	);

	t.truthy(result);
	// Should capture the syntax error
	t.is(typeof result, 'string');
});

// ============================================================================
// Tests for execute_bash Tool Handler - Output Truncation
// ============================================================================

test('execute_bash truncates long output to 2000 characters', async t => {
	// Generate output longer than 2000 characters
	// Use POSIX-compatible syntax (seq instead of bash brace expansion)
	const longCommand =
		'seq 1 100 | while read i; do echo "This is a long line of text that repeats many times"; done';
	const result = await executeBashTool.tool.execute!(
		{command: longCommand},
		{toolCallId: 'test', messages: []},
	);

	t.truthy(result);
	// Should be truncated to around 2000 characters
	t.true(
		result.length <= 2100,
		`Output length ${result.length} should be <= 2100`,
	);
	// Should include truncation message
	t.true(result.includes('[Output truncated'));
});

test('execute_bash does not truncate short output', async t => {
	const result = await executeBashTool.tool.execute!(
		{
			command: 'echo "short output"',
		},
		{toolCallId: 'test', messages: []},
	);

	t.truthy(result);
	t.false(result.includes('[Output truncated'));
	t.true(result.includes('short output'));
});

test('execute_bash returns plain string not JSON', async t => {
	const result = await executeBashTool.tool.execute!(
		{command: 'echo "test"'},
		{toolCallId: 'test', messages: []},
	);

	t.truthy(result);
	t.is(typeof result, 'string');
	// Should NOT be JSON with fullOutput and llmContext
	t.false(result.includes('fullOutput'));
	t.false(result.includes('llmContext'));
});

// ============================================================================
// Tests for execute_bash Tool Handler - Special Characters
// ============================================================================

test('execute_bash handles special characters in output', async t => {
	const result = await executeBashTool.tool.execute!(
		{
			command: 'echo "special: $@#%^&*()"',
		},
		{toolCallId: 'test', messages: []},
	);

	t.truthy(result);
	t.true(result.includes('special'));
});

test('execute_bash handles quotes in commands', async t => {
	const result = await executeBashTool.tool.execute!(
		{
			command: 'echo "He said \\"hello\\""',
		},
		{toolCallId: 'test', messages: []},
	);

	t.truthy(result);
	t.true(result.includes('said'));
});

test('execute_bash handles newlines in command', async t => {
	const result = await executeBashTool.tool.execute!(
		{
			command: 'echo "line1\nline2"',
		},
		{toolCallId: 'test', messages: []},
	);

	t.truthy(result);
	t.is(typeof result, 'string');
});

// ============================================================================
// Tests for execute_bash Tool Configuration
// ============================================================================

test('execute_bash tool has correct name', t => {
	t.is(executeBashTool.name, 'execute_bash');
});

test('execute_bash tool requires confirmation', t => {
	// Execute bash should require confirmation for security
	t.not(executeBashTool.tool.needsApproval, false);
});

test('execute_bash tool has handler function', t => {
	t.is(typeof executeBashTool.tool.execute, 'function');
});

test('execute_bash tool has formatter function', t => {
	t.is(typeof executeBashTool.formatter, 'function');
});

// ============================================================================
// Tests for execute_bash Tool Handler - Edge Cases
// ============================================================================

test('execute_bash handles empty command output', async t => {
	const result = await executeBashTool.tool.execute!(
		{command: 'true'},
		{toolCallId: 'test', messages: []},
	);

	// Empty output returns empty string, which is falsy but valid
	t.is(typeof result, 'string');
	// Empty output is still a valid string
	t.true(result.length >= 0);
});

test('execute_bash handles commands with no output', async t => {
	const result = await executeBashTool.tool.execute!(
		{command: ':'},
		{toolCallId: 'test', messages: []},
	);

	// Empty output returns empty string, which is falsy but valid
	t.is(typeof result, 'string');
});

test('execute_bash handles whitespace-only output', async t => {
	const result = await executeBashTool.tool.execute!(
		{command: 'echo "   "'},
		{toolCallId: 'test', messages: []},
	);

	t.truthy(result);
	t.is(typeof result, 'string');
});
