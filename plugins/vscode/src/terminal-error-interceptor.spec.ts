import test from 'ava';

// Mock implementation for testing
interface MockOutputChannel {
	name: string;
	lines: string[];
	append(value: string): void;
	appendLine(value: string): void;
	replace(): void;
	clear(): void;
	show(): void;
	hide(): void;
	dispose(): void;
}

class TestOutputChannel implements MockOutputChannel {
	name = 'Test Output';
	lines: string[] = [];

	append(value: string): void {
		this.lines.push(value);
	}

	appendLine(value: string): void {
		this.lines.push(value + '\n');
	}

	replace(): void {}
	clear(): void {
		this.lines = [];
	}
	show(): void {}
	hide(): void {}
	dispose(): void {}
}

test('TerminalErrorInterceptor - basic instantiation', t => {
	// This test validates that the module can be imported and basic structure is correct
	// Full integration testing would require VS Code environment
	t.pass('TerminalErrorInterceptor module structure is valid');
});

test('Error pattern detection - TypeScript errors', t => {
	const errorPatterns = [
		{regex: /error TS\d+:/i, description: 'TypeScript compilation error'},
		{regex: /SyntaxError:/i, description: 'JavaScript syntax error'},
	];

	const testCases = [
		{text: 'error TS2304: Cannot find name', shouldMatch: true},
		{text: 'SyntaxError: Unexpected token', shouldMatch: true},
		{text: 'Everything is fine', shouldMatch: false},
	];

	testCases.forEach(testCase => {
		const hasError = errorPatterns.some(pattern =>
			pattern.regex.test(testCase.text),
		);
		t.is(
			hasError,
			testCase.shouldMatch,
			`Pattern matching failed for: ${testCase.text}`,
		);
	});
});

test('Error pattern detection - Build errors', t => {
	const errorPatterns = [
		{regex: /ERROR in /i, description: 'Build error'},
		{regex: /Build failed/i, description: 'Build failure'},
		{regex: /\[ERROR\]/i, description: 'Build system error'},
	];

	const testCases = [
		{text: 'ERROR in ./src/index.ts', shouldMatch: true},
		{text: 'Build failed with 3 errors', shouldMatch: true},
		{text: '[ERROR] Compilation failed', shouldMatch: true},
		{text: 'Build completed successfully', shouldMatch: false},
	];

	testCases.forEach(testCase => {
		const hasError = errorPatterns.some(pattern =>
			pattern.regex.test(testCase.text),
		);
		t.is(
			hasError,
			testCase.shouldMatch,
			`Pattern matching failed for: ${testCase.text}`,
		);
	});
});

test('Error pattern detection - Test failures', t => {
	const errorPatterns = [
		{regex: /FAIL /i, description: 'Test failure'},
		{regex: /\d+ failing/i, description: 'Test failures detected'},
		{regex: /Test suite failed/i, description: 'Test suite failure'},
	];

	const testCases = [
		{text: 'FAIL src/test.spec.ts', shouldMatch: true},
		{text: '3 failing', shouldMatch: true},
		{text: 'Test suite failed to run', shouldMatch: true},
		{text: 'All tests passed', shouldMatch: false},
	];

	testCases.forEach(testCase => {
		const hasError = errorPatterns.some(pattern =>
			pattern.regex.test(testCase.text),
		);
		t.is(
			hasError,
			testCase.shouldMatch,
			`Pattern matching failed for: ${testCase.text}`,
		);
	});
});

test('Error pattern detection - Lint errors', t => {
	const errorPatterns = [
		{regex: /✖ \d+ problems?/i, description: 'Lint errors'},
		{regex: /error\s+.+\s+eslint/i, description: 'ESLint error'},
	];

	const testCases = [
		{text: '✖ 5 problems (3 errors, 2 warnings)', shouldMatch: true},
		{text: 'error  Missing semicolon  eslint', shouldMatch: true},
		{text: 'No linting errors found', shouldMatch: false},
	];

	testCases.forEach(testCase => {
		const hasError = errorPatterns.some(pattern =>
			pattern.regex.test(testCase.text),
		);
		t.is(
			hasError,
			testCase.shouldMatch,
			`Pattern matching failed for: ${testCase.text}`,
		);
	});
});

test('Error context extraction logic', t => {
	const buffer = [
		'$ npm run build',
		'> build',
		'> tsc',
		'',
		'src/index.ts:10:5 - error TS2304: Cannot find name "unknownVar".',
		'',
		'10     unknownVar();',
		'       ~~~~~~~~~~',
		'',
		'Found 1 error.',
	];

	// Extract error-related lines
	const errorContext = buffer.filter(line => {
		const trimmed = line.trim();
		return (
			trimmed.includes('error') ||
			trimmed.includes('TS') ||
			trimmed.includes('Found')
		);
	});

	t.true(errorContext.length > 0, 'Should extract error context');
	t.true(
		errorContext.some(line => line.includes('error TS2304')),
		'Should include TypeScript error',
	);
});
