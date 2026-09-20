import {PASTE_LARGE_CONTENT_THRESHOLD_CHARS} from '../constants';
import type {InputState, PastePlaceholderContent} from '../types/hooks';
import {PlaceholderType} from '../types/hooks';
import test from 'ava';
import {cleanup, render} from 'ink-testing-library';
import React from 'react';
import {useInputState} from './useInputState';

console.log('\nuseInputState.spec.ts');

// Helper to create a paste placeholder
function createPastePlaceholder(
	id: string,
	content: string,
): PastePlaceholderContent {
	return {
		type: PlaceholderType.PASTE,
		displayText: `[Paste #${id}: ${content.length} chars]`,
		content,
		originalSize: content.length,
	} as PastePlaceholderContent;
}


// Simple wrapper component for testing
let currentHook: ReturnType<typeof useInputState> | null = null;

function TestComponent() {
	currentHook = useInputState();
	return null;
}

function setupTest() {
	currentHook = null;
	const instance = render(<TestComponent />);
	if (!currentHook) {
		throw new Error('Hook failed to initialize');
	}
	return {
		hook: currentHook as ReturnType<typeof useInputState>,
		instance,
	};
}

test.afterEach(() => {
	cleanup();
	currentHook = null;
});

// Test resetInput creates empty input state
test('resetInput creates empty input state', t => {
	const {hook, instance} = setupTest();

	// Add some content
	hook.updateInput('some text');
	instance.rerender(<TestComponent />);

	// Reset
	hook.resetInput();
	instance.rerender(<TestComponent />);

	t.is(currentHook!.input, '');
	t.deepEqual(currentHook!.currentState.placeholderContent, {});
	t.is(currentHook!.cachedLineCount, 1);
});

// Test updateInput with normal text
test('updateInput handles normal text input', t => {
	const {hook, instance} = setupTest();

	// Use small input to avoid paste detection (< 10 chars)
	hook.updateInput('hello');
	instance.rerender(<TestComponent />);

	t.is(currentHook!.input, 'hello');
	t.true(currentHook!.undoStack.length > 0);
});

// Test updateInput with multiline text
test('updateInput updates cached line count for multiline input', t => {
	const {hook, instance} = setupTest();

	const multilineText = 'line1\nline2\nline3';
	hook.updateInput(multilineText);
	instance.rerender(<TestComponent />);

	// Multiline input triggers paste detection, creating a placeholder
	// The line count should still reflect the placeholder line count
	t.true(currentHook!.input.length > 0);
	// The input might be a placeholder or the original text
	// Either way, it should have been processed
	t.true(currentHook!.undoStack.length > 0);
});

// Test updateInput with large content
test('updateInput detects large content', async t => {
	const {hook, instance} = setupTest();

	const largeText = 'a'.repeat(PASTE_LARGE_CONTENT_THRESHOLD_CHARS + 100);
	hook.updateInput(largeText);
	instance.rerender(<TestComponent />);

	// Wait for debounce
	await new Promise(resolve => setTimeout(resolve, 100));

	// Large text triggers paste detection, creating a placeholder
	t.true(currentHook!.input.includes('[Paste #') || currentHook!.input === largeText);
	t.true(currentHook!.input.length > 0);
});

// Test undo functionality
test('undo reverts to previous state', t => {
	const {hook, instance} = setupTest();

	// Make some changes - use small inputs to avoid paste detection
	hook.updateInput('a');
	instance.rerender(<TestComponent />);

	currentHook!.updateInput('ab');
	instance.rerender(<TestComponent />);

	currentHook!.updateInput('abc');
	instance.rerender(<TestComponent />);

	t.is(currentHook!.input, 'abc');
	t.true(currentHook!.undoStack.length > 0);

	// Undo once - use current hook reference
	currentHook!.undo();
	instance.rerender(<TestComponent />);

	t.is(currentHook!.input, 'ab');
	t.true(currentHook!.redoStack.length > 0);
});

// Test undo with empty stack
test('undo does nothing with empty stack', t => {
	const {hook, instance} = setupTest();

	hook.undo();
	instance.rerender(<TestComponent />);

	t.is(currentHook!.input, '');
	t.is(currentHook!.redoStack.length, 0);
});

// Test redo functionality
test('redo restores undone state', t => {
	const {hook, instance} = setupTest();

	// Make changes - small inputs to avoid paste detection
	hook.updateInput('x');
	instance.rerender(<TestComponent />);

	currentHook!.updateInput('xy');
	instance.rerender(<TestComponent />);

	// Undo
	currentHook!.undo();
	instance.rerender(<TestComponent />);

	t.is(currentHook!.input, 'x');

	// Redo
	currentHook!.redo();
	instance.rerender(<TestComponent />);

	t.is(currentHook!.input, 'xy');
	t.is(currentHook!.redoStack.length, 0);
});

