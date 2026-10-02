import test from 'ava';
import {
	clampVisibleLines,
	getVisualLineSegments,
	moveCursorToVisualLine,
	wrapWithTrimmedContinuations,
} from './text-wrapping';

test('returns text unchanged if width <= 0', t => {
	t.is(wrapWithTrimmedContinuations('hello world', 0), 'hello world');
	t.is(wrapWithTrimmedContinuations('hello world', -1), 'hello world');
});

test('preserves empty lines', t => {
	const result = wrapWithTrimmedContinuations('hello\n\nworld', 80);
	t.is(result, 'hello\n\nworld');
});

test('wraps long lines at the given width', t => {
	const result = wrapWithTrimmedContinuations('aaa bbb ccc', 7);
	const lines = result.split('\n');
	t.true(lines.length > 1);
});

test('trims wrap-artifact leading spaces from continuation lines', t => {
	// "aaa bbb" wrapped at width 4 would split at the space, leaving " bbb"
	// Our function should trim that leading space artifact
	const result = wrapWithTrimmedContinuations('aaa bbb', 4);
	const lines = result.split('\n');
	for (let i = 1; i < lines.length; i++) {
		// Continuation lines should not start with a single artifact space
		// (they may start with intentional indentation, but not a wrap artifact)
		t.false(lines[i].startsWith(' ') && lines[i].trimStart() === lines[i].slice(1));
	}
});

test('handles multiline input correctly', t => {
	const input = 'line one\nline two\nline three';
	const result = wrapWithTrimmedContinuations(input, 80);
	t.is(result, input);
});

test('handles single character width with hard wrap', t => {
	const result = wrapWithTrimmedContinuations('ab', 1);
	const lines = result.split('\n');
	t.true(lines.length >= 2);
});

test('keeps the wrap-artifact space when it carries the inverse cursor', t => {
	// Cursor rendered as inverse space at a wrap boundary must stay visible:
	// stripping the space would leave an empty inverse span (invisible cursor)
	const inverseSpace = '\x1b[7m \x1b[27m';
	const result = wrapWithTrimmedContinuations(`aaa${inverseSpace}bbb`, 4);
	t.true(result.includes(inverseSpace));
});

// --- getVisualLineSegments ---

test('single short line is one segment', t => {
	t.deepEqual(getVisualLineSegments('hello', 80), [{start: 0, length: 5}]);
});

test('no width falls back to logical lines', t => {
	t.deepEqual(getVisualLineSegments('ab\ncd', undefined), [
		{start: 0, length: 2},
		{start: 3, length: 2},
	]);
});

test('long single line with no newline yields multiple segments', t => {
	// The reported bug: a text-wrapped prompt has no \n but renders as
	// several visual lines
	const segments = getVisualLineSegments('aaa bbb ccc', 4);
	t.true(segments.length > 1);
	// Segments tile the value exactly: each starts where the previous ended
	let expectedStart = 0;
	for (const seg of segments) {
		t.is(seg.start, expectedStart);
		expectedStart += seg.length;
	}
	t.is(expectedStart, 'aaa bbb ccc'.length);
});

test('hard-wrapped unbroken word yields fixed-width segments', t => {
	t.deepEqual(getVisualLineSegments('abcdefghij', 4), [
		{start: 0, length: 4},
		{start: 4, length: 4},
		{start: 8, length: 2},
	]);
});

test('mixes logical newlines and soft wraps', t => {
	const segments = getVisualLineSegments('short\naaaa bbbb', 5);
	// 'short' fits; 'aaaa bbbb' wraps into at least two segments
	t.is(segments[0].start, 0);
	t.is(segments[0].length, 5);
	t.true(segments.length >= 3);
	// Second logical line starts after the \n
	t.is(segments[1].start, 6);
});

test('empty lines produce zero-length segments', t => {
	t.deepEqual(getVisualLineSegments('a\n\nb', 80), [
		{start: 0, length: 1},
		{start: 2, length: 0},
		{start: 3, length: 1},
	]);
});

// --- moveCursorToVisualLine ---

