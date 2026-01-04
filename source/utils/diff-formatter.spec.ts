import test from 'ava';
import {formatInlineDiff} from './diff-formatter.js';

test('should format diff for single line changes', t => {
	const oldContent = 'line 1\nline 2\nline 3';
	const newContent = 'line 1\nchanged line 2\nline 3';
	const result = formatInlineDiff(oldContent, newContent);

	t.true(result.summary.addedLines > 0);
	t.true(result.summary.removedLines > 0);
	t.true(result.lines.some(l => l.type === 'added'));
	t.true(result.lines.some(l => l.type === 'removed'));
});

test('should handle multi-line changes', t => {
	const oldContent = 'line 1\nline 2\nline 3\nline 4\nline 5';
	const newContent = 'line 1\nline 2 modified\nline 3 modified\nline 4\nline 5';
	const result = formatInlineDiff(oldContent, newContent);

	t.true(result.summary.addedLines >= 2);
	t.true(result.summary.removedLines >= 2);
});

test('should handle additions only', t => {
	const oldContent = 'line 1\nline 2';
	const newContent = 'line 1\nline 2\nnew line 3\nnew line 4';
	const result = formatInlineDiff(oldContent, newContent);

	t.true(result.summary.addedLines > 0);
	t.is(result.summary.removedLines, 0);
	t.true(result.lines.some(l => l.type === 'added'));
	t.false(result.lines.some(l => l.type === 'removed'));
});

test('should handle deletions only', t => {
	const oldContent = 'line 1\nline 2\nline 3\nline 4';
	const newContent = 'line 1\nline 2';
	const result = formatInlineDiff(oldContent, newContent);

	t.is(result.summary.addedLines, 0);
	t.true(result.summary.removedLines > 0);
	t.false(result.lines.some(l => l.type === 'added'));
	t.true(result.lines.some(l => l.type === 'removed'));
});

test('should handle replacements', t => {
	const oldContent = 'old line 1\nold line 2\nold line 3';
	const newContent = 'new line 1\nnew line 2\nnew line 3';
	const result = formatInlineDiff(oldContent, newContent);

	t.true(result.summary.addedLines === 3);
	t.true(result.summary.removedLines === 3);
});

test('should include context lines with default context', t => {
	const oldContent = Array.from({length: 20}, (_, i) => `line ${i}`).join('\n');
	const newContent = Array.from(
		{length: 20},
		(_, i) => `line ${i}${i === 10 ? ' modified' : ''}`,
	).join('\n');
	const result = formatInlineDiff(oldContent, newContent, 2);

	t.true(result.lines.some(l => l.type === 'context'));
});

test('should respect custom context lines', t => {
	const oldContent = Array.from({length: 20}, (_, i) => `line ${i}`).join('\n');
	const newContent = Array.from(
		{length: 20},
		(_, i) => `line ${i}${i === 10 ? ' modified' : ''}`,
	).join('\n');

	// Test with 0 context lines
	const resultNoContext = formatInlineDiff(oldContent, newContent, 0);
	const contextLinesNoContext = resultNoContext.lines.filter(
		l => l.type === 'context',
	);
	t.is(contextLinesNoContext.length, 0);

	// Test with 5 context lines
	const resultWithContext = formatInlineDiff(oldContent, newContent, 5);
	t.true(resultWithContext.lines.some(l => l.type === 'context'));
});

test('should calculate correct summary statistics', t => {
	const oldContent = 'line 1\nline 2\nline 3';
	const newContent = 'line 1\nchanged line 2\nline 3\nnew line 4';
	const result = formatInlineDiff(oldContent, newContent);

	t.is(result.summary.addedLines, 2);
	t.is(result.summary.removedLines, 1);
	t.true(
		result.summary.totalLines >
			result.summary.addedLines + result.summary.removedLines,
	);
});

