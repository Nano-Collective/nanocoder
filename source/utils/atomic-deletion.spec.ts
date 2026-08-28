import test from 'ava';
import type {InputState, PastePlaceholderContent} from '../types/hooks';
import {PlaceholderType} from '../types/hooks';
import {
	findPlaceholderAtPosition,
	handleAtomicDeletion,
	wouldPartiallyDeletePlaceholder,
} from './atomic-deletion';

console.log(`\natomic-deletion.spec.ts`);

// Tests for atomic placeholder deletion
test('handleAtomicDeletion removes placeholder when backspaced', t => {
	const previousState: InputState = {
		displayValue: 'Analyze this: [Paste #123: 500 chars] code',
		placeholderContent: {
			'123': {
				type: PlaceholderType.PASTE,
				displayText: '[Paste #123: 500 chars]',
				content: 'console.log("hello world");',
				originalSize: 500,
			} as PastePlaceholderContent,
		},
	};

	// Simulate backspacing from the end of the placeholder
	const newText = 'Analyze this: [Paste #123: 500 char code';

	const result = handleAtomicDeletion(previousState, newText);

	t.truthy(result);
	t.is(result!.displayValue, 'Analyze this:  code');
	t.deepEqual(result!.placeholderContent, {});
});

test('handleAtomicDeletion removes placeholder when deleted from middle', t => {
	const previousState: InputState = {
		displayValue: 'Before [Paste #456: 200 chars] after',
		placeholderContent: {
			'456': {
				type: PlaceholderType.PASTE,
				displayText: '[Paste #456: 200 chars]',
				content: 'function test() { return true; }',
				originalSize: 200,
			} as PastePlaceholderContent,
		},
	};

	// Simulate deleting part of the placeholder
	const newText = 'Before [Paste #456: 200 ch after';

	const result = handleAtomicDeletion(previousState, newText);

	t.truthy(result);
	t.is(result!.displayValue, 'Before  after');
	t.deepEqual(result!.placeholderContent, {});
});

test('handleAtomicDeletion preserves other placeholders', t => {
	const previousState: InputState = {
		displayValue:
			'First [Paste #111: 100 chars] second [Paste #222: 200 chars]',
		placeholderContent: {
			'111': {
				type: PlaceholderType.PASTE,
				displayText: '[Paste #111: 100 chars]',
				content: 'first content',
				originalSize: 100,
			} as PastePlaceholderContent,
			'222': {
				type: PlaceholderType.PASTE,
				displayText: '[Paste #222: 200 chars]',
				content: 'second content',
				originalSize: 200,
			} as PastePlaceholderContent,
		},
	};

	// Delete part of first placeholder
	const newText = 'First [Paste #111: 100 ch second [Paste #222: 200 chars]';

	const result = handleAtomicDeletion(previousState, newText);

	t.truthy(result);
	t.is(result!.displayValue, 'First  second [Paste #222: 200 chars]');
	t.deepEqual(result!.placeholderContent, {
		'222': {
			type: PlaceholderType.PASTE,
			displayText: '[Paste #222: 200 chars]',
			content: 'second content',
			originalSize: 200,
		} as PastePlaceholderContent,
	});
});

test('handleAtomicDeletion returns null for normal deletions', t => {
	const previousState: InputState = {
		displayValue: 'Normal text here',
		placeholderContent: {},
	};

	const newText = 'Normal text her';

	const result = handleAtomicDeletion(previousState, newText);

	t.is(result, null);
});

test('handleAtomicDeletion ignores deletion immediately before placeholder', t => {
	const previousState: InputState = {
		displayValue: 'x[Paste #123: 100 chars] more',
		placeholderContent: {
			'123': {
				type: PlaceholderType.PASTE,
				displayText: '[Paste #123: 100 chars]',
				content: 'content',
				originalSize: 100,
			} as PastePlaceholderContent,
		},
	};

	const result = handleAtomicDeletion(previousState, '[Paste #123: 100 chars] more');

	t.is(result, null);
});

test('handleAtomicDeletion ignores deletion immediately after placeholder', t => {
	const previousState: InputState = {
		displayValue: '[Paste #123: 100 chars]x more',
		placeholderContent: {
			'123': {
				type: PlaceholderType.PASTE,
				displayText: '[Paste #123: 100 chars]',
				content: 'content',
				originalSize: 100,
			} as PastePlaceholderContent,
		},
	};

	const result = handleAtomicDeletion(previousState, '[Paste #123: 100 chars] more');

	t.is(result, null);
});

test('handleAtomicDeletion returns null for additions', t => {
	const previousState: InputState = {
		displayValue: 'Short text',
		placeholderContent: {},
	};

	const newText = 'Short text with more';

	const result = handleAtomicDeletion(previousState, newText);

	t.is(result, null);
});

test('findPlaceholderAtPosition finds placeholder ID', t => {
	const text = 'Before [Paste #789: 300 chars] after';
	const content = {
		paste_789: {
			type: PlaceholderType.PASTE,
			displayText: '[Paste #789: 300 chars]',
			content: 'code',
			originalSize: 300,
		} as PastePlaceholderContent,
	};

	// Position inside the placeholder
	const result1 = findPlaceholderAtPosition(text, 10, content); // Inside "[Paste #789: 300 chars]"
	t.is(result1, 'paste_789');

	// Position outside the placeholder
	const result2 = findPlaceholderAtPosition(text, 0, content); // In "Before"
	t.is(result2, null);

	// Position after placeholder
	const result3 = findPlaceholderAtPosition(text, 35, content); // In "after"
	t.is(result3, null);
});