test('down moves into the next soft-wrapped row preserving column', t => {
	// 'abcdefghij' at width 4 → rows: abcd | efgh | ij
	const segments = getVisualLineSegments('abcdefghij', 4);
	// Cursor on 'b' (offset 1), down → 'f' (offset 5)
	t.is(moveCursorToVisualLine(segments, 1, 'down'), 5);
});

test('up moves into the previous soft-wrapped row preserving column', t => {
	const segments = getVisualLineSegments('abcdefghij', 4);
	// Cursor on 'g' (offset 6), up → 'c' (offset 2)
	t.is(moveCursorToVisualLine(segments, 6, 'up'), 2);
});

test('column is clamped to a shorter target row', t => {
	const segments = getVisualLineSegments('abcdefghij', 4);
	// Cursor at col 3 of 'efgh' row (offset 7), down → 'ij' row end (offset 10)
	t.is(moveCursorToVisualLine(segments, 7, 'down'), 10);
});

test('up on first visual row returns null (history handoff)', t => {
	const segments = getVisualLineSegments('abcdefghij', 4);
	t.is(moveCursorToVisualLine(segments, 2, 'up'), null);
});

test('down on last visual row returns null (history handoff)', t => {
	const segments = getVisualLineSegments('abcdefghij', 4);
	t.is(moveCursorToVisualLine(segments, 9, 'down'), null);
});

test('navigates across logical newlines too', t => {
	const segments = getVisualLineSegments('hello\nworld', 80);
	// Cursor on 'r' (offset 8, col 2), up → 'l' (offset 2)
	t.is(moveCursorToVisualLine(segments, 8, 'up'), 2);
	// And back down
	t.is(moveCursorToVisualLine(segments, 2, 'down'), 8);
});

test('cursor at end of value navigates up correctly', t => {
	const segments = getVisualLineSegments('abcdefghij', 4);
	// Cursor past last char (offset 10, col 2 of 'ij'), up → offset 6
	t.is(moveCursorToVisualLine(segments, 10, 'up'), 6);
});

// --- clampVisibleLines ---

function offsetOfLine(lines: string[], lineIndex: number): number {
	return lines
		.slice(0, lineIndex)
		.reduce((sum, line) => sum + line.length + 1, 0);
}

test('clampVisibleLines returns lines unchanged when they already fit', t => {
	const lines = ['a', 'b', 'c'];
	t.deepEqual(clampVisibleLines(lines, 'a\nb\nc', 0, undefined, 5), lines);
});

test('clampVisibleLines returns lines unchanged when maxVisibleLines is not positive', t => {
	const lines = ['a', 'b', 'c'];
	t.deepEqual(clampVisibleLines(lines, 'a\nb\nc', 0, undefined, 0), lines);
});

test('clampVisibleLines windows to the cap and keeps a cursor at the end in view', t => {
	// Regression for #1557: a draft taller than the terminal must scroll
	// to the cursor's line rather than growing (or clipping it) off screen.
	const lines = Array.from({length: 20}, (_, i) => `line${i}`);
	const plainValue = lines.join('\n');
	const cursorOffset = offsetOfLine(lines, 19);
	const result = clampVisibleLines(lines, plainValue, cursorOffset, undefined, 5);
	t.is(result.length, 5);
	t.deepEqual(result, lines.slice(15, 20));
});

test('clampVisibleLines does not scroll past the start for a cursor near the top', t => {
	const lines = Array.from({length: 20}, (_, i) => `line${i}`);
	const plainValue = lines.join('\n');
	const cursorOffset = offsetOfLine(lines, 0);
	const result = clampVisibleLines(lines, plainValue, cursorOffset, undefined, 5);
	t.deepEqual(result, lines.slice(0, 5));
});

test('clampVisibleLines centers the window on a cursor in the middle', t => {
	const lines = Array.from({length: 20}, (_, i) => `line${i}`);
	const plainValue = lines.join('\n');
	const cursorOffset = offsetOfLine(lines, 10);
	const result = clampVisibleLines(lines, plainValue, cursorOffset, undefined, 5);
	t.deepEqual(result, lines.slice(8, 13));
	t.true(result.includes('line10'));
});