test('should handle empty content', t => {
	const result = formatInlineDiff('', '');

	t.is(result.summary.totalLines, 0);
	t.is(result.summary.addedLines, 0);
	t.is(result.summary.removedLines, 0);
});

test('should handle empty old content (insert)', t => {
	const newContent = 'line 1\nline 2\nline 3';
	const result = formatInlineDiff('', newContent);

	t.is(result.summary.removedLines, 0);
	t.is(result.summary.addedLines, 3);
});

test('should handle empty new content (delete)', t => {
	const oldContent = 'line 1\nline 2\nline 3';
	const result = formatInlineDiff(oldContent, '');

	t.is(result.summary.addedLines, 0);
	t.is(result.summary.removedLines, 3);
});

test('should assign correct line numbers', t => {
	const oldContent = 'line 1\nline 2\nline 3';
	const newContent = 'line 1\nchanged line 2\nline 3';
	const result = formatInlineDiff(oldContent, newContent);

	// Check that line numbers are sequential and start from 1
	const sortedLineNumbers = result.lines
		.map(l => l.lineNumber)
		.sort((a, b) => a - b);
	t.is(sortedLineNumbers[0], 1);
	t.is(
		sortedLineNumbers[sortedLineNumbers.length - 1],
		sortedLineNumbers.length,
	);
});

test('should preserve line content', t => {
	const oldContent = 'line 1\nline 2\nline 3';
	const newContent = 'line 1\nchanged line 2\nline 3';
	const result = formatInlineDiff(oldContent, newContent);

	t.true(result.lines.some(l => l.content === 'changed line 2'));
	t.true(result.lines.some(l => l.content === 'line 1'));
});

test('should handle identical content (no changes)', t => {
	const content = 'line 1\nline 2\nline 3';
	const result = formatInlineDiff(content, content);

	t.is(result.summary.addedLines, 0);
	t.is(result.summary.removedLines, 0);
});

test('should handle unicode content', t => {
	const oldContent = 'Hello 世界\nПривет мир';
	const newContent = 'Hello 世界\nПривет мир\nBonjour monde';
	const result = formatInlineDiff(oldContent, newContent);

	t.is(result.summary.addedLines, 1);
	t.true(result.lines.some(l => l.content.includes('Bonjour')));
});

test('should handle large diffs efficiently', t => {
	const oldContent = Array.from(
		{length: 1000},
		(_, i) => `line ${i}`,
	).join('\n');
	const newContent = Array.from(
		{length: 1000},
		(_, i) => `line ${i}${i % 100 === 0 ? ' modified' : ''}`,
	).join('\n');

	// This should not hang or throw errors
	const result = formatInlineDiff(oldContent, newContent);
	t.true(result.summary.totalLines > 0);
});

test('should handle content with only whitespace', t => {
	const oldContent = '   \n   \n   ';
	const newContent = '   \n   ';
	const result = formatInlineDiff(oldContent, newContent);

	// Should still process without errors
	t.true(result.summary.totalLines >= 0);
});

test('should handle single line changes with context', t => {
	const oldContent = 'context 1\ncontext 2\nold line\ncontext 3\ncontext 4';
	const newContent = 'context 1\ncontext 2\nnew line\ncontext 3\ncontext 4';
	const result = formatInlineDiff(oldContent, newContent, 1);

	t.true(result.lines.some(l => l.type === 'context'));
	t.true(result.lines.some(l => l.content === 'context 2'));
});

test('should show only changed lines when context is zero', t => {
	const oldContent = Array.from({length: 10}, (_, i) => `line ${i}`).join('\n');
	const newContent = Array.from(
		{length: 10},
		(_, i) => `line ${i}${i === 5 ? ' changed' : ''}`,
	).join('\n');
	const result = formatInlineDiff(oldContent, newContent, 0);

	// Only changed lines should be present
	const contextLines = result.lines.filter(l => l.type === 'context');
	t.is(contextLines.length, 0);
});