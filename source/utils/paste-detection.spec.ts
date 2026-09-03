import test from 'ava';
import {PasteDetector} from './paste-detection';

// Tests for PasteDetector class
// Validates CLI paste detection logic

console.log(`\npaste-detection.spec.ts`);

test('PasteDetector detects rapid input as paste', t => {
	const detector = new PasteDetector();

	// Simulate rapid input - use 110 chars to exceed 50*2=100 threshold
	const result = detector.detectPaste('a'.repeat(110));

	t.true(result.isPaste);
	t.is(result.method, 'size'); // Large input detected as paste
	t.is(result.addedText, 'a'.repeat(110));
});

test('PasteDetector detects multi-line input as paste', t => {
	const detector = new PasteDetector();

	const multiLineText = 'line1\nline2\nline3\nline4';
	const result = detector.detectPaste(multiLineText);

	t.true(result.isPaste);
	// With low thresholds, size method triggers first (25 chars > 1*2 = 2)
	// but still correctly detected as paste
	t.true(['size', 'lines'].includes(result.method));
	t.is(result.addedText, multiLineText);
});

test('PasteDetector detects small paste', t => {
	const detector = new PasteDetector();

	// 15 characters - enough to trigger size detection (> 5*2 = 10)
	const result = detector.detectPaste('small paste txt');

	t.true(result.isPaste);
	t.is(result.method, 'size'); // 15 chars > 5*2 = 10
});

test('PasteDetector does not detect manual typing', async t => {
	const detector = new PasteDetector();

	// First input - 5 chars, below 10-char size threshold
	const result1 = detector.detectPaste('hello');
	t.false(result1.isPaste);
	t.is(result1.method, 'none');

	// Wait to simulate human typing speed (not a paste)
	await new Promise(resolve => setTimeout(resolve, 100));

	// Add more text (incremental) - adds " world" (6 chars), still below threshold
	const result2 = detector.detectPaste('hello world');
	t.false(result2.isPaste);
	t.is(result2.addedText, ' world');
	t.is(result2.method, 'none');
});

test('PasteDetector ignores deletions without returning sliced garbage', t => {
	const detector = new PasteDetector();

	detector.detectPaste('hello world');
	const result = detector.detectPaste('hello');

	t.false(result.isPaste);
	t.is(result.method, 'none');
	t.is(result.addedText, '');
	t.is(result.details.charsAdded, -6);
});

test('PasteDetector ignores unchanged input without returning text', t => {
	const detector = new PasteDetector();

	detector.detectPaste('hello');
	const result = detector.detectPaste('hello');

	t.false(result.isPaste);
	t.is(result.addedText, '');
	t.is(result.details.charsAdded, 0);
});

test('PasteDetector returns added text after a deletion', t => {
	const detector = new PasteDetector();

	detector.detectPaste('hello world');
	detector.detectPaste('hello');
	const result = detector.detectPaste('hello there!!!!');

	t.is(result.addedText, ' there!!!!');
	t.is(result.details.charsAdded, 10);
});

test('PasteDetector returns text inserted before existing input', t => {
	const detector = new PasteDetector();
	const pasted = 'pasted text at the front';

	detector.updateState('hello world');
	const result = detector.detectPaste(`${pasted}hello world`);

	t.true(result.isPaste);
	t.is(result.addedText, pasted);
});

test('PasteDetector returns text inserted mid-buffer', t => {
	const detector = new PasteDetector();
	const pasted = 'INSERTED IN THE MIDDLE';

	detector.updateState('hello world');
	const result = detector.detectPaste(`hello ${pasted}world`);

	t.true(result.isPaste);
	t.is(result.addedText, pasted);
});

test('PasteDetector returns the replacing text when input is overwritten', t => {
	const detector = new PasteDetector();
	const pasted = 'THE QUICK BROWN FOX JUMPED OVER';

	detector.updateState('hello world');
	const result = detector.detectPaste(pasted);

	t.true(result.isPaste);
	t.is(result.addedText, pasted);
});

test('PasteDetector counts lines added by a mid-buffer insert', t => {
	const detector = new PasteDetector();

	detector.updateState('start end');
	const result = detector.detectPaste('start \na\nb\nend');

	t.true(result.isPaste);
	t.is(result.addedText, '\na\nb\n');
	t.is(result.details.linesAdded, 3);
});

test('PasteDetector reset clears state', t => {
	const detector = new PasteDetector();

	detector.detectPaste('some text');
	detector.reset();

	const result = detector.detectPaste('new text');
	t.is(result.addedText, 'new text'); // Should be full text, not just diff
});
