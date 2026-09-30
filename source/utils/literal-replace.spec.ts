import test from 'ava';
import {replaceFirstLiteral} from '@/utils/literal-replace';

console.log('\nliteral-replace.spec.ts');

test('replaceFirstLiteral replaces the first occurrence only', t => {
	t.is(replaceFirstLiteral('a b a b', 'a', 'X'), 'X b a b');
});

test('replaceFirstLiteral returns the content unchanged when absent', t => {
	t.is(replaceFirstLiteral('hello', 'nope', 'X'), 'hello');
});

test('replaceFirstLiteral does not collapse $$', t => {
	t.is(replaceFirstLiteral('pid=X', 'X', '$$'), 'pid=$$');
});

test('replaceFirstLiteral does not expand $& into the match', t => {
	t.is(replaceFirstLiteral('a MATCH b', 'MATCH', '$&'), 'a $& b');
});

test('replaceFirstLiteral does not expand $` into the prefix', t => {
	t.is(replaceFirstLiteral('BEFORE|X|AFTER', 'X', '$`'), 'BEFORE|$`|AFTER');
});

test("replaceFirstLiteral does not expand $' into the suffix", t => {
	t.is(replaceFirstLiteral('BEFORE|X|AFTER', 'X', "$'"), "BEFORE|$'|AFTER");
});

test('replaceFirstLiteral keeps group tokens literal', t => {
	t.is(replaceFirstLiteral('X', 'X', '$1 $<name> $99'), '$1 $<name> $99');
});

test('replaceFirstLiteral carries every token through in one pass', t => {
	const replacement = 'echo "pid=$$ match=$& pre=$` post=$\'"';

	t.is(
		replaceFirstLiteral('#!/bin/sh\necho "old"\nexit 0\n', 'echo "old"', replacement),
		`#!/bin/sh\n${replacement}\nexit 0\n`,
	);
});

test('replaceFirstLiteral handles an empty replacement (deletion)', t => {
	t.is(replaceFirstLiteral('keep DROP keep', 'DROP ', ''), 'keep keep');
});

test('replaceFirstLiteral matches String.replace for $-free input', t => {
	const content = 'alpha\nbeta\ngamma\n';

	t.is(
		replaceFirstLiteral(content, 'beta', 'BETA'),
		content.replace('beta', 'BETA'),
	);
});
