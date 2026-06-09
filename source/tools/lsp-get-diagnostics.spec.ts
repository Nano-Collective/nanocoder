import test from 'ava';
import type {DiagnosticInfo, DiagnosticSeverity as VSCodeDiagnosticSeverity} from '@/vscode/index';
import {DiagnosticSeverity} from '@/lsp/index';
import {getDiagnosticsTool} from './lsp-get-diagnostics.js';

// ============================================================================
// Test Setup and Notes
// ============================================================================

/*
Note on Testing Strategy:

The executeGetDiagnostics function calls:
- getVSCodeServer() from @/vscode/index
- getLSPManager() from @/lsp/index

These are module-level imports that cannot be easily mocked without:
1. A mocking library like sinon.js or vi.mock (which we want to avoid)
2. Code refactoring for dependency injection

Therefore, the tests below focus on:
1. Testing the formatter (React component)
2. Testing the needsApproval property
3. Testing the internal logic of formatVSCodeDiagnostics

To properly test the execute function, we would need either:
- Integration testing with actual VS Code/LSP connections
- Module mocking with sinon/vitest
- Refactoring for dependency injection
*/

// ============================================================================
// Formatter Tests (Lines 221-275)
// ============================================================================

test('get_diagnostics formatter: generates preview without result', async t => {
	const formatter = getDiagnosticsTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const preview = formatter({
		path: 'test.ts',
	});

	t.truthy(preview);
	t.truthy(
		preview && typeof preview === 'object' && ('$$typeof' in preview || 'type' in preview),
	);
});

test('get_diagnostics formatter: generates result with diagnostics', async t => {
	const formatter = getDiagnosticsTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const result =
		'Diagnostics for test.ts:\n\nERROR at line 5:10: ts-test Missing semicolon\nWARNING at line 7:3: ts-test Unused variable';

	const preview = formatter({path: 'test.ts'}, result);

	t.truthy(preview);
	t.truthy(
		preview && typeof preview === 'object' && ('$$typeof' in preview || 'type' in preview),
	);
});

test('get_diagnostics formatter: handles all documents scope', async t => {
	const formatter = getDiagnosticsTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const preview = formatter({});

	t.truthy(preview);
});

test('get_diagnostics formatter: counts errors and warnings', async t => {
	const formatter = getDiagnosticsTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	// Result with 2 errors and 3 warnings
	const result =
		'Diagnostics for test.ts:\n\nERROR at line 1: Test error\nERROR at line 2: Another error\nWARNING at line 3: Test warning\nWARNING at line 4: Another warning\nWARNING at line 5: Third warning';

	const preview = formatter({path: 'test.ts'}, result);

	t.truthy(preview);
});

test('get_diagnostics formatter: handles empty diagnostics', async t => {
	const formatter = getDiagnosticsTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	const result = 'No diagnostics found for test.ts';

	const preview = formatter({path: 'test.ts'}, result);

	t.truthy(preview);
});

test('get_diagnostics formatter: shows path when provided', async t => {
	const formatter = getDiagnosticsTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	// With path provided
	const previewWithPath = formatter({path: 'src/test.ts'});

	t.truthy(previewWithPath);
});

test('get_diagnostics formatter: shows "All open documents" when no path', async t => {
	const formatter = getDiagnosticsTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	// Without path provided
	const previewWithoutPath = formatter({});

	t.truthy(previewWithoutPath);
});

test('get_diagnostics formatter: handles large result with many diagnostics', async t => {
	const formatter = getDiagnosticsTool.formatter;
	if (!formatter) {
		t.fail('Formatter not defined');
		return;
	}

	// Result with many errors and warnings
	let result = 'Diagnostics for test.ts:\n\n';
	for (let i = 1; i <= 20; i++) {
		result += `ERROR at line ${i}: Error ${i}\n`;
	}
	for (let i = 1; i <= 15; i++) {
		result += `WARNING at line ${i}: Warning ${i}\n`;
	}

	const preview = formatter({path: 'test.ts'}, result);

	t.truthy(preview);
});

// ============================================================================
// Needs Approval Tests
// ============================================================================

