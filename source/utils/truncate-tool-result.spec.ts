import test from 'ava';
import {truncateToolResult} from './truncate-tool-result.js';

test('leaves results at or below the cap unchanged', t => {
	const content = 'short result';

	t.is(truncateToolResult(content, content.length), content);
	t.is(truncateToolResult(content, content.length + 1), content);
});

test('keeps both ends of an oversized result within the cap', t => {
	const maxLength = 240;
	const content = `HEAD\n${'middle\n'.repeat(200)}TAIL`;

	const result = truncateToolResult(content, maxLength);

	t.is(result.length, maxLength);
	t.true(result.startsWith('HEAD\n'));
	t.true(result.endsWith('TAIL'));
	t.regex(
		result,
		/Output truncated: \d+ characters total; request a narrower result/,
	);
});

test('uses an empty result for a non-positive cap', t => {
	t.is(truncateToolResult('content', 0), '');
	t.is(truncateToolResult('content', -1), '');
});
