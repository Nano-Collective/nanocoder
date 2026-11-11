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

	// A leading seconds field shifts every following field by one. Only a zero
	// seconds field is safe to describe with the five-field sentences; any
	// other seconds value would be silently dropped, so return the input.
	const offset = parts.length === 6 ? 1 : 0;
	if (offset === 1 && parts[0] !== '0') return expression;
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
	// null when the minute or hour is a range or step, which a clock time
	// cannot express; those fall back to the raw expression.
	const time = formatTimes(minute, hour);

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
		return minuteStep === 1 ? 'every minute' : `every ${minuteStep} minutes`;
	}

	// A wildcard minute with a stepped hour fires every minute of the selected
	// hours, which the hourly sentence would mislabel, so leave it to the
	// raw-expression fallback below.
	const hourStep = stepValue(hour);
	if (
		minuteStep === null &&
		!isWildcard(minute) &&
		hourStep !== null &&
		dayMatch &&
		monthMatch &&
		weekdayMatch
	) {
		return `every ${hourStep} hours at minute ${minute}`;
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
		time !== null &&
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
		time !== null &&
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
		time !== null &&
		!dayMatch &&
		monthMatch &&
		weekdayMatch
	) {
		return `monthly on day ${dayOfMonth} at ${time}`;
	}

	return expression;
}

// Most clock times worth spelling out; `0,15,30,45 9,17` is already eight.
const MAX_LISTED_TIMES = 4;

/**
 * Clock times for a minute and hour field that are single numbers or comma
 * lists of numbers (`0,30` and `9` give "9:00, 9:30"). Returns null for
 * ranges, steps, or too many combinations to read as a sentence.
 */
function formatTimes(
	minute: string | undefined,
	hour: string | undefined,
): string | null {
	const minutes = numberList(minute);
	const hours = numberList(hour);
	if (!minutes || !hours) return null;
	if (minutes.length * hours.length > MAX_LISTED_TIMES) return null;
	return hours
		.flatMap(h => minutes.map(m => `${h}:${m.padStart(2, '0')}`))
		.join(', ');
}

function numberList(field: string | undefined): string[] | null {
	if (field === undefined || !/^\d+(,\d+)*$/.test(field)) return null;
	return field.split(',');
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
