import test from 'ava';
import type {CheckpointMetadata} from '@/types/checkpoint';
import {
	describeCheckpointGaps,
	describeGapsMessage,
	formatRelativeTime,
	validateCheckpointName,
} from './checkpoint-utils';

// formatRelativeTime tests
test('formatRelativeTime returns "Just now" for timestamps less than a minute ago', t => {
	const now = new Date().toISOString();
	t.is(formatRelativeTime(now), 'Just now');
});

test('formatRelativeTime returns mins ago for timestamps within the hour', t => {
	const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
	t.is(formatRelativeTime(fiveMinutesAgo), '5 mins ago');
});

test('formatRelativeTime returns singular minute for 1 min ago', t => {
	const oneMinuteAgo = new Date(Date.now() - 1 * 60 * 1000).toISOString();
	t.is(formatRelativeTime(oneMinuteAgo), '1 min ago');
});

test('formatRelativeTime returns hours ago for timestamps within the day', t => {
	const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
	t.is(formatRelativeTime(threeHoursAgo), '3 hrs ago');
});

test('formatRelativeTime returns singular hr for 1 hr ago', t => {
	const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
	t.is(formatRelativeTime(oneHourAgo), '1 hr ago');
});

test('formatRelativeTime returns days ago for timestamps within the week', t => {
	const twoDaysAgo = new Date(
		Date.now() - 2 * 24 * 60 * 60 * 1000,
	).toISOString();
	t.is(formatRelativeTime(twoDaysAgo), '2 days ago');
});

test('formatRelativeTime returns singular day for 1 day ago', t => {
	const oneDayAgo = new Date(
		Date.now() - 1 * 24 * 60 * 60 * 1000,
	).toISOString();
	t.is(formatRelativeTime(oneDayAgo), '1 day ago');
});

test('formatRelativeTime returns locale date string for timestamps older than a week', t => {
	const twoWeeksAgo = new Date(
		Date.now() - 14 * 24 * 60 * 60 * 1000,
	).toISOString();
	const result = formatRelativeTime(twoWeeksAgo);
	// Should be a date string, not a relative time
	t.false(result.includes('ago'));
	t.false(result.includes('Just now'));
});

// validateCheckpointName tests - valid names
test('validateCheckpointName accepts valid simple name', t => {
	const result = validateCheckpointName('my-checkpoint');
	t.true(result.valid);
	t.is(result.error, undefined);
});

test('validateCheckpointName accepts name with numbers', t => {
	const result = validateCheckpointName('checkpoint-v1');
	t.true(result.valid);
});

test('validateCheckpointName accepts name with underscores', t => {
	const result = validateCheckpointName('my_checkpoint_name');
	t.true(result.valid);
});

test('validateCheckpointName accepts name with spaces', t => {
	const result = validateCheckpointName('my checkpoint name');
	t.true(result.valid);
});

// validateCheckpointName tests - empty/whitespace
test('validateCheckpointName rejects empty string', t => {
	const result = validateCheckpointName('');
	t.false(result.valid);
	t.is(result.error, 'Checkpoint name cannot be empty');
});

test('validateCheckpointName rejects whitespace-only string', t => {
	const result = validateCheckpointName('   ');
	t.false(result.valid);
	t.is(result.error, 'Checkpoint name cannot be empty');
});

// validateCheckpointName tests - length
test('validateCheckpointName accepts name at max length (100 chars)', t => {
	const name = 'a'.repeat(100);
	const result = validateCheckpointName(name);
	t.true(result.valid);
});

test('validateCheckpointName rejects name over max length', t => {
	const name = 'a'.repeat(101);
	const result = validateCheckpointName(name);
	t.false(result.valid);
	t.is(result.error, 'Checkpoint name must be 100 characters or less');
});

// validateCheckpointName tests - invalid characters
test('validateCheckpointName rejects name with forward slash', t => {
	const result = validateCheckpointName('my/checkpoint');
	t.false(result.valid);
	t.is(result.error, 'Checkpoint name contains invalid characters');
});

