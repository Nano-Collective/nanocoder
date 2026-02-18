import {Cron} from 'croner';

/**
 * Validates a cron expression.
 * Returns null if valid, or an error message if invalid.
 */
export function validateCron(expression: string): string | null {
	try {
		// Attempt to parse — throws on invalid syntax
		new Cron(expression);
		return null;
	} catch (error) {
		return error instanceof Error ? error.message : 'Invalid cron expression';
	}
}

/**
 * Returns the next run time for a cron expression as a Date, or null if none.
 */
export function getNextRunTime(expression: string): Date | null {
	try {
		const job = new Cron(expression);
		return job.nextRun() ?? null;
	} catch {
		return null;
	}
}

/**
 * Formats a cron expression into a human-readable description.
 */
export function formatCronHuman(expression: string): string {
	const parts = expression.trim().split(/\s+/);
	if (parts.length < 5) return expression;

	const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

	// Common patterns
	if (
		minute === '*' &&
		hour === '*' &&
		dayOfMonth === '*' &&
		month === '*' &&
		dayOfWeek === '*'
	) {
		return 'every minute';
	}

	if (
		minute !== '*' &&
		hour === '*' &&
		dayOfMonth === '*' &&
		month === '*' &&
		dayOfWeek === '*'
	) {
		return `every hour at minute ${minute}`;
	}

	if (
		minute !== '*' &&
		hour !== '*' &&
		dayOfMonth === '*' &&
		month === '*' &&
		dayOfWeek === '*'
	) {
		return `daily at ${hour}:${minute?.padStart(2, '0')}`;
	}

	if (
		minute !== '*' &&
		hour !== '*' &&
		dayOfMonth === '*' &&
		month === '*' &&
		dayOfWeek !== '*'
	) {
		const days = formatDayOfWeek(dayOfWeek);
		return `${days} at ${hour}:${minute?.padStart(2, '0')}`;
	}

	if (
		minute !== '*' &&
		hour !== '*' &&
		dayOfMonth !== '*' &&
		month === '*' &&
		dayOfWeek === '*'
	) {
		return `monthly on day ${dayOfMonth} at ${hour}:${minute?.padStart(2, '0')}`;
	}

	return expression;
}

const DAY_NAMES: Record<string, string> = {
	'0': 'Sun',
	'1': 'Mon',
	'2': 'Tue',
	'3': 'Wed',
	'4': 'Thu',
	'5': 'Fri',
	'6': 'Sat',
	'7': 'Sun',
	SUN: 'Sun',
	MON: 'Mon',
	TUE: 'Tue',
	WED: 'Wed',
	THU: 'Thu',
	FRI: 'Fri',
	SAT: 'Sat',
};

function formatDayOfWeek(dow: string): string {
	// Handle ranges like 1-5
	if (dow.includes('-')) {
		const [start, end] = dow.split('-');
		return `${DAY_NAMES[start?.toUpperCase()] ?? start}-${DAY_NAMES[end?.toUpperCase()] ?? end}`;
	}
	// Handle lists like 1,3,5
	if (dow.includes(',')) {
		return dow
			.split(',')
			.map(d => DAY_NAMES[d.toUpperCase()] ?? d)
			.join(', ');
	}
	return DAY_NAMES[dow.toUpperCase()] ?? dow;
}
