import test from 'ava';
import {parseAdditionalDirectoryArgs} from './add-directory-args';
import {parseRunPrompt} from './run-prompt-args';
import {validateCliArgs} from './cli-args';

test('repeatable directory flags support separate and fused values', t => {
	const args = [
		'--add-dir',
		'../lib',
		'--add-dir-ro=../docs',
		'run',
		'fix',
		'--add-dir=/shared',
	];
	t.deepEqual(parseAdditionalDirectoryArgs(args), [
		{path: '../lib', mode: 'read-write'},
		{path: '../docs', mode: 'read-only'},
		{path: '/shared', mode: 'read-write'},
	]);
	t.is(parseRunPrompt(args), 'fix');
	t.is(validateCliArgs(args), undefined);
});
test('missing and empty directory values fail before startup', t => {
	for (const args of [
		['--add-dir'],
		['--add-dir='],
		['--add-dir', 'run', 'fix'],
		['--add-dir-ro', '--model', 'test'],
	]) {
		t.throws(() => parseAdditionalDirectoryArgs(args), {
			message: /requires a directory/,
		});
	}
});
