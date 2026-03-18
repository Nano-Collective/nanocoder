import test from 'ava';
import {assemblePrompt, processPromptTemplate} from './prompt-processor';
import type {InputState} from '../types/hooks';
import {PlaceholderType} from '../types/hooks';

test('assemblePrompt - replaces placeholder with paste content', t => {
	const inputState: InputState = {
		displayValue: 'Hello [Paste #1: 11 chars]',
		placeholderContent: {
			1: {
				type: PlaceholderType.PASTE,
				content: 'Hello World',
				displayText: '[Paste #1: 11 chars]',
			},
		},
	};

	const result = assemblePrompt(inputState);

	t.is(result, 'Hello Hello World');
});

test('assemblePrompt - replaces placeholder with file content', t => {
	const inputState: InputState = {
		displayValue: 'File: [File #1: example.txt]',
		placeholderContent: {
			1: {
				type: PlaceholderType.FILE,
				content: 'file content',
				filePath: '/path/to/example.txt',
				displayText: '[File #1: example.txt]',
			},
		},
	};

	const result = assemblePrompt(inputState);

	t.true(result.includes('=== File: example.txt ==='));
	t.true(result.includes('file content'));
});

test('assemblePrompt - handles multiple placeholders', t => {
	const inputState: InputState = {
		displayValue: '[Paste #1: 5 chars] and [Paste #2: 12 chars]',
		placeholderContent: {
			1: {
				type: PlaceholderType.PASTE,
				content: 'Hello',
				displayText: '[Paste #1: 5 chars]',
			},
			2: {
				type: PlaceholderType.PASTE,
				content: 'World!',
				displayText: '[Paste #2: 12 chars]',
			},
		},
	};

	const result = assemblePrompt(inputState);

	t.is(result, 'Hello and World!');
});

test('assemblePrompt - handles empty placeholder content', t => {
	const inputState: InputState = {
		displayValue: 'Hello [Paste #1: 5 chars]',
		placeholderContent: {
			1: {
				type: PlaceholderType.PASTE,
				content: '',
				displayText: '[Paste #1: 5 chars]',
			},
		},
	};

	const result = assemblePrompt(inputState);

	t.is(result, 'Hello ');
});

test('assemblePrompt - handles file with nested path', t => {
	const inputState: InputState = {
		displayValue: 'Check [File #1: deep/nested/file.ts]',
		placeholderContent: {
			1: {
				type: PlaceholderType.FILE,
				content: 'export const x = 1',
				filePath: 'src/deep/nested/file.ts',
				displayText: '[File #1: deep/nested/file.ts]',
			},
		},
	};

	const result = assemblePrompt(inputState);

	t.true(result.includes('=== File: file.ts ==='));
	t.true(result.includes('export const x = 1'));
});

test('processPromptTemplate - system info structure has expected fields', t => {
	// This test exercises injectSystemInfo and generateSystemInfo to make sure
	// the expected fields are injected. Since these values are dynamic, we will
	// perform a loose regex match instead.

	const result = processPromptTemplate();

	t.true(result.includes('Operating System:'));
	t.true(result.includes('OS Version:'));
	t.true(result.includes('Platform:'));
	t.true(result.includes('Default Shell:'));
	t.true(result.includes('Current Date:'));

	t.true(/Current Date: \d{4}-\d{2}-\d{2}/.test(result));

	// Also verify that "Current Time:" is NOT present (see #415)
	t.false(result.includes('Current Time:'));
});
