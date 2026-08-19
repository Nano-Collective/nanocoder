/**
 * CI Log Query Utilities Tests
 */

import test from 'ava';
import {queryCiLog} from './log-utils';

console.log('\nlog-utils.spec.ts – CI Log Query Utilities');

function makeLog(lineCount: number): string {
	return Array.from({length: lineCount}, (_, i) => `line ${i + 1}`).join('\n');
}

// ============================================================================
// Pagination (default, no search)
// ============================================================================

test('queryCiLog returns the whole log unchanged when under the limit', t => {
	const log = makeLog(10);
	const result = queryCiLog(log, {limit: 300});
	t.is(result.content, log);
	t.is(result.totalLines, 10);
	t.false(result.truncated);
});

test('queryCiLog handles an empty log', t => {
	const result = queryCiLog('');
	t.is(result.content, '');
	t.is(result.totalLines, 0);
	t.false(result.truncated);
});

test('queryCiLog defaults to the tail of a large log', t => {
	const log = makeLog(1000);
	const result = queryCiLog(log, {limit: 300});
	t.true(result.truncated);
	t.true(result.content.includes('line 1000'));
	t.true(result.content.includes('line 701'));
	t.false(result.content.includes('line 700'));
});

test('queryCiLog honors offset to page further back', t => {
	const log = makeLog(1000);
	const result = queryCiLog(log, {limit: 300, offset: 300});
	t.true(result.content.includes('line 700'));
	t.true(result.content.includes('line 401'));
	t.false(result.content.includes('line 701'));
	t.false(result.content.includes('line 400'));
});

test('queryCiLog offset beyond the start returns the earliest lines only', t => {
	const log = makeLog(100);
	const result = queryCiLog(log, {limit: 300, offset: 1000});
	t.true(result.content.includes('line 1'));
	t.true(result.content.includes('line 100'));
});

test('queryCiLog caps limit at the hard maximum', t => {
	const log = makeLog(5000);
	const result = queryCiLog(log, {limit: 100_000});
	const returnedLines = result.content
		.split('\n')
		.filter(l => l.startsWith('line '));
	t.true(returnedLines.length <= 2000);
});

// ============================================================================
// Search
// ============================================================================

test('queryCiLog search finds a matching line with context', t => {
	const lines = ['a', 'b', 'ERROR: boom', 'd', 'e'];
	const result = queryCiLog(lines.join('\n'), {
		search: 'error',
		limit: 300,
		contextLines: 1,
	});
	t.is(result.matchCount, 1);
	t.true(result.content.includes('ERROR: boom'));
	t.true(result.content.includes('b'));
	t.true(result.content.includes('d'));
	t.false(result.content.includes('a'));
	t.false(result.content.includes('e'));
});

test('queryCiLog search is case-insensitive', t => {
	const result = queryCiLog('Something FAILED here', {search: 'failed'});
	t.is(result.matchCount, 1);
});

test('queryCiLog search reports zero matches clearly', t => {
	const result = queryCiLog(makeLog(10), {search: 'nope'});
	t.is(result.matchCount, 0);
	t.regex(result.content, /No matches/);
});

test('queryCiLog search truncates when too many context lines match', t => {
	const lines = Array.from({length: 500}, (_, i) => `ERROR ${i}`);
	const result = queryCiLog(lines.join('\n'), {
		search: 'error',
		limit: 50,
		contextLines: 0,
	});
	t.is(result.matchCount, 500);
	t.true(result.truncated);
	t.regex(result.content, /showing last 50/);
});

test('queryCiLog search truncation keeps matches near the end, not the start', t => {
	const lines = Array.from({length: 500}, (_, i) => `line ${i}`);
	for (let i = 0; i < 500; i += 10) lines[i] = `ERROR at ${i}`;
	lines[499] = 'ERROR real cause here';
	const result = queryCiLog(lines.join('\n'), {
		search: 'error',
		limit: 5,
		contextLines: 0,
	});
	t.true(result.content.includes('ERROR real cause here'));
	t.false(result.content.includes('ERROR at 0'));
});

test('queryCiLog search separates non-adjacent match blocks with a marker', t => {
	const lines = ['ERROR one', 'x', 'x', 'x', 'x', 'x', 'ERROR two'];
	const result = queryCiLog(lines.join('\n'), {
		search: 'error',
		contextLines: 1,
	});
	t.true(result.content.includes('--'));
});
