import {existsSync, mkdirSync, rmSync, writeFileSync, readFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import test from 'ava';
import {PromptHistory} from './prompt-history.js';
import type {InputState} from './types/hooks';

console.log('\nprompt-history.spec.ts');

// Create a temporary test directory
const testDir = join(tmpdir(), `nanocoder-test-${Date.now()}`);
const ENTRY_SEPARATOR = '\n---ENTRY_SEPARATOR---\n';
const JSON_FORMAT_MARKER = '---JSON_FORMAT---';

// Helper to create an InputState object
function createInputState(
	displayValue: string,
	placeholderContent: Record<string, any> = {},
): InputState {
	return {displayValue, placeholderContent};
}

// Helper to create a PromptHistory instance with isolated temp file
function createTestHistory(): PromptHistory {
	const tempFile = join(testDir, `history-${Date.now()}-${Math.random()}.json`);
	return new PromptHistory(tempFile);
}

// Helper to wait for file to be written with expected content
async function waitForFileContent(
	filePath: string,
	minLength: number,
	maxWaitMs: number = 2000,
): Promise<boolean> {
	const startTime = Date.now();
	while (Date.now() - startTime < maxWaitMs) {
		if (existsSync(filePath)) {
			try {
				const content = readFileSync(filePath, 'utf8');
				if (content.length >= minLength) {
					return true;
				}
			} catch {
				// File might be being written, try again
			}
		}
		await new Promise(resolve => setTimeout(resolve, 10));
	}
	return false;
}

test.before(() => {
	// Create test directory
	mkdirSync(testDir, {recursive: true});
});

test.after.always(() => {
	// Clean up test directory
	if (existsSync(testDir)) {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test('addPrompt with string adds to history', t => {
	const history = createTestHistory();

	history.addPrompt('test command');

	const historyItems = history.getHistory();
	t.is(historyItems.length, 1, 'Should have one entry');
	t.is(historyItems[0]?.displayValue, 'test command');
	t.deepEqual(historyItems[0]?.placeholderContent, {});
});

test('addPrompt with InputState adds to history', t => {
	const history = createTestHistory();

	const inputState = createInputState('complex command', {
		id1: {content: 'data'},
	});
	history.addPrompt(inputState);

	const historyItems = history.getHistory();
	t.is(historyItems.length, 1, 'Should have one entry');
	t.is(historyItems[0]?.displayValue, 'complex command');
	t.deepEqual(historyItems[0]?.placeholderContent, {id1: {content: 'data'}});
});

test('addPrompt ignores empty strings', t => {
	const history = createTestHistory();

	history.addPrompt('');
	history.addPrompt('   ');

	t.is(history.getHistory().length, 0, 'Should not add empty strings');
});

test('addPrompt ignores empty InputState', t => {
	const history = createTestHistory();

	history.addPrompt(createInputState(''));
	history.addPrompt(createInputState('   '));

	t.is(
		history.getHistory().length,
		0,
		'Should not add empty InputState objects',
	);
});

test('addPrompt removes duplicates', t => {
	const history = createTestHistory();

	history.addPrompt('command one');
	history.addPrompt('command two');
	history.addPrompt('command one'); // Duplicate

	const historyItems = history.getHistory();
	t.is(historyItems.length, 2, 'Should have two unique entries');
	t.is(historyItems[0]?.displayValue, 'command two');
	t.is(historyItems[1]?.displayValue, 'command one'); // Moved to end
});

test('addPrompt respects MAX_PROMPT_HISTORY_SIZE', t => {
	const history = createTestHistory();

	// Add more than MAX_PROMPT_HISTORY_SIZE entries (100)
	for (let i = 0; i < 105; i++) {
		history.addPrompt(`command ${i}`);
	}

	const historyItems = history.getHistory();
	t.is(historyItems.length, 100, 'Should keep only 100 entries');
	t.is(
		historyItems[0]?.displayValue,
		'command 5',
		'Should keep most recent entries',
	);
	t.is(historyItems[99]?.displayValue, 'command 104');
});

test('addPrompt resets currentIndex', t => {
	const history = createTestHistory();

	history.addPrompt('command one');
	history.addPrompt('command two');

	// Navigate history
	history.getPrevious();
	history.getPrevious();

	// Add new prompt should reset index
	history.addPrompt('command three');

	const next = history.getPrevious();
	t.is(next?.displayValue, 'command three', 'Should start from most recent');
});

test('getPrevious navigates backward through history', t => {
	const history = createTestHistory();

	history.addPrompt('command one');
	history.addPrompt('command two');
	history.addPrompt('command three');

	const prev1 = history.getPrevious();
	t.is(prev1?.displayValue, 'command three', 'Should get most recent');

	const prev2 = history.getPrevious();
	t.is(prev2?.displayValue, 'command two', 'Should get previous entry');

	const prev3 = history.getPrevious();
	t.is(prev3?.displayValue, 'command one', 'Should get oldest entry');

	const prev4 = history.getPrevious();
	t.is(prev4?.displayValue, 'command one', 'Should stay at oldest');
});

test('getPrevious returns null for empty history', t => {
	const history = createTestHistory();

	t.is(history.getPrevious(), null, 'Should return null for empty history');
});

test('getNext navigates forward through history', t => {
	const history = createTestHistory();

	history.addPrompt('command one');
	history.addPrompt('command two');
	history.addPrompt('command three');

	// Navigate to beginning
	history.getPrevious();
	history.getPrevious();
	history.getPrevious();

	const next1 = history.getNext();
	t.is(next1?.displayValue, 'command two', 'Should move forward');

	const next2 = history.getNext();
	t.is(next2?.displayValue, 'command three', 'Should move to most recent');

	const next3 = history.getNext();
	t.is(next3, null, 'Should return null at end');
});

test('getNext returns null when not navigating', t => {
	const history = createTestHistory();

	history.addPrompt('command one');

	t.is(
		history.getNext(),
		null,
		'Should return null when currentIndex is -1',
	);
});

test('getNext returns null for empty history', t => {
	const history = createTestHistory();

	t.is(history.getNext(), null, 'Should return null for empty history');
});

test('resetIndex resets navigation', t => {
	const history = createTestHistory();

	history.addPrompt('command one');
	history.addPrompt('command two');

	history.getPrevious();
	history.getPrevious();

	history.resetIndex();

	const prev = history.getPrevious();
	t.is(prev?.displayValue, 'command two', 'Should start from most recent');
});

test('getPreviousString returns string value', t => {
	const history = createTestHistory();

	history.addPrompt('test command');

	const prevString = history.getPreviousString();
	t.is(prevString, 'test command', 'Should return string value');
});

test('getPreviousString returns null for empty history', t => {
	const history = createTestHistory();

	t.is(
		history.getPreviousString(),
		null,
		'Should return null for empty history',
	);
});

test('getNextString returns string value', t => {
	const history = createTestHistory();

	history.addPrompt('command one');
	history.addPrompt('command two');

	history.getPrevious();
	history.getPrevious();

	const nextString = history.getNextString();
	t.is(nextString, 'command two', 'Should return string value');
});

test('getNextString returns null at end', t => {
	const history = createTestHistory();

	history.addPrompt('command one');

	history.getPrevious();

	const nextString = history.getNextString();
	t.is(
		nextString,
		null,
		'Should return null when reaching end',
	);
});

test('getHistory returns copy of history', t => {
	const history = createTestHistory();

	history.addPrompt('command one');
	history.addPrompt('command two');

	const historyItems = history.getHistory();
	t.is(historyItems.length, 2, 'Should have two entries');

	// Modify the returned array
	historyItems.push(createInputState('command three'));

	// Original should be unchanged
	t.is(
		history.getHistory().length,
		2,
		'Original history should be unchanged',
	);
});

test('getHistoryStrings returns string array', t => {
	const history = createTestHistory();

	history.addPrompt(createInputState('command one', {id: 'data'}));
	history.addPrompt('command two');

	const strings = history.getHistoryStrings();
	t.deepEqual(
		strings,
		['command one', 'command two'],
		'Should return array of display values',
	);
});

test('navigation wraps correctly at boundaries', t => {
	const history = createTestHistory();

	history.addPrompt('command one');
	history.addPrompt('command two');

	// Go to oldest
	history.getPrevious();
	history.getPrevious();

	// Try to go further back
	const stuck = history.getPrevious();
	t.is(stuck?.displayValue, 'command one', 'Should stay at oldest');

	// Go to newest
	history.getNext();
	const atEnd = history.getNext();
	t.is(atEnd, null, 'Should return null at newest');
});

test('mixed string and InputState prompts work together', t => {
	const history = createTestHistory();

	history.addPrompt('string command');
	history.addPrompt(createInputState('input state command', {id: 'data'}));
	history.addPrompt('another string');

	const historyItems = history.getHistory();
	t.is(historyItems.length, 3, 'Should have three entries');
	t.is(historyItems[0]?.displayValue, 'string command');
	t.deepEqual(historyItems[0]?.placeholderContent, {});
	t.is(historyItems[1]?.displayValue, 'input state command');
	t.deepEqual(historyItems[1]?.placeholderContent, {id: 'data'});
	t.is(historyItems[2]?.displayValue, 'another string');
});

test('duplicate removal works with InputState', t => {
	const history = createTestHistory();

	history.addPrompt(
		createInputState('command', {id1: {content: 'placeholder1'}}),
	);
	history.addPrompt(createInputState('other'));
	history.addPrompt(
		createInputState('command', {id2: {content: 'placeholder2'}}),
	);

	const historyItems = history.getHistory();
	t.is(historyItems.length, 2, 'Should remove duplicate by displayValue');
	t.is(historyItems[0]?.displayValue, 'other');
	t.is(historyItems[1]?.displayValue, 'command');
	// The second "command" should have replaced the first
	t.deepEqual(historyItems[1]?.placeholderContent, {
		id2: {content: 'placeholder2'},
	});
});

test('addPrompt trims whitespace from strings', t => {
	const history = createTestHistory();

	history.addPrompt('  test command  ');

	const historyItems = history.getHistory();
	t.is(
		historyItems[0]?.displayValue,
		'test command',
		'Should trim whitespace',
	);
});

test('navigation index stays within bounds', t => {
	const history = createTestHistory();

	history.addPrompt('command one');

	// Start from beginning
	const first = history.getPrevious();
	t.is(first?.displayValue, 'command one');

	// Try to go back further (should stay at first)
	const stillFirst = history.getPrevious();
	t.is(stillFirst?.displayValue, 'command one');

	// Go forward to end
	const end = history.getNext();
	t.is(end, null);

	// Try to go forward further (should return null)
	const stillEnd = history.getNext();
	t.is(stillEnd, null);
});

test('resetIndex allows re-navigation from start', t => {
	const history = createTestHistory();

	history.addPrompt('command one');
	history.addPrompt('command two');
	history.addPrompt('command three');

	// Navigate partially
	history.getPrevious(); // command three
	history.getPrevious(); // command two

	// Reset
	history.resetIndex();

	// Should start from most recent again
	const prev = history.getPrevious();
	t.is(prev?.displayValue, 'command three', 'Should restart from newest');
});

test('getPrevious at end of forward navigation restarts properly', t => {
	const history = createTestHistory();

	history.addPrompt('command one');
	history.addPrompt('command two');

	// Navigate backward
	history.getPrevious();
	history.getPrevious();

	// Navigate forward to end (returns null, resets index to -1)
	history.getNext();
	const atEnd = history.getNext();
	t.is(atEnd, null);

	// Now getPrevious should start from most recent
	const prev = history.getPrevious();
	t.is(prev?.displayValue, 'command two', 'Should start from most recent');
});

test('history maintains order after adding many items', t => {
	const history = createTestHistory();

	for (let i = 0; i < 50; i++) {
		history.addPrompt(`command ${i}`);
	}

	const historyItems = history.getHistory();
	t.is(historyItems.length, 50);
	t.is(historyItems[0]?.displayValue, 'command 0');
	t.is(historyItems[49]?.displayValue, 'command 49');
});

test('migrateStringArrayToInputState preserves order', t => {
	const history = createTestHistory();

	// We can't directly test the private method, but we can test its effect
	// by testing the public API with different input types
	history.addPrompt('first');
	history.addPrompt(createInputState('second', {id: 'test'}));
	history.addPrompt('third');

	const historyItems = history.getHistory();
	t.is(historyItems[0]?.displayValue, 'first');
	t.is(historyItems[1]?.displayValue, 'second');
	t.is(historyItems[2]?.displayValue, 'third');
});

test('adding duplicate moves it to end and updates placeholderContent', t => {
	const history = createTestHistory();

	history.addPrompt(
		createInputState('command', {id1: {content: 'original'}}),
	);
	history.addPrompt('other command');
	history.addPrompt(createInputState('command', {id2: {content: 'updated'}}));

	const historyItems = history.getHistory();
	t.is(historyItems.length, 2, 'Should have two entries');
	t.is(historyItems[0]?.displayValue, 'other command');
	t.is(historyItems[1]?.displayValue, 'command');
	t.deepEqual(
		historyItems[1]?.placeholderContent,
		{id2: {content: 'updated'}},
		'Should use new placeholderContent',
	);
});

test('getNext after reaching end resets index to -1', t => {
	const history = createTestHistory();

	history.addPrompt('command one');
	history.addPrompt('command two');

	// Navigate backward
	history.getPrevious();
	history.getPrevious();

	// Navigate forward past end
	history.getNext();
	const result = history.getNext();
	t.is(result, null);

	// getNext at -1 should return null
	const shouldBeNull = history.getNext();
	t.is(shouldBeNull, null);
});

test('backwards compatibility - getPreviousString vs getPrevious', t => {
	const history = createTestHistory();

	history.addPrompt(createInputState('test', {id: 'data'}));

	const inputState = history.getPrevious();
	const stringValue = history.getPreviousString();

	// After getPrevious, calling getPreviousString will try to go back again
	// but since we're at the oldest, it should return the same
	t.is(inputState?.displayValue, 'test');
	t.is(stringValue, 'test');
});

test('backwards compatibility - getNextString returns null at end', t => {
	const history = createTestHistory();

	history.addPrompt('test');
	history.getPrevious();

	const nextString = history.getNextString();
	t.is(
		nextString,
		null,
		'Legacy method should return null, matching getNext',
	);
});

// File I/O Tests - Testing loadHistory and saveHistory

test('loadHistory handles non-existent file', async t => {
	const tempFile = join(testDir, `history-${Date.now()}-${Math.random()}.json`);
	const history = new PromptHistory(tempFile);

	// loadHistory is called internally, but we can test it works without errors
	await t.notThrowsAsync(async () => {
		await history.loadHistory();
	});

	// Should have empty history when file doesn't exist
	t.is(history.getHistory().length, 0);
});

test('loadHistory parses JSON format correctly', async t => {
	const tempFile = join(testDir, `history-${Date.now()}-${Math.random()}.json`);
	const history = new PromptHistory(tempFile);

	// Add some data
	history.addPrompt(createInputState('command 1', {id: 'data'}));
	history.addPrompt('command 2');

	// Save it (which uses JSON format)
	await history.saveHistory();

	// Wait for file to be written
	const fileReady = await waitForFileContent(tempFile, 50, 2000);
	t.true(fileReady, 'History file should be written with content');

	// Create a new instance and load
	const history2 = new PromptHistory(tempFile);
	await history2.loadHistory();

	// Should have the same data
	const loaded = history2.getHistory();
	t.is(loaded.length, 2, 'Should have exactly 2 entries');

	// Check the entries directly (no need to search since we have isolated data)
	t.is(loaded[0]?.displayValue, 'command 1');
	t.deepEqual(loaded[0]?.placeholderContent, {id: 'data'});
	t.is(loaded[1]?.displayValue, 'command 2');
	t.deepEqual(loaded[1]?.placeholderContent, {});
});

test('saveHistory persists data to disk', async t => {
	const tempFile = join(testDir, `history-${Date.now()}-${Math.random()}.json`);
	const history = new PromptHistory(tempFile);

	history.addPrompt('persisted command');
	history.addPrompt(createInputState('complex command', {key: 'value'}));

	// Save is called automatically by addPrompt, but we'll call it explicitly and wait
	await history.saveHistory();

	// Wait for file to be written with reasonable content (at least 50 bytes)
	const fileReady = await waitForFileContent(tempFile, 50, 2000);
	t.true(fileReady, 'History file should be written with content');

	// Load in a new instance
	const history2 = new PromptHistory(tempFile);
	await history2.loadHistory();

	const loaded = history2.getHistory();
	t.is(loaded.length, 2, 'Should have exactly 2 entries');

	// Check both entries directly
	t.is(loaded[0]?.displayValue, 'persisted command', 'Should find persisted command');
	t.deepEqual(loaded[0]?.placeholderContent, {});
	t.is(loaded[1]?.displayValue, 'complex command', 'Should find complex command');
	t.deepEqual(loaded[1]?.placeholderContent, {key: 'value'});
});

test('loadHistory handles legacy ENTRY_SEPARATOR format', async t => {
	const tempFile = join(testDir, `history-${Date.now()}-${Math.random()}.json`);

	// Create a legacy format file manually
	const legacyContent = `command 1${ENTRY_SEPARATOR}command 2${ENTRY_SEPARATOR}command 3`;
	writeFileSync(tempFile, legacyContent, 'utf8');

	const history = new PromptHistory(tempFile);
	await history.loadHistory();

	const loaded = history.getHistory();
	t.is(loaded.length, 3, 'Should have loaded 3 entries');
	t.is(loaded[0]?.displayValue, 'command 1');
	t.is(loaded[1]?.displayValue, 'command 2');
	t.is(loaded[2]?.displayValue, 'command 3');
	t.deepEqual(loaded[0]?.placeholderContent, {}, 'Migrated entries should have empty placeholderContent');
});

test('loadHistory handles very old newline format', async t => {
	const tempFile = join(testDir, `history-${Date.now()}-${Math.random()}.json`);

	// Create a very old format file (newline-separated)
	const oldContent = 'command 1\ncommand 2\ncommand 3\n';
	writeFileSync(tempFile, oldContent, 'utf8');

	const history = new PromptHistory(tempFile);
	await history.loadHistory();

	const loaded = history.getHistory();
	t.is(loaded.length, 3, 'Should have loaded 3 entries');
	t.is(loaded[0]?.displayValue, 'command 1');
	t.is(loaded[1]?.displayValue, 'command 2');
	t.is(loaded[2]?.displayValue, 'command 3');
	t.deepEqual(loaded[0]?.placeholderContent, {}, 'Migrated entries should have empty placeholderContent');
});

test('saveHistory handles write errors gracefully', async t => {
	// Use an invalid path that will cause write to fail (directory doesn't exist)
	const invalidPath = '/nonexistent/directory/history.json';
	const history = new PromptHistory(invalidPath);

	history.addPrompt('test command');

	// saveHistory swallows errors, so it should never throw
	await t.notThrowsAsync(async () => {
		await history.saveHistory();
	});
});

test('migrateStringArrayToInputState converts strings correctly', t => {
	const history = createTestHistory();

	// We can't call the private method directly, but we can test its effect
	// by verifying that string prompts are converted to InputState format
	history.addPrompt('string prompt 1');
	history.addPrompt('string prompt 2');

	const historyItems = history.getHistory();

	for (const item of historyItems) {
		t.truthy(item.displayValue, 'Should have displayValue');
		t.truthy(item.placeholderContent !== undefined, 'Should have placeholderContent');
		t.deepEqual(
			item.placeholderContent,
			{},
			'String prompts should have empty placeholderContent',
		);
	}
});

test('history file uses JSON format marker', async t => {
	const tempFile = join(testDir, `history-${Date.now()}-${Math.random()}.json`);
	const history = new PromptHistory(tempFile);

	const uniqueCommand = `test-format-${Date.now()}-${Math.random()}`;
	history.addPrompt(uniqueCommand);
	await history.saveHistory();

	// Read the raw file to verify format
	const content = readFileSync(tempFile, 'utf8');
	t.true(content.startsWith(JSON_FORMAT_MARKER), 'File should start with JSON format marker');

	// Verify we can load it back
	const history2 = new PromptHistory(tempFile);
	await history2.loadHistory();

	const loaded = history2.getHistory();
	t.is(loaded.length, 1, 'Should have exactly 1 entry');
	t.is(loaded[0]?.displayValue, uniqueCommand, 'Should load the saved command');
});

test('loadHistory resets currentIndex after loading', async t => {
	const tempFile = join(testDir, `history-${Date.now()}-${Math.random()}.json`);
	const history = new PromptHistory(tempFile);

	history.addPrompt('command 1');
	history.addPrompt('command 2');

	// Navigate to set index
	history.getPrevious();
	history.getPrevious();

	// Save and load history should reset index
	await history.saveHistory();
	await history.loadHistory();

	// After loading, getPrevious should start from the end
	const prev = history.getPrevious();

	// Should get the most recent item
	t.truthy(prev, 'Should have a previous item');
	t.is(prev?.displayValue, 'command 2', 'Should start from most recent after load');
});