test('findPlaceholderAtPosition uses cursor boundaries', t => {
	const text = 'Before [Paste #789: 300 chars] after';
	const content = {
		paste_789: {
			type: PlaceholderType.PASTE,
			displayText: '[Paste #789: 300 chars]',
			content: 'code',
			originalSize: 300,
		} as PastePlaceholderContent,
	};
	const placeholderStart = text.indexOf('[Paste #789: 300 chars]');
	const placeholderEnd = placeholderStart + '[Paste #789: 300 chars]'.length;

	t.is(findPlaceholderAtPosition(text, placeholderStart, content), null);
	t.is(findPlaceholderAtPosition(text, placeholderStart + 1, content), 'paste_789');
	t.is(findPlaceholderAtPosition(text, placeholderEnd, content), 'paste_789');
});

test('wouldPartiallyDeletePlaceholder detects partial deletion', t => {
	const text = 'Text [Paste #123: 100 chars] more';
	const content = {
		paste_123: {
			type: PlaceholderType.PASTE,
			displayText: '[Paste #123: 100 chars]',
			content: 'code',
			originalSize: 100,
		} as PastePlaceholderContent,
	};
	//       01234567890123456789012345678901234
	//       0         1         2         3
	// Placeholder is at position 5-28 (length 23)

	// Partial deletion from middle of placeholder
	const result1 = wouldPartiallyDeletePlaceholder(text, 8, 5, content); // Delete "Paste"
	t.true(result1);

	// Complete deletion of placeholder - delete from position 5, length 23
	const result2 = wouldPartiallyDeletePlaceholder(text, 5, 23, content); // Delete entire "[Paste #123: 100 chars]"
	t.false(result2);

	// Deletion outside placeholder
	const result3 = wouldPartiallyDeletePlaceholder(text, 0, 4, content); // Delete "Text"
	t.false(result3);
});

test('wouldPartiallyDeletePlaceholder treats touching boundaries as non-overlap', t => {
	const text = 'Text [Paste #123: 100 chars] more';
	const content = {
		paste_123: {
			type: PlaceholderType.PASTE,
			displayText: '[Paste #123: 100 chars]',
			content: 'code',
			originalSize: 100,
		} as PastePlaceholderContent,
	};
	const placeholderStart = text.indexOf('[Paste #123: 100 chars]');
	const placeholderEnd = placeholderStart + '[Paste #123: 100 chars]'.length;

	t.false(
		wouldPartiallyDeletePlaceholder(text, placeholderStart - 1, 1, content),
	);
	t.false(wouldPartiallyDeletePlaceholder(text, placeholderEnd, 1, content));
	t.true(wouldPartiallyDeletePlaceholder(text, placeholderEnd - 1, 1, content));
});

// Integration test showing complete flow
test('atomic deletion works with multiple placeholders', t => {
	const previousState: InputState = {
		displayValue:
			'Compare [Paste #111: 50 chars] with [Paste #222: 100 chars] output',
		placeholderContent: {
			'111': {
				type: PlaceholderType.PASTE,
				displayText: '[Paste #111: 50 chars]',
				content: 'first code block',
				originalSize: 50,
			} as PastePlaceholderContent,
			'222': {
				type: PlaceholderType.PASTE,
				displayText: '[Paste #222: 100 chars]',
				content: 'second code block with more content',
				originalSize: 100,
			} as PastePlaceholderContent,
		},
	};

	// Delete part of second placeholder
	const newText =
		'Compare [Paste #111: 50 chars] with [Paste #222: 100 ch output';

	const result = handleAtomicDeletion(previousState, newText);

	t.truthy(result);
	t.is(result!.displayValue, 'Compare [Paste #111: 50 chars] with  output');
	t.deepEqual(result!.placeholderContent, {
		'111': {
			type: PlaceholderType.PASTE,
			displayText: '[Paste #111: 50 chars]',
			content: 'first code block',
			originalSize: 50,
		} as PastePlaceholderContent,
	});
});

test('handleAtomicDeletion removes a file mention placeholder', t => {
	const previousState: InputState = {
		displayValue: 'Review [@src/app.tsx] please',
		placeholderContent: {
			file_1: {
				type: PlaceholderType.FILE,
				displayText: '[@src/app.tsx]',
				filePath: '/repo/src/app.tsx',
				content: 'export const App = () => null;',
			},
		},
	};

	// Backspace into the trailing bracket of the mention
	const result = handleAtomicDeletion(
		previousState,
		'Review [@src/app.tsx please',
	);

	t.truthy(result);
	t.is(result!.displayValue, 'Review  please');
	t.deepEqual(
		result!.placeholderContent,
		{},
		'the mention leaves no orphan entry behind',
	);
});

test('handleAtomicDeletion removes the second of two identical placeholders', t => {
	const previousState: InputState = {
		displayValue: '[@a.ts] and [@a.ts]',
		placeholderContent: {
			file_1: {
				type: PlaceholderType.FILE,
				displayText: '[@a.ts]',
				filePath: '/repo/a.ts',
				content: 'first',
			},
			file_2: {
				type: PlaceholderType.FILE,
				displayText: '[@a.ts]',
				filePath: '/repo/a.ts',
				content: 'second',
			},
		},
	};

	const result = handleAtomicDeletion(previousState, '[@a.ts] and [@a.ts');

	t.truthy(result);
	t.is(result!.displayValue, '[@a.ts] and ');
	t.deepEqual(Object.keys(result!.placeholderContent), ['file_1']);
});