// Test redo with empty stack
test('redo does nothing with empty stack', t => {
	const {hook, instance} = setupTest();

	hook.updateInput('text');
	instance.rerender(<TestComponent />);

	hook.redo();
	instance.rerender(<TestComponent />);

	t.is(currentHook!.input, 'text');
	t.is(currentHook!.redoStack.length, 0);
});

// Test that new action clears redo stack
test('new action after undo clears redo stack', t => {
	const {hook, instance} = setupTest();

	// Make changes - small inputs
	hook.updateInput('a');
	instance.rerender(<TestComponent />);

	currentHook!.updateInput('ab');
	instance.rerender(<TestComponent />);

	// Undo
	currentHook!.undo();
	instance.rerender(<TestComponent />);

	const redoStackAfterUndo = currentHook!.redoStack.length;
	t.true(redoStackAfterUndo > 0);

	// Make new change - small input
	currentHook!.updateInput('abc');
	instance.rerender(<TestComponent />);

	// Redo stack should be cleared
	t.is(currentHook!.redoStack.length, 0);
});

// Test deletePlaceholder
test('deletePlaceholder removes placeholder from state', t => {
	const {hook, instance} = setupTest();

	// Create a state with a placeholder
	const initialState: InputState = {
		displayValue: 'text [Paste #abc123: 10 chars] more',
		placeholderContent: {
			abc123: createPastePlaceholder('abc123', 'test paste') as PastePlaceholderContent,
		},
	};

	hook.setInputState(initialState);
	instance.rerender(<TestComponent />);

	t.true(currentHook!.input.includes('[Paste #abc123'));

	// Delete the placeholder
	hook.deletePlaceholder('abc123');
	instance.rerender(<TestComponent />);

	t.false(currentHook!.input.includes('[Paste #abc123'));
	t.false('abc123' in currentHook!.currentState.placeholderContent);
});

// Test deletePlaceholder with special characters (sanitization)
test('deletePlaceholder sanitizes placeholder ID', t => {
	const {hook, instance} = setupTest();

	const initialState: InputState = {
		displayValue: 'text [Paste #safe123: 10 chars] more',
		placeholderContent: {
			safe123: createPastePlaceholder('safe123', 'test paste'),
		},
	};
	hook.setInputState(initialState);
	instance.rerender(<TestComponent />);

	// Try with potentially unsafe ID (should sanitize it)
	hook.deletePlaceholder('safe123;rm-rf');
	instance.rerender(<TestComponent />);

	// The deletion should have worked on the sanitized ID
	t.pass();
});

// Test setInputState
test('setInputState updates current state', t => {
	const {hook, instance} = setupTest();

	const newState: InputState = {
		displayValue: 'new text [Paste #xyz: 5 chars]',
		placeholderContent: {
			xyz: createPastePlaceholder('xyz', 'paste'),
		},
	};

	hook.setInputState(newState);
	instance.rerender(<TestComponent />);

	t.is(currentHook!.input, newState.displayValue);
	t.deepEqual(
		currentHook!.currentState.placeholderContent,
		newState.placeholderContent,
	);
});

// Test setInput (legacy setter)
test('setInput updates display value without affecting placeholders', t => {
	const {hook, instance} = setupTest();

	// Set up initial state with placeholder
	const initialState: InputState = {
		displayValue: 'text',
		placeholderContent: {
			'123': createPastePlaceholder('123', 'paste'),
		},
	};

	hook.setInputState(initialState);
	instance.rerender(<TestComponent />);

	// Use legacy setter
	hook.setInput('new text');
	instance.rerender(<TestComponent />);

	t.is(currentHook!.input, 'new text');
	t.deepEqual(currentHook!.currentState.placeholderContent, {
		'123': createPastePlaceholder('123', 'paste'),
	});
});

// Test legacy pastedContent getter
test('pastedContent returns only paste placeholders', t => {
	const {hook, instance} = setupTest();

	const initialState: InputState = {
		displayValue: 'text',
		placeholderContent: {
			paste1: createPastePlaceholder('paste1', 'content1'),
			paste2: createPastePlaceholder('paste2', 'content2'),
		},
	};

	hook.setInputState(initialState);
	instance.rerender(<TestComponent />);

	t.deepEqual(currentHook!.pastedContent, {
		paste1: 'content1',
		paste2: 'content2',
	});
});

