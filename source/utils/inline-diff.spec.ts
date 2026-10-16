import test from 'ava';
import {
	areLinesSimilar,
	collapseUnchangedLines,
	computeInlineDiff,
	computeLineDiff,
} from './inline-diff.js';

// ============================================================================
// collapseUnchangedLines Tests
// ============================================================================

const numberedLines = (count: number, change?: {at: number; text: string}) =>
	Array.from({length: count}, (_, i) =>
		change && i + 1 === change.at ? change.text : `line ${i + 1}`,
	).join('\n');

test('collapseUnchangedLines: keeps three lines of context around a change', t => {
	const entries = computeLineDiff(
		numberedLines(100),
		numberedLines(100, {at: 80, text: 'CHANGED'}),
	);
	const collapsed = collapseUnchangedLines(entries);

	t.deepEqual(collapsed[0], {type: 'gap', count: 76});
	t.deepEqual(
		collapsed.slice(1, 4).map(e => e.type !== 'gap' && e.text),
		['line 77', 'line 78', 'line 79'],
	);
	t.true(collapsed.some(e => e.type === 'added' && e.text === 'CHANGED'));
	t.true(collapsed.some(e => e.type === 'removed' && e.text === 'line 80'));
	t.deepEqual(collapsed[collapsed.length - 1], {type: 'gap', count: 17});
});

test('collapseUnchangedLines: leaves a short unchanged run between changes intact', t => {
	const oldText = numberedLines(10);
	const newText = numberedLines(10)
		.replace('line 2\n', 'two\n')
		.replace('line 7\n', 'seven\n');
	const collapsed = collapseUnchangedLines(computeLineDiff(oldText, newText));

	t.false(collapsed.some(e => e.type === 'gap'));
});

test('collapseUnchangedLines: returns only a gap when nothing changed', t => {
	const text = numberedLines(10);
	t.deepEqual(collapseUnchangedLines(computeLineDiff(text, text)), [
		{type: 'gap', count: 10},
	]);
});

// ============================================================================
// computeInlineDiff Tests
// ============================================================================

test('computeInlineDiff: detects no changes for identical strings', t => {
	const segments = computeInlineDiff('hello world', 'hello world');

	t.is(segments.length, 1);
	t.is(segments[0].type, 'unchanged');
	t.is(segments[0].text, 'hello world');
});

test('computeInlineDiff: detects single word change', t => {
	const segments = computeInlineDiff(
		'const x = 1;',
		'const x = 2;',
	);

	// Should have: 'const x = ' (unchanged), '1' (removed), '2' (added), ';' (unchanged)
	const removed = segments.filter(s => s.type === 'removed');
	const added = segments.filter(s => s.type === 'added');

	t.is(removed.length, 1);
	t.is(added.length, 1);
	t.is(removed[0].text, '1');
	t.is(added[0].text, '2');
});

test('computeInlineDiff: detects word addition', t => {
	const segments = computeInlineDiff(
		'MIT License',
		'MIT License with Attribution',
	);

	const added = segments.filter(s => s.type === 'added');
	t.true(added.some(s => s.text.includes('with')));
	t.true(added.some(s => s.text.includes('Attribution')));
});

test('computeInlineDiff: detects word removal', t => {
	const segments = computeInlineDiff(
		'MIT License with Attribution',
		'MIT License',
	);

	const removed = segments.filter(s => s.type === 'removed');
	t.true(removed.some(s => s.text.includes('with')));
	t.true(removed.some(s => s.text.includes('Attribution')));
});

test('computeInlineDiff: handles multiple changes in a line', t => {
	const segments = computeInlineDiff(
		'function foo(a, b) { return a + b; }',
		'function bar(x, y) { return x + y; }',
	);

	const removed = segments.filter(s => s.type === 'removed');
	const added = segments.filter(s => s.type === 'added');

	// Should detect foo->bar, a->x, b->y changes
	t.true(removed.some(s => s.text.includes('foo')));
	t.true(added.some(s => s.text.includes('bar')));
});

test('computeInlineDiff: handles empty old string', t => {
	const segments = computeInlineDiff('', 'new content');

	t.is(segments.length, 1);
	t.is(segments[0].type, 'added');
	t.is(segments[0].text, 'new content');
});

test('computeInlineDiff: handles empty new string', t => {
	const segments = computeInlineDiff('old content', '');

	t.is(segments.length, 1);
	t.is(segments[0].type, 'removed');
	t.is(segments[0].text, 'old content');
});

test('computeInlineDiff: preserves whitespace in diff', t => {
	const segments = computeInlineDiff(
		'  const x = 1;',
		'  const x = 2;',
	);

	// Leading whitespace should be unchanged
	const unchanged = segments.filter(s => s.type === 'unchanged');
	t.true(unchanged.some(s => s.text.includes('  const')));
});

// ============================================================================
// areLinesSimilar Tests
// ============================================================================

test('areLinesSimilar: identical lines are similar', t => {
	t.true(areLinesSimilar('const x = 1;', 'const x = 1;'));
});

test('areLinesSimilar: lines with minor changes are similar', t => {
	t.true(areLinesSimilar('const x = 1;', 'const x = 2;'));
	t.true(areLinesSimilar('function foo() {}', 'function bar() {}'));
	t.true(areLinesSimilar('import React from "react";', 'import React from "react";'));
});