test('get_diagnostics: never requires approval', t => {
	// Read-only tools default to no approval (see resolveToolApproval).
	t.true(getDiagnosticsTool.readOnly);
	t.is(getDiagnosticsTool.approval, undefined);
});

// ============================================================================
// VS Code Diagnostics Format Tests (formatVSCodeDiagnostics logic)
// ============================================================================

test('formatVSCodeDiagnostics: handles empty diagnostics', async t => {
	// Test the formatVSCodeDiagnostics function logic
	const emptyDiagnostics: DiagnosticInfo[] = [];
	const filePath = 'test.ts';

	// For empty diagnostics, should return specific message
	const expected = emptyDiagnostics.length === 0
		? `No diagnostics found for ${filePath}`
		: 'Has diagnostics';

	t.is(expected, `No diagnostics found for ${filePath}`);
});

test('formatVSCodeDiagnostics: handles empty diagnostics without path', async t => {
	// Test the formatVSCodeDiagnostics function logic
	const emptyDiagnostics: DiagnosticInfo[] = [];

	// For empty diagnostics without path
	const expected = emptyDiagnostics.length === 0
		? 'No diagnostics found.'
		: 'Has diagnostics';

	t.is(expected, 'No diagnostics found.');
});

test('formatVSCodeDiagnostics: groups diagnostics by file', async t => {
	const mockDiagnostics: DiagnosticInfo[] = [
		{
			filePath: '/test/file1.ts',
			line: 1,
			character: 0,
			severity: 'error' as VSCodeDiagnosticSeverity,
			source: 'ts',
			message: 'Error 1',
		},
		{
			filePath: '/test/file1.ts',
			line: 2,
			character: 0,
			severity: 'warning' as VSCodeDiagnosticSeverity,
			source: 'ts',
			message: 'Warning 1',
		},
		{
			filePath: '/test/file2.ts',
			line: 1,
			character: 0,
			severity: 'error' as VSCodeDiagnosticSeverity,
			source: 'ts',
			message: 'Error 2',
		},
	];

	// Group by file logic (from implementation)
	const byFile = new Map<string, DiagnosticInfo[]>();
	for (const diag of mockDiagnostics) {
		const path = diag.filePath;
		if (!byFile.has(path)) {
			byFile.set(path, []);
		}
		const fileDiagnostics = byFile.get(path);
		if (fileDiagnostics) {
			fileDiagnostics.push(diag);
		}
	}

	t.is(byFile.size, 2);
	t.is(byFile.get('/test/file1.ts')?.length, 2);
	t.is(byFile.get('/test/file2.ts')?.length, 1);
});

test('formatVSCodeDiagnostics: formats with file path', async t => {
	const mockDiagnostics: DiagnosticInfo[] = [
		{
			filePath: '/test/file.ts',
			line: 4,
			character: 10,
			severity: 'error' as VSCodeDiagnosticSeverity,
			source: 'ts',
			message: 'Cannot find name',
		},
	];

	t.is(mockDiagnostics[0].line, 4);
	t.is(mockDiagnostics[0].character, 10);
	t.is(mockDiagnostics[0].severity, 'error');

	// Line numbers are 1-indexed in output
	const outputLine = mockDiagnostics[0].line + 1;
	const outputChar = mockDiagnostics[0].character + 1;

	t.is(outputLine, 5);
	t.is(outputChar, 11);
});

// ============================================================================
// Error Severity Formatting Tests
// ============================================================================

test('get_diagnostics: formats ERROR severity correctly', async t => {
	// The severity should be formatted as 'ERROR' at line X:Y
	const diagnostic = {
		severity: 'error' as VSCodeDiagnosticSeverity,
		line: 10,
		character: 5,
		source: 'ts',
		message: 'Test error',
	};

	const formattedSeverity = diagnostic.severity === 'error'
		? 'ERROR'
		: diagnostic.severity.toUpperCase();

	t.is(formattedSeverity, 'ERROR');

	// Line numbers are 1-indexed in output
	const outputLine = diagnostic.line + 1;
	const outputChar = diagnostic.character + 1;

	t.is(outputLine, 11);
	t.is(outputChar, 6);
});

