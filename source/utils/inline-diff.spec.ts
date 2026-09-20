import test from 'ava';
import {areLinesSimlar, computeInlineDiff} from './inline-diff.js';

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
// areLinesSimlar Tests
// ============================================================================

test('areLinesSimlar: identical lines are similar', t => {
	t.true(areLinesSimlar('const x = 1;', 'const x = 1;'));
});

test('areLinesSimlar: lines with minor changes are similar', t => {
	t.true(areLinesSimlar('const x = 1;', 'const x = 2;'));
	t.true(areLinesSimlar('function foo() {}', 'function bar() {}'));
	t.true(areLinesSimlar('import React from "react";', 'import React from "react";'));
});

test('areLinesSimlar: lines with same structure are similar', t => {
	t.true(areLinesSimlar(
		'MIT License with Attribution',
		'MIT License',
	));
});

test('areLinesSimlar: completely different lines are not similar', t => {
	t.false(areLinesSimlar(
		'const x = 1;',
		'import foo from "bar";',
	));
	t.false(areLinesSimlar(
		'function test() {',
		'// This is a comment',
	));
});

test('areLinesSimlar: empty lines are similar to each other', t => {
	t.true(areLinesSimlar('', ''));
	t.true(areLinesSimlar('   ', '  '));
	t.true(areLinesSimlar('\t', '  '));
});

test('areLinesSimlar: empty vs non-empty are not similar', t => {
	t.false(areLinesSimlar('', 'content'));
	t.false(areLinesSimlar('content', ''));
	t.false(areLinesSimlar('   ', 'content'));
});

test('areLinesSimlar: lines sharing 30%+ words are similar', t => {
	// 3 out of 5 words shared = 60%
	t.true(areLinesSimlar(
		'const foo = bar + baz;',
		'const foo = qux + quux;',
	));

	// Only 1 out of 5 words shared = 20%
	t.false(areLinesSimlar(
		'const foo = bar + baz;',
		'let qux = quux * corge;',
	));
});

test('areLinesSimlar: handles special characters', t => {
	t.true(areLinesSimlar(
		'const regex = /test.*pattern/;',
		'const regex = /new.*pattern/;',
	));
});

test('areLinesSimlar: handles long lines', t => {
	const longLine1 = 'const result = someFunction(arg1, arg2, arg3, arg4, arg5);';
	const longLine2 = 'const result = someFunction(arg1, arg2, arg3, arg4, arg6);';

	t.true(areLinesSimlar(longLine1, longLine2));
});
