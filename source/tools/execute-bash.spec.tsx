import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {themes} from '../config/themes';
import {ThemeContext} from '../hooks/useTheme';
import {bashRunFailed, executeBashTool} from './execute-bash';

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

test('ExecuteBashFormatter shows command for confirmation preview', t => {
	const formatter = executeBashTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	// Formatter is used for confirmation preview - only shows command, not output
	const element = formatter({command: 'echo test'});
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /execute_bash/);
	t.regex(output!, /Command:/);
	t.regex(output!, /echo test/);
});

test('ExecuteBashFormatter shows description when provided', t => {
	const formatter = executeBashTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({
		command: 'git commit -m "feat: add cache" && git push',
		description: 'Commit the staged files and push to remote repository.',
	});
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Description:/);
	t.regex(output!, /Commit the staged files and push to remote repository\./);
	t.regex(output!, /Command:/);
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
	t.notRegex(output!, /Description:/);
});

test('ExecuteBashFormatter splits compound commands onto separate lines', t => {
	const formatter = executeBashTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const command = 'dolt version; echo "==="; ls -la /usr/local/bin/dolt';
	const element = formatter({command});
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	const lines = output!.split('\n');
	t.true(lines.some(line => line.includes('dolt version;')));
	t.true(lines.some(line => line.includes('echo "===";')));
	t.true(lines.some(line => line.includes('ls -la /usr/local/bin/dolt')));
	// The whole point: no single rendered line carries two segments
	t.false(
		lines.some(
			line => line.includes('dolt version;') && line.includes('ls -la'),
		),
		'Compound segments must not share a line',
	);
});

