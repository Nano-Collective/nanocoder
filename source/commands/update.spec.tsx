import test from 'ava';
import {setToolManagerGetter} from '../message-handler.js';
import {hasCommandFailed, updateCommand} from './update.js';

console.log(`\nupdate.spec.tsx`);

// Helper to create a mock ToolManager with a custom execute_bash handler
function mockToolManager(executeBash: (args: any) => Promise<string>) {
	return {
		getToolHandler: (name: string) => {
			if (name === 'execute_bash') return executeBash;
			return undefined;
		},
	} as any;
}

// Command Metadata Tests
// These tests verify the command is properly configured

test('updateCommand: has correct name', t => {
	t.is(updateCommand.name, 'update');
});

test('updateCommand: has description', t => {
	t.truthy(updateCommand.description);
	t.true(updateCommand.description.length > 0);
	t.regex(updateCommand.description, /update/i);
});

test('updateCommand: has handler function', t => {
	t.is(typeof updateCommand.handler, 'function');
});

test('updateCommand: handler is async', t => {
	const result = updateCommand.handler([]);
	t.truthy(result);
	t.true(result instanceof Promise);
});

// Basic behavior: when update available and installed via npm, handler runs npm update -g
test('updateCommand: runs update command when installed via npm', async t => {
	// Mock fetch to return newer version
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () => {
		return {
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => ({
				version: '99.99.99',
				name: '@nanocollective/nanocoder',
			}),
		} as unknown as Response;
	}) as typeof fetch;

	// Set installation method override
	process.env.NANOCODER_INSTALL_METHOD = 'npm';

	let called = false;
	setToolManagerGetter(() =>
		mockToolManager(async ({command}: {command: string}) => {
			called = true;
			t.is(command, 'npm update -g @nanocollective/nanocoder');
			return 'ok';
		}),
	);

	await updateCommand.handler([]);

	// Cleanup
	setToolManagerGetter(() => null);
	globalThis.fetch = originalFetch;
	delete process.env.NANOCODER_INSTALL_METHOD;

	t.true(called);
});

test('updateCommand: does not run execute_bash for nix installations', async t => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () => {
		return {
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => ({
				version: '99.99.99',
				name: '@nanocollective/nanocoder',
			}),
		} as unknown as Response;
	}) as typeof fetch;

	process.env.NANOCODER_INSTALL_METHOD = 'nix';

	let called = false;
	setToolManagerGetter(() =>
		mockToolManager(async () => {
			called = true;
			return 'ok';
		}),
	);

	await updateCommand.handler([]);

	// Cleanup
	setToolManagerGetter(() => null);
	globalThis.fetch = originalFetch;
	delete process.env.NANOCODER_INSTALL_METHOD;

	t.false(called);
});

test('updateCommand: handles execute_bash failure with error message', async t => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () => {
		return {
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => ({
				version: '99.99.99',
				name: '@nanocollective/nanocoder',
			}),
		} as unknown as Response;
	}) as typeof fetch;

	process.env.NANOCODER_INSTALL_METHOD = 'npm';

	setToolManagerGetter(() =>
		mockToolManager(async () => {
			throw new Error('command failed: permission denied');
		}),
	);

	const result = await updateCommand.handler([]);
	// Expect the result is a React element with props.message containing 'Failed to execute'
	// @ts-ignore
	t.truthy(result.props?.message?.includes('Failed to execute'));

	// Cleanup
	setToolManagerGetter(() => null);
	globalThis.fetch = originalFetch;
	delete process.env.NANOCODER_INSTALL_METHOD;
});

// Error Detection Tests
// These tests verify the hasCommandFailed function correctly identifies failures

test('hasCommandFailed: detects failure via exit code', t => {
	const output = 'EXIT_CODE: 1\nSome error occurred';
	t.true(hasCommandFailed(output));
});

test('hasCommandFailed: detects success via exit code 0', t => {
	const output = 'EXIT_CODE: 0\nSuccess message';
	t.false(hasCommandFailed(output));
});

test('hasCommandFailed: detects "command not found" error', t => {
	const output = 'EXIT_CODE: 127\nSTDERR:\nbash: foobar: command not found';
	t.true(hasCommandFailed(output));
});

