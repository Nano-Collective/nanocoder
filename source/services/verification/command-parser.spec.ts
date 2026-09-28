import test from 'ava';
import {
	findShellMetacharacter,
	parseVerificationCommand,
} from './command-parser.js';

console.log('\nservices/verification/command-parser.spec.ts');

// ============================================================================
// Array form
// ============================================================================

test('array form passes every element through verbatim', t => {
	const result = parseVerificationCommand(['npm', 'run', 'test:ci']);
	t.true(result.ok);
	if (!result.ok) return;
	t.is(result.value.command, 'npm');
	t.deepEqual(result.value.args, ['run', 'test:ci']);
	t.is(result.value.display, 'npm run test:ci');
});

test('array form preserves empty and whitespace-bearing arguments', t => {
	const result = parseVerificationCommand(['go', 'test', '', './a b/']);
	t.true(result.ok);
	if (!result.ok) return;
	t.deepEqual(result.value.args, ['test', '', './a b/']);
});

test('array form rejects an empty array', t => {
	const result = parseVerificationCommand([]);
	t.false(result.ok);
	t.regex(result.ok ? '' : result.error, /empty/i);
});

test('array form rejects a blank program name', t => {
	const result = parseVerificationCommand(['   ', 'test']);
	t.false(result.ok);
	t.regex(result.ok ? '' : result.error, /program name/i);
});

test('array form rejects non-string elements', t => {
	const result = parseVerificationCommand([
		'npm',
		42 as unknown as string,
	]);
	t.false(result.ok);
	t.regex(result.ok ? '' : result.error, /only strings/i);
});

// ============================================================================
// String form: tokenising
// ============================================================================

function tokens(input: string): string[] | undefined {
	const result = parseVerificationCommand(input);
	if (!result.ok) return undefined;
	return [result.value.command, ...result.value.args];
}

test('string form splits on runs of whitespace', t => {
	t.deepEqual(tokens('npm    run\t\ttest'), ['npm', 'run', 'test']);
});

test('string form honours single quotes as fully literal', t => {
	t.deepEqual(tokens(`npm test --grep "it's fine"`), [
		'npm',
		'test',
		'--grep',
		"it's fine",
	]);
});

test('string form honours double quotes and their escapes', t => {
	t.deepEqual(tokens('echo "back\\\\slash"'), ['echo', 'back\\slash']);
});

test('string form rejects an escaped double quote rather than deferring it', t => {
	// The escape could only ever yield a token that the metacharacter screen
	// rejects, so it is refused during tokenisation with a message that names
	// the mistake. Tested at the public boundary: the exact wording is not the
	// contract, but the rejection is.
	const result = parseVerificationCommand('echo "a \\"b\\" c"');
	t.false(result.ok);
	t.regex(result.ok ? '' : result.error, /tokenise/);
});

test('string form leaves a backslash before an ordinary character alone', t => {
	t.deepEqual(tokens('grep a\\d b'), ['grep', 'a\\d', 'b']);
});

test('string form keeps a quoted empty string as an empty argument', t => {
	t.deepEqual(tokens(`cmd '' tail`), ['cmd', '', 'tail']);
});

test('string form rejects an unterminated single quote', t => {
	const result = parseVerificationCommand(`npm test --grep 'oops`);
	t.false(result.ok);
	t.regex(result.ok ? '' : result.error, /tokenise/);
});

test('string form rejects an unterminated double quote', t => {
	const result = parseVerificationCommand('npm test --grep "oops');
	t.false(result.ok);
	t.regex(result.ok ? '' : result.error, /tokenise/);
});

// ============================================================================
// String form: metacharacter screening
// ============================================================================

const CHAINING = [
	'npm test && rm -rf build',
	'npm test; rm -rf build',
	'npm test | tee log',
	'npm test > out.txt',
	'npm test < in.txt',
	'npm test & background',
	'echo `whoami`',
	'echo $HOME',
	'echo `id`',
	'npm test\nrm -rf /',
	'npm test\rrm -rf /',
	'echo (subshell)',
	'echo ${HOME}',
	'echo %CD%',
	'echo !VAR',
	'echo ^&',
	'ls *.ts',
	'cat file?.txt',
	'echo ~root',
];

