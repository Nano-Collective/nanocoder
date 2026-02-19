import test from 'ava';
import {formatCronHuman, getNextRunTime, validateCron} from './cron';

// ============================================================================
// validateCron Tests
// ============================================================================

test('validateCron returns null for valid cron expressions', t => {
	t.is(validateCron('* * * * *'), null);
	t.is(validateCron('0 9 * * MON'), null);
	t.is(validateCron('30 14 1 * *'), null);
	t.is(validateCron('0 0 * * *'), null);
	t.is(validateCron('*/5 * * * *'), null);
});

test('validateCron returns error string for invalid expressions', t => {
	const result = validateCron('not a cron');
	t.is(typeof result, 'string');
	t.truthy(result);
});

test('validateCron returns error for empty string', t => {
	const result = validateCron('');
	t.is(typeof result, 'string');
	t.truthy(result);
});

test('validateCron returns error for too few fields', t => {
	const result = validateCron('* *');
	t.is(typeof result, 'string');
});

test('validateCron accepts day-of-week names', t => {
	t.is(validateCron('0 9 * * MON'), null);
	t.is(validateCron('0 9 * * MON-FRI'), null);
	t.is(validateCron('0 9 * * MON,WED,FRI'), null);
});

// ============================================================================
// getNextRunTime Tests
// ============================================================================

test('getNextRunTime returns a Date for valid expressions', t => {
	const result = getNextRunTime('* * * * *');
	t.true(result instanceof Date);
});

test('getNextRunTime returns a future date', t => {
	const result = getNextRunTime('* * * * *');
	t.truthy(result);
	t.true(result!.getTime() > Date.now() - 60_000); // Within a minute tolerance
});

test('getNextRunTime returns null for invalid expressions', t => {
	const result = getNextRunTime('invalid');
	t.is(result, null);
});

// ============================================================================
// formatCronHuman Tests
// ============================================================================

test('formatCronHuman formats every minute', t => {
	t.is(formatCronHuman('* * * * *'), 'every minute');
});

test('formatCronHuman formats hourly pattern', t => {
	t.is(formatCronHuman('30 * * * *'), 'every hour at minute 30');
	t.is(formatCronHuman('0 * * * *'), 'every hour at minute 0');
});

test('formatCronHuman formats daily pattern', t => {
	t.is(formatCronHuman('0 9 * * *'), 'daily at 9:00');
	t.is(formatCronHuman('30 14 * * *'), 'daily at 14:30');
	t.is(formatCronHuman('5 0 * * *'), 'daily at 0:05');
});

test('formatCronHuman formats weekly pattern with day names', t => {
	t.is(formatCronHuman('0 9 * * MON'), 'Mon at 9:00');
	t.is(formatCronHuman('0 9 * * 1'), 'Mon at 9:00');
});

test('formatCronHuman formats day-of-week ranges', t => {
	const result = formatCronHuman('0 9 * * 1-5');
	t.is(result, 'Mon-Fri at 9:00');
});

test('formatCronHuman formats day-of-week lists', t => {
	const result = formatCronHuman('0 9 * * 1,3,5');
	t.is(result, 'Mon, Wed, Fri at 9:00');
});

test('formatCronHuman formats monthly pattern', t => {
	t.is(formatCronHuman('0 9 1 * *'), 'monthly on day 1 at 9:00');
	t.is(formatCronHuman('30 18 15 * *'), 'monthly on day 15 at 18:30');
});

test('formatCronHuman returns raw expression for unrecognized patterns', t => {
	// Full specification with month and day-of-week
	t.is(formatCronHuman('0 9 1 6 MON'), '0 9 1 6 MON');
});

test('formatCronHuman returns raw expression for short inputs', t => {
	t.is(formatCronHuman('* *'), '* *');
	t.is(formatCronHuman('foo'), 'foo');
});
