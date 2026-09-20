import test from 'ava';
import {
	FILE_MENTION_INLINE_MAX_LINES,
	FILE_MENTION_PREVIEW_LINES,
} from '../constants.js';
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

test('assemblePrompt - inlines a file at the line threshold in full', t => {
	const content = Array.from(
		{length: FILE_MENTION_INLINE_MAX_LINES},
		(_, i) => `line ${i + 1}`,
	).join('\n');
	const inputState: InputState = {
		displayValue: '[@small.ts]',
		placeholderContent: {
			file_1: {
				type: PlaceholderType.FILE,
				content,
				filePath: 'src/small.ts',
				displayText: '[@small.ts]',
			},
		},
	};

	const result = assemblePrompt(inputState);

	t.true(result.includes('=== File: small.ts ==='));
	t.true(result.includes(content), 'full content is inlined');
	t.false(result.includes('use read_file'), 'no truncation hint for small files');
});

test('assemblePrompt - previews a large file and emits a read_file hint', t => {
	const totalLines = FILE_MENTION_INLINE_MAX_LINES + 100;
	const lines = Array.from({length: totalLines}, (_, i) => `line ${i + 1}`);
	const content = lines.join('\n');
	const inputState: InputState = {
		displayValue: '[@big.ts]',
		placeholderContent: {
			file_1: {
				type: PlaceholderType.FILE,
				content,
				filePath: 'src/big.ts',
				displayText: '[@big.ts]',
			},
		},
	};

	const result = assemblePrompt(inputState);

	// Header advertises the truncation and total line count
	t.true(
		result.includes(
			`=== File: big.ts (${totalLines} lines, showing first ${FILE_MENTION_PREVIEW_LINES}) ===`,
		),
	);
	// Only the preview lines are present; lines past the preview are dropped
	t.true(result.includes(`line ${FILE_MENTION_PREVIEW_LINES}`));
	t.false(
		result.includes(`line ${FILE_MENTION_PREVIEW_LINES + 1}\n`),
		'lines beyond the preview window are not inlined',
	);
	// read_file hint uses the (relative) path the mention referenced
	t.true(
		result.includes(
			`${totalLines - FILE_MENTION_PREVIEW_LINES} more lines, use read_file('src/big.ts')`,
		),
	);
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
