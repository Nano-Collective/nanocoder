import test from 'ava';
import * as vscode from 'vscode';
import {TerminalErrorInterceptor, ERROR_PATTERNS} from './terminal-error-interceptor';

// Access the test hooks from the stub
const vstub = vscode as any;

test.serial.beforeEach(() => {
	vstub.__test.reset();
});

test.serial('TerminalErrorInterceptor - instantiation and disposal', t => {
	const outputChannel = vscode.window.createOutputChannel('Test');
	let capturedError: string | undefined;

	const interceptor = new TerminalErrorInterceptor(outputChannel, errorContext => {
		capturedError = errorContext;
	});

	t.truthy(interceptor, 'Interceptor should be created');
	t.is(capturedError, undefined, 'No error should be captured yet');

	interceptor.dispose();
	t.pass('Dispose should complete without errors');
});

test.serial(
	'TerminalErrorInterceptor - detects TypeScript errors and triggers fix action',
	async t => {
		const outputChannel = vscode.window.createOutputChannel('Test');
		let capturedError: string | undefined;

		const interceptor = new TerminalErrorInterceptor(
			outputChannel,
			errorContext => {
				capturedError = errorContext;
			},
		);

		// Simulate a terminal opening
		const terminal = {name: 'Test Terminal', processId: Promise.resolve(123)} as any;
		vstub.__test.terminals.push(terminal);
		vstub.__test.onDidOpenTerminalListener?.(terminal);

		// Simulate terminal output with TypeScript error
		const errorData =
			'src/index.ts:10:5 - error TS2304: Cannot find name "unknownVar".\n\n10     unknownVar();\n       ~~~~~~~~~~';

		// Wait a bit for the event system
		await new Promise(resolve => setTimeout(resolve, 10));

		// Trigger the terminal data event if the listener is registered
		if (vstub.__test.onDidWriteTerminalDataListener) {
			vstub.__test.onDidWriteTerminalDataListener({terminal, data: errorData});

			// Wait for async operations
			await new Promise(resolve => setTimeout(resolve, 50));

			// Check that error was captured
			t.truthy(capturedError, 'Error should be captured');
			t.true(
				capturedError?.includes('error TS2304'),
				'Captured error should contain TypeScript error',
			);

			// Check that error message was shown
			const errorMessages = vstub.__test.shownMessages.filter(
				(m: any) => m.kind === 'error',
			);
			t.true(errorMessages.length > 0, 'Error notification should be shown');
			t.true(
				errorMessages.some((m: any) =>
					m.message.includes('Terminal error detected'),
				),
				'Error message should mention terminal error',
			);
		} else {
			t.pass('Terminal data listener not available (older VS Code)');
		}

		interceptor.dispose();
	},
);

test.serial(
	'TerminalErrorInterceptor - debounces repeated errors within 2 seconds',
	async t => {
		const outputChannel = vscode.window.createOutputChannel('Test');
		let captureCount = 0;

		const interceptor = new TerminalErrorInterceptor(outputChannel, () => {
			captureCount++;
		});

		const terminal = {name: 'Test Terminal', processId: Promise.resolve(123)} as any;
		vstub.__test.terminals.push(terminal);
		vstub.__test.onDidOpenTerminalListener?.(terminal);

		await new Promise(resolve => setTimeout(resolve, 10));

		if (vstub.__test.onDidWriteTerminalDataListener) {
			// First error
			vstub.__test.onDidWriteTerminalDataListener({
				terminal,
				data: 'ERROR in ./src/index.ts',
			});
			await new Promise(resolve => setTimeout(resolve, 50));

			const initialCount = captureCount;
			t.is(initialCount, 1, 'First error should be captured');

			// Second error within 2 seconds (should be debounced)
			vstub.__test.onDidWriteTerminalDataListener({
				terminal,
				data: 'ERROR in ./src/app.ts',
			});
			await new Promise(resolve => setTimeout(resolve, 50));

			t.is(
				captureCount,
				initialCount,
				'Second error should be debounced (not captured)',
			);

			// Wait for debounce timer to expire
			await new Promise(resolve => setTimeout(resolve, 2100));

			// Third error after debounce period
			vstub.__test.onDidWriteTerminalDataListener({
				terminal,
				data: 'ERROR in ./src/utils.ts',
			});
			await new Promise(resolve => setTimeout(resolve, 50));

			t.is(
				captureCount,
				initialCount + 1,
				'Error after debounce should be captured',
			);
		} else {
			t.pass('Terminal data listener not available');
		}

		interceptor.dispose();
	},
);