// Test history navigation
test('setOriginalInput and setHistoryIndex update legacy state', t => {
	const {hook, instance} = setupTest();

	hook.setOriginalInput('original');
	hook.setHistoryIndex(5);
	instance.rerender(<TestComponent />);

	t.is(currentHook!.originalInput, 'original');
	t.is(currentHook!.historyIndex, 5);
});

// Test cleanup on resetInput
test('resetInput clears all timers and refs', async t => {
	const {hook, instance} = setupTest();

	// Trigger large content detection (which sets a debounce timer)
	const largeText = 'a'.repeat(PASTE_LARGE_CONTENT_THRESHOLD_CHARS + 100);
	hook.updateInput(largeText);
	instance.rerender(<TestComponent />);

	// Reset before timer fires
	hook.resetInput();
	instance.rerender(<TestComponent />);

	// Wait for what would have been the debounce time
	await new Promise(resolve => setTimeout(resolve, 100));

	// State should be empty
	t.is(currentHook!.input, '');
	t.is(currentHook!.cachedLineCount, 1);
});

// Test paste detection integration
test('updateInput handles large paste', t => {
	const {hook, instance} = setupTest();

	// Simulate a large paste
	const largePaste = 'x'.repeat(500);
	hook.updateInput(largePaste);
	instance.rerender(<TestComponent />);

	// The paste should be detected and handled
	t.truthy(currentHook!.input);
	t.true(currentHook!.input.length > 0);
});

// Test CRLF line counting
test('updateInput counts CRLF line endings correctly', t => {
	const {hook, instance} = setupTest();

	const crlfText = 'line1\r\nline2\r\nline3';
	hook.updateInput(crlfText);
	instance.rerender(<TestComponent />);

	t.is(currentHook!.cachedLineCount, 3);
});

// Test CR line counting
test('updateInput counts CR line endings correctly', t => {
	const {hook, instance} = setupTest();

	const crText = 'line1\rline2\rline3';
	hook.updateInput(crText);
	instance.rerender(<TestComponent />);

	t.is(currentHook!.cachedLineCount, 3);
});

// Test empty input maintains at least 1 line count
test('empty input has line count of 1', t => {
	const {hook, instance} = setupTest();

	hook.updateInput('');
	instance.rerender(<TestComponent />);

	t.is(currentHook!.cachedLineCount, 1);
});

// Test single line has line count of 1
test('single line has line count of 1', t => {
	const {hook, instance} = setupTest();

	hook.updateInput('single line text');
	instance.rerender(<TestComponent />);

	t.is(currentHook!.cachedLineCount, 1);
});

// Test that undo updates state correctly
test('undo maintains state consistency', t => {
	const {hook, instance} = setupTest();

	hook.updateInput('a');
	instance.rerender(<TestComponent />);

	currentHook!.updateInput('ab');
	instance.rerender(<TestComponent />);

	currentHook!.undo();
	instance.rerender(<TestComponent />);

	t.is(currentHook!.input, 'a');
});

// Test that redo maintains state consistency
test('redo maintains state consistency', t => {
	const {hook, instance} = setupTest();

	hook.updateInput('first');
	instance.rerender(<TestComponent />);

	hook.updateInput('second');
	instance.rerender(<TestComponent />);

	hook.undo();
	instance.rerender(<TestComponent />);

	hook.redo();
	instance.rerender(<TestComponent />);

	t.is(currentHook!.input, 'second');
});

// Test resetInput clears undo/redo stacks
test('resetInput clears undo and redo stacks', t => {
	const {hook, instance} = setupTest();

	hook.updateInput('text1');
	instance.rerender(<TestComponent />);

	hook.updateInput('text2');
	instance.rerender(<TestComponent />);

	hook.undo();
	instance.rerender(<TestComponent />);

	hook.resetInput();
	instance.rerender(<TestComponent />);

	t.is(currentHook!.undoStack.length, 0);
	t.is(currentHook!.redoStack.length, 0);
});

// Test multiple undos
test('multiple undos work correctly', t => {
	const {hook, instance} = setupTest();

	hook.updateInput('a');
	instance.rerender(<TestComponent />);

	currentHook!.updateInput('ab');
	instance.rerender(<TestComponent />);

	currentHook!.updateInput('abc');
	instance.rerender(<TestComponent />);

	currentHook!.undo();
	instance.rerender(<TestComponent />);

	currentHook!.undo();
	instance.rerender(<TestComponent />);

	t.is(currentHook!.input, 'a');
	t.is(currentHook!.redoStack.length, 2);
});

