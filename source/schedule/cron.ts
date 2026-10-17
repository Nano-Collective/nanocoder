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
 *
 * Accepts both the traditional five-field form (minute hour day month weekday)
 * and croner's extended form with a leading seconds field.
 */
export function formatCronHuman(expression: string): string {
	const parts = expression.trim().split(/\s+/);
	if (parts.length < 5 || parts.length > 6) return expression;

	// A leading seconds field shifts every following field by one.
	const offset = parts.length === 6 ? 1 : 0;
	const [minute, hour, dayOfMonth, month, dayOfWeek] = [
		parts[offset],
		parts[offset + 1],
		parts[offset + 2],
		parts[offset + 3],
		parts[offset + 4],
	];

	const dayMatch = isWildcard(dayOfMonth);
	const monthMatch = isWildcard(month);
	const weekdayMatch = isWildcard(dayOfWeek);
	const time = `${hour}:${minute?.padStart(2, '0')}`;

	// Common patterns
	if (
		isWildcard(minute) &&
		isWildcard(hour) &&
		dayMatch &&
		monthMatch &&
		weekdayMatch
	) {
		return 'every minute';
	}

	const minuteStep = stepValue(minute);
	if (
		minuteStep !== null &&
		isWildcard(hour) &&
		dayMatch &&
		monthMatch &&
		weekdayMatch
	) {
		return `every ${minuteStep} minutes`;
	}

	const hourStep = stepValue(hour);
	if (
		minuteStep === null &&
		hourStep !== null &&
		dayMatch &&
		monthMatch &&
		weekdayMatch
	) {
		return minute === '*'
			? `every ${hourStep} hours`
			: `every ${hourStep} hours at minute ${minute}`;
	}

	if (
		!hasStep(minute) &&
		isWildcard(hour) &&
		minute !== '*' &&
		dayMatch &&
		monthMatch &&
		weekdayMatch
	) {
		return `every hour at minute ${minute}`;
	}

	if (
		!hasStep(minute) &&
		!hasStep(hour) &&
		minute !== '*' &&
		hour !== '*' &&
		dayMatch &&
		monthMatch &&
		weekdayMatch
	) {
		return `daily at ${time}`;
	}

	if (
		!hasStep(minute) &&
		!hasStep(hour) &&
		minute !== '*' &&
		hour !== '*' &&
		dayMatch &&
		monthMatch &&
		!weekdayMatch
	) {
		const days = formatDayOfWeek(dayOfWeek);
		return `${days} at ${time}`;
	}

	if (
		!hasStep(minute) &&
		!hasStep(hour) &&
		minute !== '*' &&
		hour !== '*' &&
		!dayMatch &&
		monthMatch &&
		weekdayMatch
	) {
		return `monthly on day ${dayOfMonth} at ${time}`;
	}

	return expression;
}

function isWildcard(field: string | undefined): boolean {
	return field === undefined || field === '*';
}

function hasStep(field: string | undefined): boolean {
	return field !== undefined && field.includes('/');
}

function stepValue(field: string | undefined): number | null {
	if (field === undefined) return null;
	const match = /^\*\/(\d+)$/.exec(field);
	return match ? Number(match[1]) : null;
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