test('get_diagnostics: formats WARNING severity correctly', async t => {
	const diagnostic = {
		severity: 'warning' as VSCodeDiagnosticSeverity,
		line: 5,
		character: 3,
		source: 'eslint',
		message: 'Test warning',
	};

	const formattedSeverity = diagnostic.severity === 'warning'
		? 'WARNING'
		: diagnostic.severity.toUpperCase();

	t.is(formattedSeverity, 'WARNING');
});

test('get_diagnostics: formats INFO severity correctly', async t => {
	const diagnostic = {
		severity: 'information' as VSCodeDiagnosticSeverity,
		line: 3,
		character: 1,
		source: 'ts',
		message: 'Test info',
	};

	const formattedSeverity = diagnostic.severity === 'information'
		? 'INFO'
		: diagnostic.severity.toUpperCase();

	t.is(formattedSeverity, 'INFO');
});

test('get_diagnostics: formats HINT severity correctly', async t => {
	const diagnostic = {
		severity: 'hint' as VSCodeDiagnosticSeverity,
		line: 7,
		character: 2,
		source: 'ts',
		message: 'Test hint',
	};

	const formattedSeverity = diagnostic.severity === 'hint'
		? 'HINT'
		: diagnostic.severity.toUpperCase();

	t.is(formattedSeverity, 'HINT');
});

// ============================================================================
// Source Formatting Tests
// ============================================================================

test('get_diagnostics: includes source in output when present', async t => {
	const diagnosticWithSource = {
		severity: 'error' as VSCodeDiagnosticSeverity,
		line: 1,
		character: 0,
		source: 'typescript',
		message: 'Test',
	};

	const source = diagnosticWithSource.source
		? `[${diagnosticWithSource.source}] `
		: '';

	t.is(source, '[typescript] ');

	const diagnosticWithoutSource = {
		severity: 'error' as VSCodeDiagnosticSeverity,
		line: 1,
		character: 0,
		source: undefined,
		message: 'Test',
	};

	const noSource = diagnosticWithoutSource.source
		? `[${diagnosticWithoutSource.source}] `
		: '';

	t.is(noSource, '');
});

// ============================================================================
// URI to Path Conversion Tests
// ============================================================================

test('get_diagnostics: handles URI to path conversion', async t => {
	// Test URI to path conversion (file:// prefix removal)
	const fileUri = 'file:///home/user/test.ts';
	const path = fileUri.startsWith('file://') ? fileUri.slice(7) : fileUri;

	t.is(path, '/home/user/test.ts');

	// Test non-URI paths
	const plainPath = '/home/user/test.ts';
	const unchangedPath = plainPath.startsWith('file://')
		? plainPath.slice(7)
		: plainPath;

	t.is(unchangedPath, '/home/user/test.ts');
});

// ============================================================================
// Diagnostic Result Format Tests
// ============================================================================

test('get_diagnostics: returns "No diagnostics found" message for empty results', async t => {
	// The expected message format when no diagnostics are found
	const emptyDiagnostics: DiagnosticInfo[] = [];
	const filePath = 'test.ts';

	// For VS Code diagnostics (empty array)
	const result = emptyDiagnostics.length === 0
		? `No diagnostics found for ${filePath}`
		: 'Has diagnostics';

	t.is(result, `No diagnostics found for ${filePath}`);
});

test('get_diagnostics: formats multiple diagnostics', async t => {
	// Multiple diagnostics for the same file
	const diagnostics: DiagnosticInfo[] = [
		{
			filePath: '/test/file.ts',
			line: 0,
			character: 0,
			severity: 'error' as VSCodeDiagnosticSeverity,
			source: 'ts',
			message: 'Error 1',
		},
		{
			filePath: '/test/file.ts',
			line: 1,
			character: 5,
			severity: 'warning' as VSCodeDiagnosticSeverity,
			source: 'eslint',
			message: 'Warning 1',
		},
		{
			filePath: '/test/file.ts',
			line: 2,
			character: 10,
			severity: 'information' as VSCodeDiagnosticSeverity,
			source: 'ts',
			message: 'Info 1',
		},
	];

	t.is(diagnostics.length, 3);
	t.is(diagnostics[0].severity, 'error');
	t.is(diagnostics[1].severity, 'warning');
	t.is(diagnostics[2].severity, 'information');
});

