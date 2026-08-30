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

test('assemblePrompt - restores every repeated paste placeholder', t => {
	const inputState: InputState = {
		displayValue: '[Paste #1: 11 chars] and [Paste #1: 11 chars]',
		placeholderContent: {
			1: {
				type: PlaceholderType.PASTE,
				content: 'Hello World',
				displayText: '[Paste #1: 11 chars]',
			},
		},
	};

	const result = assemblePrompt(inputState);

	t.is(result, 'Hello World and Hello World');
});

test('assemblePrompt - preserves dollar tokens in placeholder content', t => {
	const replacementContent = "literal $& $1 $` $' $$";
	const inputState: InputState = {
		displayValue: '[Paste #1: 21 chars]',
		placeholderContent: {
			1: {
				type: PlaceholderType.PASTE,
				content: replacementContent,
				displayText: '[Paste #1: 21 chars]',
			},
		},
	};

	const result = assemblePrompt(inputState);

	t.is(result, replacementContent);
});

test('assemblePrompt - preserves dollar tokens through the legacy fallback', t => {
	const replacementContent = "literal $& $1 $` $' $$";
	const inputState: InputState = {
		displayValue: '[Paste #1: 21 chars]',
		placeholderContent: {
			1: {
				type: PlaceholderType.PASTE,
				content: replacementContent,
				displayText: '',
			},
		},
	};

	const result = assemblePrompt(inputState);

	t.is(result, replacementContent);
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

test('assemblePrompt - expands two placeholders that render identically', t => {
	const inputState: InputState = {
		displayValue: 'compare [@a.ts] against [@a.ts]',
		placeholderContent: {
			file_1: {
				type: PlaceholderType.FILE,
				content: 'first revision',
				filePath: 'a.ts',
				displayText: '[@a.ts]',
			},
			file_2: {
				type: PlaceholderType.FILE,
				content: 'second revision',
				filePath: 'a.ts',
				displayText: '[@a.ts]',
			},
		},
	};

	const result = assemblePrompt(inputState);

	t.true(result.includes('first revision'));
	t.true(result.includes('second revision'));
	t.false(result.includes('[@a.ts]'), 'no placeholder is left unexpanded');
});

test('assemblePrompt - expands a mixed paste and file mention input', t => {
	const inputState: InputState = {
		displayValue: 'see [@a.ts] then [Paste #1: 5 chars]',
		placeholderContent: {
			file_1: {
				type: PlaceholderType.FILE,
				content: 'file body',
				filePath: 'a.ts',
				displayText: '[@a.ts]',
			},
			paste_1: {
				type: PlaceholderType.PASTE,
				content: 'Hello',
				displayText: '[Paste #1: 5 chars]',
			},
		},
	};

	const result = assemblePrompt(inputState);

	t.true(result.includes('file body'));
	t.true(result.endsWith('Hello'));
});

test('assemblePrompt - leaves content that looks like a placeholder alone', t => {
	const inputState: InputState = {
		displayValue: 'echo [Paste #1: 21 chars]',
		placeholderContent: {
			paste_1: {
				type: PlaceholderType.PASTE,
				content: '[Paste #1: 21 chars]',
				displayText: '[Paste #1: 21 chars]',
			},
		},
	};

	t.is(assemblePrompt(inputState), 'echo [Paste #1: 21 chars]');
});

test('assemblePrompt - expands a legacy paste that has no displayText', t => {
	// Prompt history persists InputState as JSON, so an entry written before
	// placeholders carried a displayText can come back from an older session.
	const inputState: InputState = {
		displayValue: 'look [Paste #2: 11 chars] ok',
		placeholderContent: {
			'2': {
				type: PlaceholderType.PASTE,
				content: 'legacy body',
				originalSize: 11,
			} as InputState['placeholderContent'][string],
		},
	};

	t.is(assemblePrompt(inputState), 'look legacy body ok');
});