test('validateCheckpointName rejects name with backslash', t => {
	const result = validateCheckpointName('my\\checkpoint');
	t.false(result.valid);
	t.is(result.error, 'Checkpoint name contains invalid characters');
});

test('validateCheckpointName rejects name with colon', t => {
	const result = validateCheckpointName('my:checkpoint');
	t.false(result.valid);
	t.is(result.error, 'Checkpoint name contains invalid characters');
});

test('validateCheckpointName rejects name with asterisk', t => {
	const result = validateCheckpointName('my*checkpoint');
	t.false(result.valid);
	t.is(result.error, 'Checkpoint name contains invalid characters');
});

test('validateCheckpointName rejects name with question mark', t => {
	const result = validateCheckpointName('my?checkpoint');
	t.false(result.valid);
	t.is(result.error, 'Checkpoint name contains invalid characters');
});

test('validateCheckpointName rejects name with quotes', t => {
	const result = validateCheckpointName('my"checkpoint');
	t.false(result.valid);
	t.is(result.error, 'Checkpoint name contains invalid characters');
});

test('validateCheckpointName rejects name with angle brackets', t => {
	const result1 = validateCheckpointName('my<checkpoint');
	const result2 = validateCheckpointName('my>checkpoint');
	t.false(result1.valid);
	t.false(result2.valid);
});

test('validateCheckpointName rejects name with pipe', t => {
	const result = validateCheckpointName('my|checkpoint');
	t.false(result.valid);
	t.is(result.error, 'Checkpoint name contains invalid characters');
});

// validateCheckpointName tests - reserved names (Windows)
test('validateCheckpointName rejects CON (case insensitive)', t => {
	const result1 = validateCheckpointName('CON');
	const result2 = validateCheckpointName('con');
	const result3 = validateCheckpointName('Con');
	t.false(result1.valid);
	t.false(result2.valid);
	t.false(result3.valid);
	t.is(result1.error, 'Checkpoint name is reserved by the system');
});

test('validateCheckpointName rejects PRN', t => {
	const result = validateCheckpointName('PRN');
	t.false(result.valid);
	t.is(result.error, 'Checkpoint name is reserved by the system');
});

test('validateCheckpointName rejects AUX', t => {
	const result = validateCheckpointName('AUX');
	t.false(result.valid);
});

test('validateCheckpointName rejects NUL', t => {
	const result = validateCheckpointName('NUL');
	t.false(result.valid);
});

test('validateCheckpointName rejects COM ports', t => {
	for (let i = 1; i <= 9; i++) {
		const result = validateCheckpointName(`COM${i}`);
		t.false(result.valid, `COM${i} should be rejected`);
	}
});

test('validateCheckpointName rejects LPT ports', t => {
	for (let i = 1; i <= 9; i++) {
		const result = validateCheckpointName(`LPT${i}`);
		t.false(result.valid, `LPT${i} should be rejected`);
	}
});

// validateCheckpointName tests - dot/space at start/end
test('validateCheckpointName rejects name starting with dot', t => {
	const result = validateCheckpointName('.hidden');
	t.false(result.valid);
	t.is(result.error, 'Checkpoint name cannot start or end with a dot or space');
});

test('validateCheckpointName rejects name ending with dot', t => {
	const result = validateCheckpointName('checkpoint.');
	t.false(result.valid);
	t.is(result.error, 'Checkpoint name cannot start or end with a dot or space');
});

test('validateCheckpointName rejects name starting with space', t => {
	const result = validateCheckpointName(' checkpoint');
	t.false(result.valid);
	t.is(result.error, 'Checkpoint name cannot start or end with a dot or space');
});

test('validateCheckpointName rejects name ending with space', t => {
	const result = validateCheckpointName('checkpoint ');
	t.false(result.valid);
	t.is(result.error, 'Checkpoint name cannot start or end with a dot or space');
});

test('validateCheckpointName accepts name with dot in middle', t => {
	const result = validateCheckpointName('checkpoint.v1');
	t.true(result.valid);
});

/** describeCheckpointGaps takes a whole checkpoint; most cases only vary metadata. */
function gapsFor(
	metadata: Partial<CheckpointMetadata>,
	fileSnapshots: Map<string, Buffer> = new Map(),
): string[] {
	return describeCheckpointGaps({
		metadata: {filesChanged: [], ...metadata} as CheckpointMetadata,
		fileSnapshots,
	});
}

