import * as path from 'node:path';
import test from 'ava';
import {parseRunnerArgs} from './args';

const defaults = {cliPath: 'dist/cli.js', outPath: 'results.json'};

test('runner args expose help without requiring a CLI or model run', t => {
	t.deepEqual(parseRunnerArgs(['--help'], defaults), {help: true});
	t.deepEqual(parseRunnerArgs(['-h'], defaults), {help: true});
	t.deepEqual(parseRunnerArgs(['--', '--help'], defaults), {help: true});
});

test('runner args reject unknown options instead of silently ignoring them', t => {
	t.throws(() => parseRunnerArgs(['--modle', 'test-model'], defaults), {
		message: /unknown option.*modle/i,
	});
});

test('runner args require positive integer run counts', t => {
	for (const runs of ['0', '-1', '1.5', 'many']) {
		t.throws(() => parseRunnerArgs([`--runs=${runs}`], defaults), {
			message: /positive integer/,
		});
	}
});

test('runner args parse options and resolve output paths', t => {
	const parsed = parseRunnerArgs(
		[
			'--cli', './build/cli.js',
			'--runs', '2',
			'--model', 'test-model',
			'--provider', 'test-provider',
			'--fixture', 'smoke',
			'--out', './tmp/results.json',
		],
		defaults,
	);

	t.false(parsed.help);
	if (parsed.help) return;
	t.is(parsed.options.runs, 2);
	t.is(parsed.options.cliPath, path.resolve('./build/cli.js'));
	t.is(parsed.options.outPath, path.resolve('./tmp/results.json'));
	t.is(parsed.options.model, 'test-model');
	t.is(parsed.options.provider, 'test-provider');
	t.is(parsed.options.fixture, 'smoke');
});
