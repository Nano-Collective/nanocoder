import type {PastePlaceholderContent, PlaceholderContent} from '@/types/hooks';
import {PlaceholderType} from '@/types/hooks';
import {existsSync, mkdirSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import test from 'ava';
import {handlePaste} from './paste-utils';
import {assemblePrompt} from './prompt-processor';
import {clearAppConfig, reloadAppConfig} from '../config';

// Tests for handlePaste utility function
// Validates paste handling logic and placeholder creation

console.log(`\npaste-utils.spec.ts`);

const testDir = join(tmpdir(), `nanocoder-paste-test-${Date.now()}`);

test.before(() => {
	mkdirSync(testDir, {recursive: true});
});

test.after.always(() => {
	if (existsSync(testDir)) {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.afterEach(() => {
	// Clear config cache after each test to avoid cross-test contamination
	clearAppConfig();
});

test('handlePaste returns null for empty pastes', t => {
	const pastedText = '';
	const currentDisplayValue = 'existing content';
	const currentPlaceholderContent: Record<string, PlaceholderContent> = {};

	const result = handlePaste(
		pastedText,
		currentDisplayValue,
		currentPlaceholderContent,
	);

	t.is(result, null);
});

test('handlePaste returns null for small pastes (no placeholder)', t => {
	const pastedText = 'small text';
	const currentDisplayValue = 'existing content';
	const currentPlaceholderContent: Record<string, PlaceholderContent> = {};

	const result = handlePaste(
		pastedText,
		currentDisplayValue,
		currentPlaceholderContent,
	);

	// With default threshold (800), small pastes should return null (no placeholder)
	t.is(result, null);
});

test('handlePaste creates placeholder for large pastes', t => {
	const pastedText = 'a'.repeat(801);
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
	t.true(result!.displayValue.includes('801 chars]'));

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
	const pastedText = 'x'.repeat(802);
	const currentDisplayValue = `prefix ${pastedText} suffix`;
	const currentPlaceholderContent: Record<string, PlaceholderContent> = {};

	const result = handlePaste(
		pastedText,
		currentDisplayValue,
		currentPlaceholderContent,
	);

	t.truthy(result);
	t.true(result!.displayValue.startsWith('prefix [Paste #'));
	t.true(result!.displayValue.endsWith('802 chars] suffix'));
	t.false(result!.displayValue.includes('x'.repeat(10))); // Original text should be gone
});

test('repeated pasted text survives the complete prompt round trip', t => {
	const pastedText = 'x'.repeat(802);
	const currentDisplayValue = `prefix ${pastedText} middle ${pastedText} suffix`;
	const currentPlaceholderContent: Record<string, PlaceholderContent> = {};

	const result = handlePaste(
		pastedText,
		currentDisplayValue,
		currentPlaceholderContent,
	);

	t.truthy(result);
	const placeholder = result!.placeholderContent.paste_1.displayText;
	t.is(
		result!.displayValue,
		`prefix ${placeholder} middle ${placeholder} suffix`,
	);
	t.false(result!.displayValue.includes(pastedText));
	t.is(assemblePrompt(result!), currentDisplayValue);
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
	const pastedText = 'b'.repeat(801);
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

test('handlePaste respects custom threshold - high threshold prevents placeholder', t => {
	// Create a config with high threshold (1000)
	const configPath = join(testDir, 'nanocoder-preferences.json');
	writeFileSync(
		configPath,
		JSON.stringify({
			nanocoder: {
				paste: {
					singleLineThreshold: 1000,
				},
			},
		}),
		'utf-8',
	);

	// Change to test directory to pick up the config
	const originalCwd = process.cwd();
	try {
		process.chdir(testDir);
		clearAppConfig();
		reloadAppConfig();

		// 100-char paste with 1000 threshold should return null (no placeholder)
		const pastedText = 'x'.repeat(100);
		const currentDisplayValue = 'existing content';
		const currentPlaceholderContent: Record<string, PlaceholderContent> = {};

		const result = handlePaste(
			pastedText,
			currentDisplayValue,
			currentPlaceholderContent,
		);

		t.is(result, null);
	} finally {
		process.chdir(originalCwd);
		clearAppConfig();
	}
});

test('handlePaste respects custom threshold - low threshold creates placeholder', t => {
	// Create a config with low threshold (50)
	const configPath = join(testDir, 'nanocoder-preferences.json');
	writeFileSync(
		configPath,
		JSON.stringify({
			nanocoder: {
				paste: {
					singleLineThreshold: 50,
				},
			},
		}),
		'utf-8',
	);

	// Change to test directory to pick up the config
	const originalCwd = process.cwd();
	try {
		process.chdir(testDir);
		clearAppConfig();
		reloadAppConfig();

		// 100-char paste with 50 threshold SHOULD create placeholder
		const pastedText = 'x'.repeat(100);
		const currentDisplayValue = 'existing content';
		const currentPlaceholderContent: Record<string, PlaceholderContent> = {};

		const result = handlePaste(
			pastedText,
			currentDisplayValue,
			currentPlaceholderContent,
		);

		t.truthy(result);
		t.true(result!.displayValue.includes('[Paste #'));
		t.true(result!.displayValue.includes('100 chars]'));
		t.is(Object.keys(result!.placeholderContent).length, 1);
	} finally {
		process.chdir(originalCwd);
		clearAppConfig();
	}
});

test('handlePaste namespaces paste ids so file mentions cannot collide', t => {
	const currentPlaceholderContent: Record<string, PlaceholderContent> = {
		file_1: {
			type: PlaceholderType.FILE,
			displayText: '[@src/app.tsx]',
			filePath: '/repo/src/app.tsx',
			content: 'file body',
		},
	};

	const result = handlePaste(
		'c'.repeat(801),
		'[@src/app.tsx] ',
		currentPlaceholderContent,
	);

	t.truthy(result);
	t.deepEqual(Object.keys(result!.placeholderContent).sort(), [
		'file_1',
		'paste_1',
	]);
	t.truthy(result!.placeholderContent.file_1, 'the file mention survives');
});

test('handlePaste does not reuse the id of a deleted paste', t => {
	const first = handlePaste('a'.repeat(801), '', {})!;
	const second = handlePaste(
		'b'.repeat(802),
		first.displayValue,
		first.placeholderContent,
	)!;

	t.deepEqual(Object.keys(second.placeholderContent), ['paste_1', 'paste_2']);

	// The user deletes the first paste, then pastes again.
	const surviving = {paste_2: second.placeholderContent.paste_2};
	const third = handlePaste(
		'c'.repeat(803),
		second.placeholderContent.paste_2.displayText,
		surviving,
	)!;

	t.deepEqual(Object.keys(third.placeholderContent), ['paste_2', 'paste_3']);
	t.is(
		(third.placeholderContent.paste_2 as PastePlaceholderContent).content,
		'b'.repeat(802),
		'the surviving paste keeps its own content',
	);
	t.is(
		(third.placeholderContent.paste_3 as PastePlaceholderContent).content,
		'c'.repeat(803),
	);
});

test('handlePaste continues numbering past legacy bare-numeric paste ids', t => {
	// Prompt history persists InputState, so pre-namespacing keys can come back.
	const legacy: Record<string, PlaceholderContent> = {
		'2': {
			type: PlaceholderType.PASTE,
			displayText: '[Paste #2: 900 chars]',
			content: 'x'.repeat(900),
			originalSize: 900,
		} as PastePlaceholderContent,
	};

	const result = handlePaste('d'.repeat(801), '[Paste #2: 900 chars]', legacy)!;

	t.deepEqual(Object.keys(result.placeholderContent).sort(), ['2', 'paste_3']);
	t.true(result.displayValue.includes('[Paste #3: 801 chars]'));
});