test('areLinesSimilar: lines with same structure are similar', t => {
	t.true(areLinesSimilar(
		'MIT License with Attribution',
		'MIT License',
	));
});

test('areLinesSimilar: completely different lines are not similar', t => {
	t.false(areLinesSimilar(
		'const x = 1;',
		'import foo from "bar";',
	));
	t.false(areLinesSimilar(
		'function test() {',
		'// This is a comment',
	));
});

test('areLinesSimilar: empty lines are similar to each other', t => {
	t.true(areLinesSimilar('', ''));
	t.true(areLinesSimilar('   ', '  '));
	t.true(areLinesSimilar('\t', '  '));
});

test('areLinesSimilar: empty vs non-empty are not similar', t => {
	t.false(areLinesSimilar('', 'content'));
	t.false(areLinesSimilar('content', ''));
	t.false(areLinesSimilar('   ', 'content'));
});

test('areLinesSimilar: lines sharing 30%+ words are similar', t => {
	// 3 out of 5 words shared = 60%
	t.true(areLinesSimilar(
		'const foo = bar + baz;',
		'const foo = qux + quux;',
	));

	// Only 1 out of 5 words shared = 20%
	t.false(areLinesSimilar(
		'const foo = bar + baz;',
		'let qux = quux * corge;',
	));
});

test('areLinesSimilar: handles special characters', t => {
	t.true(areLinesSimilar(
		'const regex = /test.*pattern/;',
		'const regex = /new.*pattern/;',
	));
});

test('areLinesSimilar: handles long lines', t => {
	const longLine1 = 'const result = someFunction(arg1, arg2, arg3, arg4, arg5);';
	const longLine2 = 'const result = someFunction(arg1, arg2, arg3, arg4, arg6);';

	t.true(areLinesSimilar(longLine1, longLine2));
});

// ============================================================================
// computeLineDiff Tests
// ============================================================================

test('computeLineDiff: identical inputs produce only unchanged entries with matching line numbers', t => {
	const entries = computeLineDiff('alpha\nbeta\ngamma\n', 'alpha\nbeta\ngamma\n');

	t.is(entries.length, 3);
	t.true(entries.every(entry => entry.type === 'unchanged'));
	t.deepEqual(
		entries.map(e => ({text: e.text, oldLine: e.oldLine, newLine: e.newLine})),
		[
			{text: 'alpha', oldLine: 1, newLine: 1},
			{text: 'beta', oldLine: 2, newLine: 2},
			{text: 'gamma', oldLine: 3, newLine: 3},
		],
	);
});

test('computeLineDiff: pure insertion increments newLine only and keeps oldLine at zero', t => {
	const entries = computeLineDiff('', 'first\nsecond\nthird\n');

	t.is(entries.length, 3);
	t.true(entries.every(entry => entry.type === 'added'));
	t.deepEqual(
		entries.map(e => ({text: e.text, newLine: e.newLine})),
		[
			{text: 'first', newLine: 1},
			{text: 'second', newLine: 2},
			{text: 'third', newLine: 3},
		],
	);
	for (const entry of entries) {
		t.false('oldLine' in entry);
	}
});

test('computeLineDiff: pure deletion increments oldLine only and keeps newLine at zero', t => {
	const entries = computeLineDiff('first\nsecond\nthird\n', '');

	t.is(entries.length, 3);
	t.true(entries.every(entry => entry.type === 'removed'));
	t.deepEqual(
		entries.map(e => ({text: e.text, oldLine: e.oldLine})),
		[
			{text: 'first', oldLine: 1},
			{text: 'second', oldLine: 2},
			{text: 'third', oldLine: 3},
		],
	);
	for (const entry of entries) {
		t.false('newLine' in entry);
	}
});

test('computeLineDiff: trailing newline is stripped so an unchanged file with no trailing newline matches one with a trailing newline', t => {
	const withTrailing = computeLineDiff('a\nb\nc\n', 'a\nb\nc\n');
	const withoutTrailing = computeLineDiff('a\nb\nc', 'a\nb\nc');

	t.is(withTrailing.length, 3);
	t.is(withoutTrailing.length, 3);
	t.true(withTrailing.every(entry => entry.type === 'unchanged'));
	t.true(withoutTrailing.every(entry => entry.type === 'unchanged'));
});

test('computeLineDiff: both inputs empty returns an empty array', t => {
	t.deepEqual(computeLineDiff('', ''), []);
});

test('computeLineDiff: line numbers stay monotonic across mixed unchanged / added / removed runs', t => {
	const entries = computeLineDiff(
		'one\ntwo\nthree\n',
		'one\nTWO\nthree\nfour\n',
	);

	const unchanged = entries.filter(e => e.type === 'unchanged');
	const removed = entries.filter(e => e.type === 'removed');
	const added = entries.filter(e => e.type === 'added');

	t.is(removed.length, 1);
	t.is(added.length, 2);
	t.is(unchanged.length, 2);

	const removedLine = removed[0].oldLine;
	const addedFirstLine = added[0].newLine;
	t.true(removedLine === addedFirstLine, 'a removed/added pair should share a line slot');

	let lastUnchangedNew = 0;
	for (const entry of unchanged) {
		t.true(entry.newLine > lastUnchangedNew);
		lastUnchangedNew = entry.newLine;
	}
});
