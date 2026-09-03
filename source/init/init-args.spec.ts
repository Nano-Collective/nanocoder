import test from 'ava';
import {InitArgumentError, parseInitArguments} from '@/init/init-args';

test('parseInitArguments parses --preset for the init command', t => {
	t.deepEqual(parseInitArguments(['--preset', 'react']), {
		forceRegenerate: false,
		lean: false,
		preset: 'react',
	});
});

test('parseInitArguments parses fused --preset syntax and existing flags', t => {
	t.deepEqual(parseInitArguments(['--force', '--lean', '--preset=nextjs']), {
		forceRegenerate: true,
		lean: true,
		preset: 'nextjs',
	});
});

test('parseInitArguments preserves init behavior without --preset', t => {
	t.deepEqual(parseInitArguments([]), {
		forceRegenerate: false,
		lean: false,
		preset: undefined,
	});
});

test('parseInitArguments rejects --preset without a value', t => {
	const error = t.throws(() => parseInitArguments(['--preset']));
	t.true(error instanceof InitArgumentError);
	t.regex(error.message, /Supported presets: react, nextjs, rust/);
});