test('ExecuteBashFormatter keeps a quoted semicolon on one line', t => {
	const formatter = executeBashTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter({command: 'echo "hello; world"'});
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	const lines = output!.split('\n');
	t.true(lines.some(line => line.includes('echo "hello; world"')));
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

test('ExecuteBashFormatter wraps long command instead of truncating', t => {
	const formatter = executeBashTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const longCommand =
		'find /very/long/path/to/some/directory -name "*.ts" -exec grep -l "someVeryLongPatternThatExceedsTheTerminalWidth" {} \\; | sort | uniq -c | sort -rn | head -20';
	const element = formatter({command: longCommand});
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /execute_bash/);
	// The command wraps onto multiple lines, so the full command - including its
	// tail - is shown rather than cut off with a truncation ellipsis.
	t.false(output!.includes('…'), 'Command should wrap, not truncate');
	t.true(
		output!.includes('head'),
		'Tail of the long command should still be displayed',
	);
});

// execute_bash returns {llmContent, isError}. These tests assert on the text
// the model receives, so they read llmContent; isError has its own tests.
async function runBash(command: string): Promise<string> {
	const result = await executeBashTool.tool.execute!(
		{command},
		{toolCallId: 'test', messages: []},
	);
	return result.llmContent;
}

// ============================================================================
// Tests for execute_bash Tool Handler - Basic Functionality
// ============================================================================

test('execute_bash runs simple echo command', async t => {
	const result = await runBash('echo "test output"');

	t.truthy(result);
	t.true(result.includes('test output'));
});

test('execute_bash returns output from ls command', async t => {
	const result = await runBash('ls');

	t.truthy(result);
	t.is(typeof result, 'string');
});

test('execute_bash handles command with pipes', async t => {
	const result = await runBash('echo "line1\nline2\nline3" | grep line2');

	t.truthy(result);
	t.true(result.includes('line2'));
	t.false(result.includes('line1'));
});

test('execute_bash handles command with redirects', async t => {
	const result = await runBash('echo "test" 2>&1');

	t.truthy(result);
	t.true(result.includes('test'));
});

test('execute_bash preserves multiline output', async t => {
	const result = await runBash('echo "line1"; echo "line2"; echo "line3"');

	t.truthy(result);
	t.true(result.includes('line1'));
	t.true(result.includes('line2'));
	t.true(result.includes('line3'));
});

// ============================================================================
// Tests for execute_bash Tool Handler - Error Handling
// ============================================================================

test('execute_bash captures stderr output', async t => {
	const result = await runBash('echo "error message" >&2');

	t.truthy(result);
	// Should include STDERR label when stderr is present
	t.true(result.includes('STDERR') || result.includes('error message'));
});

test('execute_bash handles command not found', async t => {
	const result = await runBash('nonexistentcommand12345');

	t.truthy(result);
	// Should capture the error output
	t.true(
		result.includes('not found') ||
			result.includes('command not found') ||
			result.includes('STDERR'),
	);
});

test('execute_bash handles syntax errors', async t => {
	const result = await runBash('echo "unclosed quote');

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
	const result = await runBash(longCommand);

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
	const result = await runBash('echo "short output"');

	t.truthy(result);
	t.false(result.includes('[Output truncated'));
	t.true(result.includes('short output'));
});

test('execute_bash gives the model plain text, not JSON', async t => {
	const result = await runBash('echo "test"');

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
	const result = await runBash('echo "special: $@#%^&*()"');

	t.truthy(result);
	t.true(result.includes('special'));
});

test('execute_bash handles quotes in commands', async t => {
	const result = await runBash('echo "He said \\"hello\\""');

	t.truthy(result);
	t.true(result.includes('said'));
});

test('execute_bash handles newlines in command', async t => {
	const result = await runBash('echo "line1\nline2"');

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
	t.is(typeof executeBashTool.approval, 'function');
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
	const result = await runBash('true');

	// Empty output returns empty string, which is falsy but valid
	t.is(typeof result, 'string');
	// Empty output is still a valid string
	t.true(result.length >= 0);
});

test('execute_bash handles commands with no output', async t => {
	const result = await runBash(':');

	// Empty output returns empty string, which is falsy but valid
	t.is(typeof result, 'string');
});

test('execute_bash handles whitespace-only output', async t => {
	const result = await runBash('echo "   "');

	t.truthy(result);
	t.is(typeof result, 'string');
});

test('execute_bash reports a non-zero exit as an error', async t => {
	// A command that exits non-zero returns normally rather than throwing, so
	// the handler has to say so itself or callers see a successful run.
	const result = await executeBashTool.tool.execute!(
		{command: 'exit 7'},
		{toolCallId: 'test', messages: []},
	);

	t.true(result.isError);
	t.true(result.llmContent.includes('EXIT_CODE: 7'));
});

test('execute_bash leaves a clean run unflagged', async t => {
	const result = await executeBashTool.tool.execute!(
		{command: 'true'},
		{toolCallId: 'test', messages: []},
	);

	t.false(result.isError);
});

test('bashRunFailed: distinguishes a clean run from a failure', t => {
	const base = {
		executionId: 'exec-1',
		command: 'x',
		outputPreview: '',
		fullOutput: '',
		stderr: '',
		isComplete: true,
	};

	t.false(bashRunFailed({...base, exitCode: 0, error: null}));
	t.true(bashRunFailed({...base, exitCode: 1, error: null}));
	t.true(bashRunFailed({...base, exitCode: null, error: 'spawn ENOENT'}));
	// No exit code and no error means the run never reported one - not
	// something to surface as a failed command.
	t.false(bashRunFailed({...base, exitCode: null, error: null}));
});

// The fork-bomb pattern used to be an unescaped regex: `|` acted as
// alternation and `()` as an empty group, so the real bomb slipped through
// while harmless strings like `echo a:{:b` were blocked.
for (const command of [
	':(){ :|:& };:',
	':(){:|:&};:',
	'bomb(){ bomb|bomb& };bomb',
]) {
	test(`execute_bash validator blocks fork bomb ${JSON.stringify(command)}`, async t => {
		const result = await executeBashTool.validator!({command});
		t.false(result.valid);
	});
}

for (const command of ['echo a:{:b', 'ls | grep x &', 'f(){ echo hi; }; f']) {
	test(`execute_bash validator allows ${JSON.stringify(command)}`, async t => {
		const result = await executeBashTool.validator!({command});
		t.true(result.valid);
	});
}
