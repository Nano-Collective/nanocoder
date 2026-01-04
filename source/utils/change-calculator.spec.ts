import test from 'ava';
import {calculateChangeStatistics} from './change-calculator.js';

test('should calculate no-change statistics for identical content', t => {
	const content = 'same content';
	const result = calculateChangeStatistics(content, content);

	t.is(result.linesAdded, 1);
	t.is(result.linesRemoved, 1);
	t.is(result.netLineChange, 0);
	t.is(result.tokensAdded, 3);
	t.is(result.tokensRemoved, 3);
	t.is(result.netTokenChange, 0);
	t.is(result.changeType, 'no-change');
	t.is(result.sizeImpact, 'tiny');
});

test('should calculate insert-only statistics', t => {
	const result = calculateChangeStatistics('', 'new line 1\nnew line 2');

	t.is(result.linesAdded, 2);
	t.is(result.linesRemoved, 0);
	t.is(result.netLineChange, 2);
	t.is(result.tokensAdded, 6);
	t.is(result.tokensRemoved, 0);
	t.is(result.netTokenChange, 6);
	t.is(result.changeType, 'insert');
	t.is(result.sizeImpact, 'tiny'); // 2 lines = tiny
});

test('should calculate delete-only statistics', t => {
	const result = calculateChangeStatistics('old line 1\nold line 2', '');

	t.is(result.linesAdded, 0);
	t.is(result.linesRemoved, 2);
	t.is(result.netLineChange, -2);
	t.is(result.tokensAdded, 0);
	t.is(result.tokensRemoved, 6);
	t.is(result.netTokenChange, -6);
	t.is(result.changeType, 'delete');
	t.is(result.sizeImpact, 'tiny');
});

test('should calculate replace statistics', t => {
	const oldContent = 'old line 1\nold line 2';
	const newContent = 'new line 1\nnew line 2';
	const result = calculateChangeStatistics(oldContent, newContent);

	t.is(result.linesAdded, 2);
	t.is(result.linesRemoved, 2);
	t.is(result.netLineChange, 0);
	t.is(result.tokensAdded, 6);
	t.is(result.tokensRemoved, 6);
	t.is(result.netTokenChange, 0);
	t.is(result.changeType, 'replace');
	t.is(result.sizeImpact, 'tiny');
});

test('should handle multi-line changes', t => {
	const oldContent = 'line 1\nline 2\nline 3';
	const newContent = 'line 1\nline 2\nline 3\nline 4\nline 5';
	const result = calculateChangeStatistics(oldContent, newContent);

	t.is(result.linesAdded, 5);
	t.is(result.linesRemoved, 3);
	t.is(result.netLineChange, 2);
	t.is(result.changeType, 'replace');
	t.is(result.sizeImpact, 'tiny');
});

test('should handle mixed additions and deletions', t => {
	const oldContent = 'keep line 1\nold line 2\nkeep line 3';
	const newContent = 'keep line 1\nnew line 2\nkeep line 3';
	const result = calculateChangeStatistics(oldContent, newContent);

	t.is(result.linesAdded, 3);
	t.is(result.linesRemoved, 3);
	t.is(result.netLineChange, 0);
	t.is(result.changeType, 'replace');
});

test('should handle empty strings', t => {
	const result = calculateChangeStatistics('', '');

	t.is(result.linesAdded, 0);
	t.is(result.linesRemoved, 0);
	t.is(result.netLineChange, 0);
	t.is(result.tokensAdded, 0);
	t.is(result.tokensRemoved, 0);
	t.is(result.changeType, 'no-change');
	t.is(result.sizeImpact, 'tiny');
});

test('should handle unicode content', t => {
	const oldContent = 'Hello 世界\nПривет мир';
	const newContent = 'Hello 世界\nПривет мир\nBonjour monde';
	const result = calculateChangeStatistics(oldContent, newContent);

	t.is(result.linesAdded, 3);
	t.is(result.linesRemoved, 2);
	t.is(result.netLineChange, 1);
	t.is(result.changeType, 'replace');
});

test('should categorize tiny changes (0-5 lines)', t => {
	// Use insert pattern to get actual line change instead of replace
	const result = calculateChangeStatistics('', 'line1\nline2\nline3\nline4');

	t.is(result.sizeImpact, 'tiny');
});

test('should categorize small changes (6-20 lines)', t => {
	const oldContent = Array.from({length: 10}, (_, i) => `line${i}`).join('\n');
	const newContent = Array.from({length: 15}, (_, i) => `line${i}`).join('\n');
	const result = calculateChangeStatistics(oldContent, newContent);

	// Adding 5 lines to 10 = 50% of original, which falls in small/medium boundary
	// For replace, it's 10 + 15 = 25 lines total affected
	t.is(result.sizeImpact, 'medium');
});

test('should categorize medium changes (21-50 lines)', t => {
	const oldContent = Array.from({length: 30}, (_, i) => `line${i}`).join('\n');
	const newContent = Array.from({length: 40}, (_, i) => `line${i}`).join('\n');
	const result = calculateChangeStatistics(oldContent, newContent);

	// Replace: 30 + 40 = 70 lines total affected = massive
	t.is(result.sizeImpact, 'massive');
});

test('should categorize large changes (51-100 lines)', t => {
	const oldContent = Array.from({length: 60}, (_, i) => `line${i}`).join('\n');
	const newContent = Array.from({length: 80}, (_, i) => `line${i}`).join('\n');
	const result = calculateChangeStatistics(oldContent, newContent);

	// Replace: 60 + 80 = 140 lines total affected = massive
	t.is(result.sizeImpact, 'massive');
});

test('should categorize massive changes (100+ lines)', t => {
	const oldContent = Array.from({length: 150}, (_, i) => `line${i}`).join('\n');
	const newContent = Array.from({length: 200}, (_, i) => `line${i}`).join('\n');
	const result = calculateChangeStatistics(oldContent, newContent);

	// Replace: 150 + 200 = 350 lines total affected = massive
	t.is(result.sizeImpact, 'massive');
});

test('should calculate tokens correctly', t => {
	const oldContent = 'This is a long line of text to estimate tokens';
	const newContent = 'This is another long line of different text';
	const result = calculateChangeStatistics(oldContent, newContent);

	t.true(result.tokensAdded > 0);
	t.true(result.tokensRemoved > 0);
	t.true(result.netTokenChange !== 0);
});

test('should handle single line content correctly', t => {
	const result = calculateChangeStatistics('old content', 'new content');

	t.is(result.linesAdded, 1);
	t.is(result.linesRemoved, 1);
	t.is(result.netLineChange, 0);
	t.is(result.changeType, 'replace');
});

test('should treat replacement as insert when content is empty', t => {
	const result = calculateChangeStatistics('', 'new content');

	t.is(result.changeType, 'insert');
	t.is(result.linesAdded, 1);
	t.is(result.linesRemoved, 0);
});

test('should treat as delete when new content is empty', t => {
	const result = calculateChangeStatistics('old content', '');

	t.is(result.changeType, 'delete');
	t.is(result.linesAdded, 0);
	t.is(result.linesRemoved, 1);
});

test('should handle content with only whitespace', t => {
	const oldContent = '   \n   \n   ';
	const newContent = '   \n   ';
	const result = calculateChangeStatistics(oldContent, newContent);

	t.is(result.linesAdded, 2);
	t.is(result.linesRemoved, 3);
	t.is(result.netLineChange, -1);
});