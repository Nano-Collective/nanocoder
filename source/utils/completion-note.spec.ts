import test from 'ava';
import {
	buildCompletionNote,
	formatElapsedTime,
	getRandomAdjective,
} from './completion-note';

test('formatElapsedTime returns seconds only when under a minute', t => {
	const now = Date.now();
	const result = formatElapsedTime(now - 30_000);
	t.regex(result, /^\d+s$/);
});

test('formatElapsedTime returns minutes and seconds', t => {
	const now = Date.now();
	const result = formatElapsedTime(now - 90_000);
	t.regex(result, /^\d+m \d+s$/);
});

test('formatElapsedTime handles zero elapsed time', t => {
	const result = formatElapsedTime(Date.now());
	t.is(result, '0s');
});

test('formatElapsedTime handles exact minute boundary', t => {
	const now = Date.now();
	const result = formatElapsedTime(now - 120_000);
	t.is(result, '2m 0s');
});

test('getRandomAdjective returns a non-empty string', t => {
	const adjective = getRandomAdjective();
	t.is(typeof adjective, 'string');
	t.true(adjective.length > 0);
});

test('buildCompletionNote includes a random adjective by default', t => {
	const note = buildCompletionNote(Date.now() - 30_000, false);
	t.regex(note, /^Worked for a [a-z]+ \d+s\.$/);
});

test('buildCompletionNote drops the adjective under professional tone', t => {
	const note = buildCompletionNote(Date.now() - 30_000, true);
	t.regex(note, /^Completed in \d+s\.$/);
});

test('buildCompletionNote keeps minute formatting under professional tone', t => {
	const note = buildCompletionNote(Date.now() - 90_000, true);
	t.regex(note, /^Completed in \d+m \d+s\.$/);
});