// The wording is the whole point of the feature: a restore that says only
// "restored successfully" over an incomplete checkpoint is the bug.
test('describeCheckpointGaps returns nothing for a complete checkpoint', t => {
	t.deepEqual(gapsFor({}), []);
});

test('describeCheckpointGaps names each file that could not be captured', t => {
	const gaps = gapsFor({
		skippedFiles: [{path: 'assets/logo.png', reason: 'EBUSY: resource busy'}],
	});

	t.is(gaps.length, 1);
	t.regex(gaps[0]!, /assets\/logo\.png/);
	t.regex(gaps[0]!, /EBUSY: resource busy/);
	t.regex(gaps[0]!, /NOT been restored/);
});

test('describeCheckpointGaps reports files dropped by the cap', t => {
	const gaps = gapsFor({truncatedFileCount: 7});

	t.is(gaps.length, 1);
	t.regex(gaps[0]!, /7 further modified file/);
	t.regex(gaps[0]!, /NOT been restored/);
});

test('describeCheckpointGaps reports both gaps together', t => {
	const gaps = gapsFor({
		skippedFiles: [{path: 'a.bin', reason: 'EPERM'}],
		truncatedFileCount: 2,
	});

	t.is(gaps.length, 2);
});

test('describeCheckpointGaps reports files it could not read back out', t => {
	// loadCheckpoint logs and carries on when a stored snapshot is gone, so the
	// shortfall is only visible by comparing against filesChanged.
	const gaps = gapsFor(
		{filesChanged: ['kept.txt', 'lost.bin']},
		new Map([['kept.txt', Buffer.from('kept')]]),
	);

	t.is(gaps.length, 1);
	t.regex(gaps[0]!, /lost\.bin/);
	t.regex(gaps[0]!, /could not be read back out/);
	t.notRegex(gaps[0]!, /kept\.txt/);
});

test('describeCheckpointGaps stays quiet when every recorded file loaded', t => {
	const gaps = gapsFor(
		{filesChanged: ['kept.txt']},
		new Map([['kept.txt', Buffer.from('kept')]]),
	);

	t.deepEqual(gaps, []);
});

// With the 50-file cap plus a full error string each, an uncapped list would
// dump the whole capture into the chat and bury the summary it belongs to.
test('describeCheckpointGaps caps a long skipped list and counts the rest', t => {
	const gaps = gapsFor({
		skippedFiles: Array.from({length: 25}, (_, i) => ({
			path: `file-${i}.bin`,
			reason: 'EBUSY: resource busy',
		})),
	});

	t.is(gaps.length, 1);
	t.regex(gaps[0]!, /file-0\.bin/);
	t.regex(gaps[0]!, /file-9\.bin/);
	// The 11th onwards are counted, not listed.
	t.notRegex(gaps[0]!, /file-10\.bin/);
	t.regex(gaps[0]!, /\.\.\.and 15 more/);
	// Still reports the true total in the summary line.
	t.regex(gaps[0]!, /^25 file\(s\)/);
});

test('describeCheckpointGaps caps a long unreadable list too', t => {
	const gaps = gapsFor({
		filesChanged: Array.from({length: 14}, (_, i) => `lost-${i}.txt`),
	});

	t.is(gaps.length, 1);
	t.regex(gaps[0]!, /\.\.\.and 4 more/);
});

// The detail lines hang under the bullet describeGapsMessage adds, so the two
// have to agree; they read from one constant rather than both hard-coding it.
test('describeGapsMessage indents detail lines past its own bullet', t => {
	const gaps = gapsFor({
		skippedFiles: [{path: 'a.bin', reason: 'EBUSY'}],
	});
	const lines = describeGapsMessage(gaps).split('\n');

	const bulleted = lines.find(line => line.includes('could not be read'));
	const detail = lines.find(line => line.includes('a.bin'));

	t.true(bulleted!.startsWith('  • '));
	t.true(detail!.startsWith('      - '));
});
