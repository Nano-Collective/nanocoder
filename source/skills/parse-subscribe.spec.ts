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
