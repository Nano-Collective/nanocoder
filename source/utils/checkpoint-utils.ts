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