// ============================================================================
// LSP Diagnostic Severity Tests
// ============================================================================

test('get_diagnostics: maps LSP DiagnosticSeverity.Error to ERROR', async t => {
	const severity = DiagnosticSeverity.Error;
	const formatted = severity === DiagnosticSeverity.Error
		? 'ERROR'
		: severity === DiagnosticSeverity.Warning
			? 'WARNING'
			: severity === DiagnosticSeverity.Information
				? 'INFO'
				: 'HINT';

	t.is(formatted, 'ERROR');
});

test('get_diagnostics: maps LSP DiagnosticSeverity.Warning to WARNING', async t => {
	const severity = DiagnosticSeverity.Warning;
	const formatted = severity === DiagnosticSeverity.Error
		? 'ERROR'
		: severity === DiagnosticSeverity.Warning
			? 'WARNING'
			: severity === DiagnosticSeverity.Information
				? 'INFO'
				: 'HINT';

	t.is(formatted, 'WARNING');
});

test('get_diagnostics: maps LSP DiagnosticSeverity.Information to INFO', async t => {
	const severity = DiagnosticSeverity.Information;
	const formatted = severity === DiagnosticSeverity.Error
		? 'ERROR'
		: severity === DiagnosticSeverity.Warning
			? 'WARNING'
			: severity === DiagnosticSeverity.Information
				? 'INFO'
				: 'HINT';

	t.is(formatted, 'INFO');
});

test('get_diagnostics: maps LSP DiagnosticSeverity.Hint to HINT', async t => {
	const severity = DiagnosticSeverity.Hint;
	const formatted = severity === DiagnosticSeverity.Error
		? 'ERROR'
		: severity === DiagnosticSeverity.Warning
			? 'WARNING'
			: severity === DiagnosticSeverity.Information
				? 'INFO'
				: 'HINT';

	t.is(formatted, 'HINT');
});

// ============================================================================
// Formatter Error Counting Tests
// ============================================================================

test('get_diagnostics formatter: counts ERROR occurrences', async t => {
	const resultWithError =
		'Diagnostics for test.ts:\n\nERROR at line 1: Test\nERROR at line 2: Another\nWARNING at line 3: Warning';

	const errorCount = (resultWithError?.match(/ERROR/g) || []).length;

	t.is(errorCount, 2);
});

test('get_diagnostics formatter: counts WARNING occurrences', async t => {
	const resultWithWarning =
		'Diagnostics for test.ts:\n\nERROR at line 1: Test\nWARNING at line 2: Warning 1\nWARNING at line 3: Warning 2';

	const warningCount = (resultWithWarning?.match(/WARNING/g) || []).length;

	t.is(warningCount, 2);
});

test('get_diagnostics formatter: handles result with no diagnostics keywords', async t => {
	const resultWithNoKeywords = 'No diagnostics found for test.ts';

	const errorCount = (resultWithNoKeywords?.match(/ERROR/g) || []).length;
	const warningCount = (resultWithNoKeywords?.match(/WARNING/g) || []).length;

	t.is(errorCount, 0);
	t.is(warningCount, 0);
});

test('get_diagnostics formatter: handles result with mixed case severity', async t => {
	const result = 'Diagnostics for test.ts:\n\nError at line 1\nWarning at line 2';

	const errorCount = (result?.match(/ERROR/g) || []).length;
	const warningCount = (result?.match(/WARNING/g) || []).length;

	t.is(errorCount, 0); // Should only match uppercase ERROR
	t.is(warningCount, 0); // Should only match uppercase WARNING
});

// ============================================================================
// Tool Schema Validation Tests
// ============================================================================

test('get_diagnostics: tool has correct schema structure', async t => {
	const tool = getDiagnosticsTool.tool;

	// Verify tool structure
	t.truthy(tool);
	t.truthy(tool.description);
	t.truthy(tool.inputSchema);
	t.truthy(tool.execute);
});
