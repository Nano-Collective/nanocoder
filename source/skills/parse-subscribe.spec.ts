import test from 'ava';
import {
	parseSubscribeBlock,
	SubscribeParseError,
} from './parse-subscribe';

console.log(`\nparse-subscribe.spec.ts`);

test('undefined / null returns undefined', t => {
	t.is(parseSubscribeBlock(undefined), undefined);
	t.is(parseSubscribeBlock(null), undefined);
});

test('non-array throws', t => {
	t.throws(() => parseSubscribeBlock({kind: 'file.changed'}), {
		instanceOf: SubscribeParseError,
		message: /must be a list/,
	});
});

test('parses file.changed with paths and eventKinds', t => {
	const result = parseSubscribeBlock([
		{
			kind: 'file.changed',
			paths: ['docs/**'],
			eventKinds: ['add', 'change'],
		},
	]);
	t.deepEqual(result, [
		{kind: 'file.changed', paths: ['docs/**'], eventKinds: ['add', 'change']},
	]);
});

test('parses schedule.cron with cron expression', t => {
	const result = parseSubscribeBlock([
		{kind: 'schedule.cron', cron: '0 9 * * MON'},
	]);
	t.deepEqual(result, [{kind: 'schedule.cron', cron: '0 9 * * MON'}]);
});

test('parses ci.job.failed with branches', t => {
	const result = parseSubscribeBlock([
		{kind: 'ci.job.failed', branches: ['main', 'release/**']},
	]);
	t.deepEqual(result, [
		{kind: 'ci.job.failed', branches: ['main', 'release/**']},
	]);
});

test('parses ci.job.failed with no branches', t => {
	const result = parseSubscribeBlock([{kind: 'ci.job.failed'}]);
	t.deepEqual(result, [{kind: 'ci.job.failed'}]);
});

test('rejects bad ci.job.failed branches entry', t => {
	t.throws(
		() =>
			parseSubscribeBlock([{kind: 'ci.job.failed', branches: [42]}]),
		{
			instanceOf: SubscribeParseError,
			message: /branches must be an array/,
		},
	);
});

test('carries through target and confirm fields', t => {
	const result = parseSubscribeBlock([
		{
			kind: 'file.changed',
			target: 'agent:docs',
			confirm: true,
			paths: ['docs/**'],
		},
	]);
	t.deepEqual(result, [
		{
			kind: 'file.changed',
			target: 'agent:docs',
			confirm: true,
			paths: ['docs/**'],
		},
	]);
});

test('rejects unknown kinds', t => {
	t.throws(() => parseSubscribeBlock([{kind: 'mysterious'}]), {
		instanceOf: SubscribeParseError,
		message: /is not a supported event kind/,
	});
});

test('rejects missing kind', t => {
	t.throws(() => parseSubscribeBlock([{paths: ['x']}]), {
		instanceOf: SubscribeParseError,
		message: /\.kind must be a string/,
	});
});

test('rejects bad eventKinds entry', t => {
	t.throws(
		() =>
			parseSubscribeBlock([
				{kind: 'file.changed', eventKinds: ['add', 'rename']},
			]),
		{
			instanceOf: SubscribeParseError,
			message: /eventKinds must be an array/,
		},
	);
});

test('rejects schedule.cron without cron', t => {
	t.throws(() => parseSubscribeBlock([{kind: 'schedule.cron'}]), {
		instanceOf: SubscribeParseError,
		message: /\.cron must be a non-empty cron expression/,
	});
});

test('rejects schedule.cron with an invalid cron expression', t => {
	t.throws(
		() => parseSubscribeBlock([{kind: 'schedule.cron', cron: 'not a cron'}]),
		{
			instanceOf: SubscribeParseError,
			message: /is not a valid cron expression/,
		},
	);
});

test('rejects confirm that is not a boolean', t => {
	t.throws(
		() =>
			parseSubscribeBlock([
				{kind: 'file.changed', confirm: 'yes', paths: ['x']},
			]),
		{
			instanceOf: SubscribeParseError,
			message: /\.confirm must be a boolean/,
		},
	);
});

test('rejects target that is not a string', t => {
	t.throws(
		() =>
			parseSubscribeBlock([
				{kind: 'file.changed', target: 42, paths: ['x']},
			]),
		{
			instanceOf: SubscribeParseError,
			message: /\.target must be a non-empty string/,
		},
	);
});

test('parses multiple entries with mixed kinds', t => {
	const result = parseSubscribeBlock([
		{kind: 'file.changed', paths: ['a/**']},
		{kind: 'schedule.cron', cron: '*/5 * * * *'},
	]);
	t.is(result?.length, 2);
	t.is(result?.[0]?.kind, 'file.changed');
	t.is(result?.[1]?.kind, 'schedule.cron');
});

test('error message identifies offending index', t => {
	t.throws(
		() =>
			parseSubscribeBlock([
				{kind: 'file.changed', paths: ['ok/**']},
				{kind: 'unknown'},
			]),
		{
			instanceOf: SubscribeParseError,
			message: /subscribe\[1\]/,
		},
	);
});

test('unknown key on file.changed throws instead of widening the trigger', t => {
	t.throws(
		() => parseSubscribeBlock([{kind: 'file.changed', path: ['docs/**']}]),
		{
			instanceOf: SubscribeParseError,
			message: /unknown key "path".*Did you mean "paths"\?/,
		},
	);
});

test('unknown key on file.ai-comment throws', t => {
	t.throws(
		() => parseSubscribeBlock([{kind: 'file.ai-comment', path: ['src/**']}]),
		{instanceOf: SubscribeParseError, message: /unknown key "path"/},
	);
});

test('unknown key on schedule.cron throws', t => {
	t.throws(
		() =>
			parseSubscribeBlock([
				{kind: 'schedule.cron', cron: '0 9 * * MON', paths: ['x']},
			]),
		{instanceOf: SubscribeParseError, message: /unknown key "paths"/},
	);
});

test('unknown key on ci.job.failed throws', t => {
	t.throws(
		() => parseSubscribeBlock([{kind: 'ci.job.failed', branch: ['main']}]),
		{
			instanceOf: SubscribeParseError,
			message: /unknown key "branch".*Did you mean "branches"\?/,
		},
	);
});

test('unknown key without a close match has no hint', t => {
	const err = t.throws(
		() => parseSubscribeBlock([{kind: 'file.changed', zzzzzz: 1}]),
		{instanceOf: SubscribeParseError},
	);
	t.notRegex(err.message, /Did you mean/);
});