for (const input of CHAINING) {
	test(`string form rejects shell intent: ${JSON.stringify(input)}`, t => {
		const result = parseVerificationCommand(input);
		t.false(result.ok, `${input} must be rejected`);
		if (result.ok) return;
		t.regex(result.error, /must not contain/);
		// The error must point at the escape hatch, or the user is stuck.
		t.regex(result.error, /array form|supported on every platform/);
	});
}

test('metacharacters inside quotes are still rejected', t => {
	// Quoting is a tokenising concern only. The token still reaches argv, and
	// argv is what cmd.exe interprets, so quoting must not launder it.
	const result = parseVerificationCommand(`pytest -k "test(a)"`);
	t.false(result.ok);
	t.regex(result.ok ? '' : result.error, /must not contain "\("/);
});

test('a double quote in the array form is left to the runtime screen', t => {
	// The array form is deliberately unscreened at parse time — it is the
	// recommended form and POSIX needs no screen. On Windows the argv elements
	// are wrapped in double quotes for cmd.exe, so a literal quote has to be
	// refused there, at the point where it would matter. See
	// `resolveSpawnPlan` in runner.ts.
	const result = parseVerificationCommand(['pytest', '--tb=short', 'a"b']);
	t.true(result.ok);
});

test('a double quote in the string form is a metacharacter', t => {
	// Reachable in the string form only via a token that keeps its quote, e.g.
	// a value spliced in by another layer before parsing.
	const result = parseVerificationCommand('pytest --tb "short');
	t.false(result.ok);
});

test('string form allows the punctuation real test commands use', t => {
	t.deepEqual(tokens('cargo test --lib -- --nocapture'), [
		'cargo',
		'test',
		'--lib',
		'--',
		'--nocapture',
	]);
	t.deepEqual(tokens('./gradlew :app:testDebugUnitTest --max-workers=4'), [
		'./gradlew',
		':app:testDebugUnitTest',
		'--max-workers=4',
	]);
	t.deepEqual(tokens('go test ./... -run Test_Foo-1'), [
		'go',
		'test',
		'./...',
		'-run',
		'Test_Foo-1',
	]);
	t.deepEqual(tokens('pytest -m "not slow" -x'), [
		'pytest',
		'-m',
		'not slow',
		'-x',
	]);
});

// ============================================================================
// Empty / missing input
// ============================================================================

test('missing command is rejected', t => {
	const result = parseVerificationCommand(undefined);
	t.false(result.ok);
	t.regex(result.ok ? '' : result.error, /No verification command/);
});

test('blank string command is rejected', t => {
	for (const input of ['', '   ', '\t\n']) {
		const result = parseVerificationCommand(input);
		t.false(result.ok, `${JSON.stringify(input)} must be rejected`);
	}
});

test('non-string non-array command is rejected', t => {
	const result = parseVerificationCommand(
		42 as unknown as string,
	);
	t.false(result.ok);
	t.regex(result.ok ? '' : result.error, /string or an array/);
});

// ============================================================================
// findShellMetacharacter — the runner's second gate
// ============================================================================

test('findShellMetacharacter screens the array form too', t => {
	// The parser deliberately does NOT screen array elements, because the
	// array form is how a user opts out of interpretation. The runner is
	// therefore the last line of defence before argv reaches cmd.exe, and
	// this is the function it calls.
	t.is(findShellMetacharacter(['npm', 'test', '&&', 'del']), '&');
	t.is(findShellMetacharacter(['npm', 'run', 'test;calc']), ';');
});

test('findShellMetacharacter passes a clean argv', t => {
	t.is(findShellMetacharacter(['npm', 'run', 'test:ci', '--reporter=dot']), null);
	t.is(findShellMetacharacter([]), null);
});

test('findShellMetacharacter returns null for every command the parser accepts', t => {
	// Property check: anything parseVerificationCommand lets through must be
	// safe to hand to a shell. If this ever fails, the two gates have drifted
	// and the Windows path has an injection hole.
	const accepted = [
		['npm', 'run', 'test:ci'],
		['./gradlew', ':app:test'],
		['go', 'test', './...'],
		['cargo', 'test', '--lib'],
	];
	for (const argv of accepted) {
		t.is(findShellMetacharacter(argv), null, argv.join(' '));
	}
});
