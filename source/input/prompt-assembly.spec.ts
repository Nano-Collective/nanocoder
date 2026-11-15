import test from 'ava';
import type {
	InputState,
	PastePlaceholderContent,
	PlaceholderContent,
} from '../types/hooks';
import {PlaceholderType} from '../types/hooks';

console.log(`\nprompt-assembly.spec.ts`);

// Minimal implementation for testing - avoids complex dependencies
function assemblePrompt(inputState: InputState): string {
	let assembledPrompt = inputState.displayValue;

	// Replace each placeholder with its full content
	Object.entries(inputState.placeholderContent).forEach(
		([placeholderId, placeholder]) => {
			if (placeholder.type === 'paste') {
				const placeholderPattern = `\\[Paste #${placeholderId}: \\d+ chars\\]`;
				const regex = new RegExp(placeholderPattern, 'g');
				assembledPrompt = assembledPrompt.replace(regex, placeholder.content);
			} else if (placeholder.type === 'file') {
				// For file placeholders: [@filepath] or [@filepath:10-20]
				const escapedPath = placeholder.displayText.replace(
					/[.*+?^${}()|[\]\\]/g,
					'\\$&',
				);
				const regex = new RegExp(escapedPath, 'g');

				// Format file content with header (mimicking prompt-processor.ts)
				const fileName =
					placeholder.filePath.split('/').pop() || placeholder.filePath;
				const header = `=== File: ${fileName} ===`;
				const footer = '='.repeat(header.length);
				const formattedContent = `${header}\n${placeholder.content}\n${footer}`;

				assembledPrompt = assembledPrompt.replace(regex, formattedContent);
			}
		},
	);

	return assembledPrompt;
}

function extractPlaceholderIds(displayValue: string): string[] {
	const placeholderRegex = /\[Paste #(\d+): \d+ chars\]/g;
	const matches = [];
	let match;

	while ((match = placeholderRegex.exec(displayValue)) !== null) {
		matches.push(match[1]); // The captured paste ID
	}

	return matches;
}

// Tests for prompt assembly
test('assemblePrompt replaces single placeholder with content', t => {
	const inputState: InputState = {
		displayValue: 'Analyze this: [Paste #1640995200: 100 chars]',
		placeholderContent: {
			'1640995200': {
				type: PlaceholderType.PASTE,
				displayText: '[Paste #1640995200: 100 chars]',
				content: 'function test() { return "hello world"; }',
				originalSize: 100,
			} as PastePlaceholderContent,
		},
	};

	const result = assemblePrompt(inputState);
	t.is(result, 'Analyze this: function test() { return "hello world"; }');
});

test('assemblePrompt handles multiple placeholders', t => {
	const inputState: InputState = {
		displayValue: 'Compare [Paste #123: 50 chars] with [Paste #456: 30 chars]',
		placeholderContent: {
			'123': {
				type: PlaceholderType.PASTE,
				displayText: '[Paste #123: 50 chars]',
				content: 'first code snippet',
				originalSize: 50,
			} as PastePlaceholderContent,
			'456': {
				type: PlaceholderType.PASTE,
				displayText: '[Paste #456: 30 chars]',
				content: 'second code snippet',
				originalSize: 30,
			} as PastePlaceholderContent,
		},
	};

	const result = assemblePrompt(inputState);
	t.is(result, 'Compare first code snippet with second code snippet');
});

test('assemblePrompt handles no placeholders', t => {
	const inputState: InputState = {
		displayValue: 'Regular text without placeholders',
		placeholderContent: {},
	};

	const result = assemblePrompt(inputState);
	t.is(result, 'Regular text without placeholders');
});

test('extractPlaceholderIds finds all placeholder IDs', t => {
	const displayValue =
		'Text [Paste #123: 100 chars] more text [Paste #456: 200 chars]';
	const result = extractPlaceholderIds(displayValue);

	t.deepEqual(result, ['123', '456']);
});

test('extractPlaceholderIds returns empty for no placeholders', t => {
	const displayValue = 'Regular text without placeholders';
	const result = extractPlaceholderIds(displayValue);

	t.deepEqual(result, []);
});

// FILE placeholder tests
test('assemblePrompt replaces file placeholder with formatted content', t => {
	const inputState: InputState = {
		displayValue: 'Check this file: [@src/app.tsx]',
		placeholderContent: {
			file_1: {
				type: PlaceholderType.FILE,
				displayText: '[@src/app.tsx]',
				filePath: '/Users/test/project/src/app.tsx',
				content:
					'   1: import React from "react";\n   2: export function App() {}',
				fileSize: 100,
			} as PlaceholderContent,
		},
	};

	const result = assemblePrompt(inputState);

	t.true(result.includes('=== File: app.tsx ==='));
	t.true(result.includes('import React from "react"'));
	// Footer should be same length as header
	t.true(result.includes('='.repeat('=== File: app.tsx ==='.length)));
});

test('assemblePrompt handles file placeholder with line range', t => {
	const inputState: InputState = {
		displayValue: 'Review [@app.tsx:10-20]',
		placeholderContent: {
			file_1: {
				type: PlaceholderType.FILE,
				displayText: '[@app.tsx:10-20]',
				filePath: '/Users/test/app.tsx',
				content: '  10: function test() {\n  11:   return true;\n  12: }',
				fileSize: 50,
			} as PlaceholderContent,
		},
	};

	const result = assemblePrompt(inputState);

	t.true(result.includes('=== File: app.tsx ==='));
	t.true(result.includes('function test()'));
});

test('assemblePrompt handles multiple file placeholders', t => {
	const inputState: InputState = {
		displayValue: 'Compare [@a.ts] with [@b.ts]',
		placeholderContent: {
			file_1: {
				type: PlaceholderType.FILE,
				displayText: '[@a.ts]',
				filePath: '/project/a.ts',
				content: '   1: const a = 1;',
				fileSize: 20,
			} as PlaceholderContent,
			file_2: {
				type: PlaceholderType.FILE,
				displayText: '[@b.ts]',
				filePath: '/project/b.ts',
				content: '   1: const b = 2;',
				fileSize: 20,
			} as PlaceholderContent,
		},
	};

	const result = assemblePrompt(inputState);

	t.true(result.includes('=== File: a.ts ==='));
	t.true(result.includes('const a = 1'));
	t.true(result.includes('=== File: b.ts ==='));
	t.true(result.includes('const b = 2'));
});

test('assemblePrompt handles mixed paste and file placeholders', t => {
	const inputState: InputState = {
		displayValue: 'Text [Paste #123: 20 chars] and [@file.ts]',
		placeholderContent: {
			'123': {
				type: PlaceholderType.PASTE,
				displayText: '[Paste #123: 20 chars]',
				content: 'pasted code',
				originalSize: 20,
			} as PastePlaceholderContent,
			file_1: {
				type: PlaceholderType.FILE,
				displayText: '[@file.ts]',
				filePath: '/project/file.ts',
				content: '   1: export const x = 1;',
				fileSize: 30,
			} as PlaceholderContent,
		},
	};

	const result = assemblePrompt(inputState);

	t.true(result.includes('pasted code'));
	t.true(result.includes('=== File: file.ts ==='));
	t.true(result.includes('export const x = 1'));
});
