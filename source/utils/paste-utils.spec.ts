import test from 'ava';
import {handlePaste} from './paste-utils';
import type {PlaceholderContent, PastePlaceholderContent} from '@/types/hooks';
import {PlaceholderType} from '@/types/hooks';

// Tests for handlePaste utility function
// Validates paste handling logic and placeholder creation

console.log(`\npaste-utils.spec.ts`);

test('handlePaste returns null for small pastes', t => {
	const pastedText = 'small text';
	const currentDisplayValue = 'existing content';
	const currentPlaceholderContent: Record<string, PlaceholderContent> = {};

	const result = handlePaste(
		pastedText,
		currentDisplayValue,
		currentPlaceholderContent,
	);

	t.is(result, null);
});

test('handlePaste creates placeholder for large pastes', t => {
	const pastedText = 'a'.repeat(600); // Above 500 char threshold
	const currentDisplayValue = 'existing content';
	const currentPlaceholderContent: Record<string, PlaceholderContent> = {};

	const result = handlePaste(
		pastedText,
		currentDisplayValue,
		currentPlaceholderContent,
	);

	t.truthy(result);
	t.is(typeof result!.displayValue, 'string');
	t.true(result!.displayValue.includes('[Paste #'));
	t.true(result!.displayValue.includes('600 chars]'));

	// Should contain the pasted content in the map
	const pasteIds = Object.keys(result!.placeholderContent);
	t.is(pasteIds.length, 1);
	const pasteContent = result!.placeholderContent[
		pasteIds[0]
	] as PastePlaceholderContent;
	t.is(pasteContent.content, pastedText);
	t.is(pasteContent.type, PlaceholderType.PASTE);
});

test('handlePaste replaces pasted text with placeholder in display value', t => {
	const pastedText = 'x'.repeat(700);
	const currentDisplayValue = `prefix ${pastedText} suffix`;
	const currentPlaceholderContent: Record<string, PlaceholderContent> = {};

	const result = handlePaste(
		pastedText,
		currentDisplayValue,
		currentPlaceholderContent,
	);

	t.truthy(result);
	t.true(result!.displayValue.startsWith('prefix [Paste #'));
	t.true(result!.displayValue.endsWith('700 chars] suffix'));
	t.false(result!.displayValue.includes('x'.repeat(10))); // Original text should be gone
});

test('handlePaste preserves existing pasted content', t => {
	const existingPlaceholderContent: Record<string, PlaceholderContent> = {
		'123': {
			type: PlaceholderType.PASTE,
			displayText: '[Paste #123: 24 chars]',
			content: 'previous paste content',
			originalSize: 24,
		} as PastePlaceholderContent,
	};
	const pastedText = 'b'.repeat(800);
	const currentDisplayValue = 'some text';

	const result = handlePaste(
		pastedText,
		currentDisplayValue,
		existingPlaceholderContent,
	);

	t.truthy(result);
	t.is(Object.keys(result!.placeholderContent).length, 2);
	const existingContent = result!.placeholderContent[
		'123'
	] as PastePlaceholderContent;
	t.is(existingContent.content, 'previous paste content');

	// Find the new paste ID
	const newPasteId = Object.keys(result!.placeholderContent).find(
		id => id !== '123',
	);
	t.truthy(newPasteId);
	const newContent = result!.placeholderContent[
		newPasteId!
	] as PastePlaceholderContent;
	t.is(newContent.content, pastedText);
});
