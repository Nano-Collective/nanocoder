import test from 'ava';
import {assemblePrompt} from './prompt-processor.js';
import type {InputState} from '../types/hooks';
import {PlaceholderType} from '../types/hooks';

console.log('\nprompt-processor.spec.ts');

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