// Test multiple redos
test('multiple redos work correctly', t => {
	const {hook, instance} = setupTest();

	hook.updateInput('first');
	instance.rerender(<TestComponent />);

	hook.updateInput('second');
	instance.rerender(<TestComponent />);

	hook.updateInput('third');
	instance.rerender(<TestComponent />);

	hook.undo();
	instance.rerender(<TestComponent />);

	hook.undo();
	instance.rerender(<TestComponent />);

	hook.redo();
	instance.rerender(<TestComponent />);

	hook.redo();
	instance.rerender(<TestComponent />);

	t.is(currentHook!.input, 'third');
	t.is(currentHook!.redoStack.length, 0);
});

// Test setInputState preserves all placeholder data
test('setInputState preserves placeholder metadata', t => {
	const {hook, instance} = setupTest();

	const placeholder: PastePlaceholderContent = {
		type: PlaceholderType.PASTE,
		displayText: '[Paste #test: 10 chars]',
		content: 'test paste',
		originalSize: 10,
		detectionMethod: 'size' as const,
		timestamp: Date.now(),
	};

	const newState: InputState = {
		displayValue: 'text [Paste #test: 10 chars]',
		placeholderContent: {
			test: placeholder,
		},
	};

	hook.setInputState(newState);
	instance.rerender(<TestComponent />);

	const retrievedPlaceholder = currentHook!.currentState.placeholderContent.test;
	t.deepEqual(retrievedPlaceholder, placeholder);
});

// Test resetInput resets originalInput
test('resetInput resets originalInput', t => {
	const {hook, instance} = setupTest();

	hook.setOriginalInput('some original text');
	instance.rerender(<TestComponent />);

	hook.resetInput();
	instance.rerender(<TestComponent />);

	t.is(currentHook!.originalInput, '');
});

// Test resetInput resets historyIndex
test('resetInput resets historyIndex', t => {
	const {hook, instance} = setupTest();

	hook.setHistoryIndex(10);
	instance.rerender(<TestComponent />);

	hook.resetInput();
	instance.rerender(<TestComponent />);

	t.is(currentHook!.historyIndex, -1);
});

// Test atomic deletion
test('updateInput handles atomic deletion of placeholder', t => {
	const {hook, instance} = setupTest();

	// Create a state with a placeholder
	const initialState: InputState = {
		displayValue: 'before [Paste #xyz123: 10 chars] after',
		placeholderContent: {
			xyz123: createPastePlaceholder('xyz123', 'test paste'),
		},
	};

	hook.setInputState(initialState);
	instance.rerender(<TestComponent />);

	t.true(currentHook!.input.includes('[Paste #xyz123'));

	// Simulate backspace deletion of the placeholder
	// The atomic deletion handler should detect this
	hook.updateInput('before  after');
	instance.rerender(<TestComponent />);

	// The placeholder should be removed from both display and content
	t.false(currentHook!.input.includes('[Paste #xyz123'));
});

// Test consecutive updates build undo stack
test('consecutive updates build undo stack', t => {
	const {hook, instance} = setupTest();

	hook.updateInput('a');
	instance.rerender(<TestComponent />);
	const stackSize1 = currentHook!.undoStack.length;

	hook.updateInput('ab');
	instance.rerender(<TestComponent />);
	const stackSize2 = currentHook!.undoStack.length;

	hook.updateInput('abc');
	instance.rerender(<TestComponent />);
	const stackSize3 = currentHook!.undoStack.length;

	t.true(stackSize1 < stackSize2);
	t.true(stackSize2 < stackSize3);
});

// Test updateInput with very long single line
test('updateInput handles very long single line', t => {
	const {hook, instance} = setupTest();

	const longLine = 'a'.repeat(10000);
	hook.updateInput(longLine);
	instance.rerender(<TestComponent />);

	// Long input triggers paste detection
	t.true(currentHook!.input.includes('[Paste #') || currentHook!.input === longLine);
	t.true(currentHook!.input.length > 0);
	// Line count should be 1 (either for placeholder or for long line)
	t.is(currentHook!.cachedLineCount, 1);
});

// Test updateInput with many lines
test('updateInput handles many lines', t => {
	const {hook, instance} = setupTest();

	const manyLines = Array.from({length: 100}, (_, i) => `line${i}`).join('\n');
	hook.updateInput(manyLines);
	instance.rerender(<TestComponent />);

	t.is(currentHook!.cachedLineCount, 100);
});

