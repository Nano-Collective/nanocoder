import {MAX_CHECKPOINT_FILES} from '@/constants';
import type {CheckpointData} from '@/types/checkpoint';

/**
 * The bullet describeGapsMessage puts in front of each gap, and the indent
 * its detail lines hang under. One owner for the layout: change the bullet
 * and the detail lines follow instead of drifting out of alignment.
 */
const GAP_BULLET = '  • ';
const GAP_DETAIL_INDENT = ' '.repeat(GAP_BULLET.length + 2);

/**
 * A checkpoint can carry the file cap's worth of paths, each with a full
 * error string. Listing every one buries the summary it belongs to, so the
 * tail is counted rather than printed.
 */
const MAX_GAP_DETAIL_LINES = 10;

function formatGapDetail(lines: string[]): string {
	const shown = lines.slice(0, MAX_GAP_DETAIL_LINES);
	const rendered = shown.map(line => `${GAP_DETAIL_INDENT}- ${line}`);
	const remaining = lines.length - shown.length;
	if (remaining > 0) {
		rendered.push(`${GAP_DETAIL_INDENT}- ...and ${remaining} more`);
	}
	return rendered.join('\n');
}

/**
 * Format timestamp to relative time string
 */
export function formatRelativeTime(timestamp: string): string {
	const now = new Date();
	const checkpointTime = new Date(timestamp);
	const diffMs = now.getTime() - checkpointTime.getTime();
	const diffMinutes = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMinutes / 60);
	const diffDays = Math.floor(diffHours / 24);

	if (diffMinutes < 1) {
		return 'Just now';
	} else if (diffMinutes < 60) {
		return `${diffMinutes} min${diffMinutes === 1 ? '' : 's'} ago`;
	} else if (diffHours < 24) {
		return `${diffHours} hr${diffHours === 1 ? '' : 's'} ago`;
	} else if (diffDays < 7) {
		return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
	} else {
		return checkpointTime.toLocaleDateString();
	}
}

/**
 * Validate checkpoint name for invalid characters and length
 */
export function validateCheckpointName(name: string): {
	valid: boolean;
	error?: string;
} {
	if (!name || name.trim().length === 0) {
		return {valid: false, error: 'Checkpoint name cannot be empty'};
	}

	if (name.length > 100) {
		return {
			valid: false,
			error: 'Checkpoint name must be 100 characters or less',
		};
	}

	// Check for invalid characters (filesystem-unsafe characters)
	const invalidChars = /[<>:"/\\|?*]/;
	if (invalidChars.test(name)) {
		return {valid: false, error: 'Checkpoint name contains invalid characters'};
	}

	// Check for reserved names (Windows)
	const reservedNames = [
		'CON',
		'PRN',
		'AUX',
		'NUL',
		'COM1',
		'COM2',
		'COM3',
		'COM4',
		'COM5',
		'COM6',
		'COM7',
		'COM8',
		'COM9',
		'LPT1',
		'LPT2',
		'LPT3',
		'LPT4',
		'LPT5',
		'LPT6',
		'LPT7',
		'LPT8',
		'LPT9',
	];
	if (reservedNames.includes(name.toUpperCase())) {
		return {valid: false, error: 'Checkpoint name is reserved by the system'};
	}

	// Check if name starts or ends with dot or space
	if (
		name.startsWith('.') ||
		name.endsWith('.') ||
		name.startsWith(' ') ||
		name.endsWith(' ')
	) {
		return {
			valid: false,
			error: 'Checkpoint name cannot start or end with a dot or space',
		};
	}

	return {valid: true};
}

/**
 * Describe every way a restore of this checkpoint puts back less than the whole
 * workspace.
 *
 * Three ways, two recorded when the checkpoint was taken and one discovered
 * when it is read back: a file was unreadable at capture, the file cap dropped
 * files before capture began, or a file that was captured could not be read out
 * of the checkpoint again. Returns one line per gap and nothing at all when the
 * restore is complete, so callers are expected to surface every line they get -
 * a partial restore reporting plain success is what this exists to prevent.
 */
export function describeCheckpointGaps(
	checkpoint: Pick<CheckpointData, 'metadata' | 'fileSnapshots'>,
): string[] {
	const {metadata, fileSnapshots} = checkpoint;
	const gaps: string[] = [];
	const skipped = metadata.skippedFiles ?? [];

	if (skipped.length > 0) {
		const detail = formatGapDetail(
			skipped.map(file => `${file.path} (${file.reason})`),
		);
		gaps.push(
			`${skipped.length} file(s) could not be read when this checkpoint was taken, so they were never captured and have NOT been restored:\n${detail}`,
		);
	}

	const truncatedCount = metadata.truncatedFileCount ?? 0;
	if (truncatedCount > 0) {
		gaps.push(
			`${truncatedCount} further modified file(s) exceeded the ${MAX_CHECKPOINT_FILES}-file limit and were never captured, so they have NOT been restored.`,
		);
	}

	// Captured at the time, but gone or unreadable now: the stored copy was
	// deleted, or the whole files/ directory is missing. loadCheckpoint logs and
	// carries on, so without this the restore would report only its lower count.
	const unreadable = metadata.filesChanged.filter(
		file => !fileSnapshots.has(file),
	);
	if (unreadable.length > 0) {
		const detail = formatGapDetail(unreadable);
		gaps.push(
			`${unreadable.length} file(s) recorded in this checkpoint could not be read back out of it and have NOT been restored:\n${detail}`,
		);
	}

	return gaps;
}

/**
 * The warning a restore shows when describeCheckpointGaps returned anything.
 * Shared so every restore path words an incomplete restore the same way.
 */
export function describeGapsMessage(gaps: string[]): string {
	return [
		'This restore did not put back the whole workspace:',
		...gaps.map(gap => `${GAP_BULLET}${gap}`),
	].join('\n');
}