test('hasCommandFailed: detects "permission denied" error', t => {
	const output = 'EXIT_CODE: 1\nSTDERR:\npermission denied';
	t.true(hasCommandFailed(output));
});

test('hasCommandFailed: detects "no such file or directory" error', t => {
	const output = 'EXIT_CODE: 2\nSTDERR:\nno such file or directory';
	t.true(hasCommandFailed(output));
});

test('hasCommandFailed: does not false positive on "0 errors"', t => {
	const output = 'EXIT_CODE: 0\nBuild completed with 0 errors';
	t.false(hasCommandFailed(output));
});

test('hasCommandFailed: does not false positive on "error-free"', t => {
	const output = 'EXIT_CODE: 0\nThe build was error-free';
	t.false(hasCommandFailed(output));
});

test('hasCommandFailed: does not false positive on "no errors found"', t => {
	const output = 'EXIT_CODE: 0\nScan complete: no errors found';
	t.false(hasCommandFailed(output));
});

test('hasCommandFailed: detects "error:" at start of line', t => {
	const output = 'EXIT_CODE: 1\nSTDERR:\nerror: something went wrong';
	t.true(hasCommandFailed(output));
});

test('hasCommandFailed: detects "fatal" error', t => {
	const output = 'EXIT_CODE: 1\nSTDERR:\nfatal: Not a git repository';
	t.true(hasCommandFailed(output));
});

test('hasCommandFailed: detects "failed" message', t => {
	const output = 'EXIT_CODE: 1\nSTDERR:\nOperation failed';
	t.true(hasCommandFailed(output));
});

test('hasCommandFailed: handles output with only STDERR (non-error)', t => {
	// Some tools write progress to stderr
	const output = 'EXIT_CODE: 0\nSTDERR:\nDownloading... 100%\nSTDOUT:\nSuccess';
	t.false(hasCommandFailed(output));
});

test('hasCommandFailed: handles output with only STDERR (with error)', t => {
	const output =
		'EXIT_CODE: 1\nSTDERR:\nDownload failed due to network error\nSTDOUT:\n';
	t.true(hasCommandFailed(output));
});

test('hasCommandFailed: handles empty output', t => {
	const output = '';
	t.false(hasCommandFailed(output));
});

test('hasCommandFailed: handles null/undefined output', t => {
	// @ts-ignore - testing edge case
	t.false(hasCommandFailed(null));
	// @ts-ignore - testing edge case
	t.false(hasCommandFailed(undefined));
});

test('hasCommandFailed: exit code takes precedence over success messages', t => {
	// Even if output looks successful, exit code 1 means failure
	const output = 'EXIT_CODE: 1\nAll tests passed successfully!';
	t.true(hasCommandFailed(output));
});

// Homebrew error handling
test('updateCommand: detects homebrew "not found" error', t => {
	const output =
		'EXIT_CODE: 1\nSTDERR:\nError: nanocoder not found in Homebrew\nPlease install it first with: brew install nanocoder';
	t.true(hasCommandFailed(output));
});

// Edge case: both updateCommand and updateMessage undefined
test('updateCommand: handles edge case when both updateCommand and updateMessage are undefined', async t => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () => {
		return {
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => ({
				version: '99.99.99',
				name: '@nanocollective/nanocoder',
			}),
		} as unknown as Response;
	}) as typeof fetch;

	// Set an unknown installation method that won't return a command or message
	process.env.NANOCODER_INSTALL_METHOD = 'unknown';

	const result = await updateCommand.handler([]);

	// Should return the fallback InfoMessage
	// @ts-ignore - accessing React element props
	t.truthy(result.props?.message);
	// @ts-ignore
	t.regex(result.props.message, /package manager/i);

	// Cleanup
	globalThis.fetch = originalFetch;
	delete process.env.NANOCODER_INSTALL_METHOD;
});

// Note: Full integration tests with mocking would require a more sophisticated
// test setup with module mocking capabilities. The update-checker.spec.ts file
// provides comprehensive coverage of the update checking logic itself.
// This file focuses on verifying the command is properly structured and registered.