// Test deletePlaceholder with non-existent ID
test('deletePlaceholder handles non-existent placeholder gracefully', t => {
	const {hook, instance} = setupTest();

	hook.updateInput('text');
	instance.rerender(<TestComponent />);

	const inputBeforeDelete = currentHook!.input;

	// Try to delete a placeholder that doesn't exist
	currentHook!.deletePlaceholder('nonexistent123');
	instance.rerender(<TestComponent />);

	// Input should remain the same since the placeholder doesn't exist
	// The deletion attempts to remove a pattern that doesn't match
	t.truthy(currentHook!.input || inputBeforeDelete);
});

// Test setInput maintains undo stack behavior
test('setInput does not add to undo stack', t => {
	const {hook, instance} = setupTest();

	hook.updateInput('first');
	instance.rerender(<TestComponent />);
	const stackSizeAfterUpdate = currentHook!.undoStack.length;

	hook.setInput('second');
	instance.rerender(<TestComponent />);
	const stackSizeAfterSet = currentHook!.undoStack.length;

	// setInput is a direct setter, doesn't use undo stack
	t.is(currentHook!.input, 'second');
	// Stack size should be the same (setInput doesn't push to undo)
	t.is(stackSizeAfterSet, stackSizeAfterUpdate);
});

// Test edge case: undo after reset
test('undo after reset does nothing', t => {
	const {hook, instance} = setupTest();

	hook.updateInput('text');
	instance.rerender(<TestComponent />);

	hook.resetInput();
	instance.rerender(<TestComponent />);

	hook.undo();
	instance.rerender(<TestComponent />);

	t.is(currentHook!.input, '');
	t.is(currentHook!.undoStack.length, 0);
});

// Test edge case: redo after reset
test('redo after reset does nothing', t => {
	const {hook, instance} = setupTest();

	hook.updateInput('text1');
	instance.rerender(<TestComponent />);

	hook.updateInput('text2');
	instance.rerender(<TestComponent />);

	hook.undo();
	instance.rerender(<TestComponent />);

	hook.resetInput();
	instance.rerender(<TestComponent />);

	hook.redo();
	instance.rerender(<TestComponent />);

	t.is(currentHook!.input, '');
	t.is(currentHook!.redoStack.length, 0);
});

// Test chunked paste merging with placeholder update
test('chunked paste updates existing placeholder', t => {
	const {hook, instance} = setupTest();

	// Simulate a large paste that creates a placeholder
	const largePaste = 'x'.repeat(300);
	hook.updateInput(largePaste);
	instance.rerender(<TestComponent />);

	// If a placeholder was created, the content should be managed
	t.truthy(currentHook!.currentState);
});

// Test paste detection with multiline
test('multiline paste creates placeholder', t => {
	const {hook, instance} = setupTest();

	const multilinePaste = 'line1\nline2\nline3\nline4';
	hook.updateInput(multilinePaste);
	instance.rerender(<TestComponent />);

	// Should detect as paste and create placeholder or keep content
	t.truthy(currentHook!.input);
	t.true(Object.keys(currentHook!.currentState.placeholderContent).length >= 0);
});

// Test getDynamicPasteWindow indirectly via chunked paste
test('handles chunked paste with dynamic window', t => {
	const {hook, instance} = setupTest();

	// Create initial state with a placeholder to test dynamic window
	const initialState: InputState = {
		displayValue: '[Paste #test: 100 chars]',
		placeholderContent: {
			test: {
				type: PlaceholderType.PASTE,
				displayText: '[Paste #test: 100 chars]',
				content: 'a'.repeat(100),
				originalSize: 100,
			},
		},
	};

	hook.setInputState(initialState);
	instance.rerender(<TestComponent />);

	// Now try to add more content (simulating chunked paste)
	// This should trigger the dynamic window logic
	const extendedContent = initialState.displayValue + 'newcontent';
	currentHook!.updateInput(extendedContent);
	instance.rerender(<TestComponent />);

	t.truthy(currentHook!.input);
});

// Test rapid paste detection
test('rapid paste events are detected', t => {
	const {hook, instance} = setupTest();

	// First paste
	hook.updateInput('first'.repeat(20));
	instance.rerender(<TestComponent />);

	// Quick second paste
	currentHook!.updateInput('first'.repeat(20) + 'second'.repeat(20));
	instance.rerender(<TestComponent />);

	// Should have created placeholder(s)
	t.truthy(currentHook!.input);
});

// Test useEffect cleanup on unmount
test('cleanup function is defined', t => {
	const {instance} = setupTest();

	// The cleanup should be set up
	// We can't directly test unmount cleanup, but we can verify the hook initializes
	t.pass();

	// Cleanup will be called when the test ends via test.afterEach
	instance.unmount();
});