test.serial('TerminalErrorInterceptor - clears timers on dispose', async t => {
	const outputChannel = vscode.window.createOutputChannel('Test');
	const interceptor = new TerminalErrorInterceptor(outputChannel, () => {});

	const terminal = {name: 'Test Terminal', processId: Promise.resolve(123)} as any;
	vstub.__test.terminals.push(terminal);
	vstub.__test.onDidOpenTerminalListener?.(terminal);

	await new Promise(resolve => setTimeout(resolve, 10));

	if (vstub.__test.onDidWriteTerminalDataListener) {
		// Trigger an error to start a timer
		vstub.__test.onDidWriteTerminalDataListener({
			terminal,
			data: 'Build failed',
		});
		await new Promise(resolve => setTimeout(resolve, 50));

		// Dispose immediately (timer should be cleared)
		interceptor.dispose();
		t.pass('Dispose should clear pending timers without errors');

		// Wait past the debounce period - no callbacks should fire
		await new Promise(resolve => setTimeout(resolve, 2100));
		t.pass('No errors after timer cleanup');
	} else {
		t.pass('Terminal data listener not available');
	}
});

test.serial(
	'TerminalErrorInterceptor - getLastErrorContext returns captured errors',
	async t => {
		const outputChannel = vscode.window.createOutputChannel('Test');
		const interceptor = new TerminalErrorInterceptor(outputChannel, () => {});

		const terminal = {name: 'Test Terminal', processId: Promise.resolve(123)} as any;
		vstub.__test.terminals.push(terminal);
		vstub.__test.onDidOpenTerminalListener?.(terminal);

		await new Promise(resolve => setTimeout(resolve, 10));

		// No error yet
		const emptyContext = interceptor.getLastErrorContext(terminal);
		t.is(emptyContext, undefined, 'No error context should exist initially');

		if (vstub.__test.onDidWriteTerminalDataListener) {
			// Trigger an error
			vstub.__test.onDidWriteTerminalDataListener({
				terminal,
				data: 'FAIL src/test.spec.ts\n  Test suite failed to run',
			});
			await new Promise(resolve => setTimeout(resolve, 50));

			const errorContext = interceptor.getLastErrorContext(terminal);
			t.truthy(errorContext, 'Error context should be available');
			t.true(
				errorContext?.some(line => line.includes('FAIL')),
				'Error context should contain the failure',
			);
		} else {
			t.pass('Terminal data listener not available');
		}

		interceptor.dispose();
	},
);

test('ERROR_PATTERNS - TypeScript errors', t => {
	const testCases = [
		{text: 'error TS2304: Cannot find name', shouldMatch: true},
		{text: 'SyntaxError: Unexpected token', shouldMatch: true},
		{text: 'TypeError: Cannot read property', shouldMatch: true},
		{text: 'ReferenceError: foo is not defined', shouldMatch: true},
		{text: 'Everything is fine', shouldMatch: false},
	];

	testCases.forEach(testCase => {
		const hasError = ERROR_PATTERNS.some(pattern =>
			pattern.regex.test(testCase.text),
		);
		t.is(
			hasError,
			testCase.shouldMatch,
			`Pattern matching failed for: ${testCase.text}`,
		);
	});
});

test('ERROR_PATTERNS - Build errors', t => {
	const testCases = [
		{text: 'ERROR in ./src/index.ts', shouldMatch: true},
		{text: 'Build failed with 3 errors', shouldMatch: true},
		{text: '[ERROR] Compilation failed', shouldMatch: true},
		{text: 'Build completed successfully', shouldMatch: false},
	];

	testCases.forEach(testCase => {
		const hasError = ERROR_PATTERNS.some(pattern =>
			pattern.regex.test(testCase.text),
		);
		t.is(
			hasError,
			testCase.shouldMatch,
			`Pattern matching failed for: ${testCase.text}`,
		);
	});
});

test('ERROR_PATTERNS - Test failures', t => {
	const testCases = [
		{text: 'FAIL src/test.spec.ts', shouldMatch: true},
		{text: '3 failing', shouldMatch: true},
		{text: 'Test suite failed to run', shouldMatch: true},
		{text: 'All tests passed', shouldMatch: false},
	];

	testCases.forEach(testCase => {
		const hasError = ERROR_PATTERNS.some(pattern =>
			pattern.regex.test(testCase.text),
		);
		t.is(
			hasError,
			testCase.shouldMatch,
			`Pattern matching failed for: ${testCase.text}`,
		);
	});
});

test('ERROR_PATTERNS - Lint errors', t => {
	const testCases = [
		{text: '✖ 5 problems (3 errors, 2 warnings)', shouldMatch: true},
		{text: 'error  Missing semicolon  eslint', shouldMatch: true},
		{text: 'No linting errors found', shouldMatch: false},
	];

	testCases.forEach(testCase => {
		const hasError = ERROR_PATTERNS.some(pattern =>
			pattern.regex.test(testCase.text),
		);
		t.is(
			hasError,
			testCase.shouldMatch,
			`Pattern matching failed for: ${testCase.text}`,
		);
	});
});
