import test from 'ava';
import {runCompletionCli} from './cli';
import {
	renderBashCompletion,
	renderFishCompletion,
	renderZshCompletion,
} from './render';
import {COMPLETION_FLAGS, COMPLETION_SHELLS, COMPLETION_SUBCOMMANDS} from './spec';

console.log(`\ncli.spec.ts`);

function scriptFor(shell: (typeof COMPLETION_SHELLS)[number]): string {
	const result = runCompletionCli([shell]);
	return result.output;
}

test.serial('completion without a shell argument fails with usage', t => {
	const result = runCompletionCli([]);
	t.is(result.exitCode, 1);
	t.is(result.stream, 'stderr');
	t.true(result.output.includes('shell argument is required'));
	t.true(result.output.includes('Usage: nanocoder completion'));
});

test.serial('completion with an unknown shell fails with usage', t => {
	const result = runCompletionCli(['pwsh']);
	t.is(result.exitCode, 1);
	t.is(result.stream, 'stderr');
	t.true(result.output.includes('unknown shell "pwsh"'));
	t.true(result.output.includes('bash, zsh, fish'));
});

test.serial('completion --help prints usage to stdout', t => {
	const result = runCompletionCli(['--help']);
	t.is(result.exitCode, 0);
	t.is(result.stream, 'stdout');
	t.true(result.output.includes('Usage: nanocoder completion'));
	t.true(result.output.includes('bash    Print the bash completion script'));
});

test.serial('completion prints a bash script registering the completer', t => {
	const result = runCompletionCli(['bash']);
	t.is(result.exitCode, 0);
	t.is(result.stream, 'stdout');
	t.true(result.output.includes('complete -F _nanocoder nanocoder'));
	t.true(result.output.includes('_nanocoder()'));
});

test.serial('completion prints a zsh script with a compdef header', t => {
	const result = runCompletionCli(['zsh']);
	t.is(result.exitCode, 0);
	t.is(result.stream, 'stdout');
	t.true(result.output.startsWith('#compdef nanocoder'));
	t.true(result.output.includes('compdef _nanocoder nanocoder'));
});

test.serial('completion prints a fish script registering the completer', t => {
	const result = runCompletionCli(['fish']);
	t.is(result.exitCode, 0);
	t.is(result.stream, 'stdout');
	t.true(result.output.includes('complete -c nanocoder'));
});

// Boundary-aware matchers: `--mode` must not match a future `--mode-foo`,
// `-c` must not match `--context-max`, `run` must not match `runner`.
function longFlagPattern(
	shell: (typeof COMPLETION_SHELLS)[number],
	name: string,
): RegExp {
	return shell === 'fish'
		? new RegExp(`-l ${name}(?!\\w)`)
		: new RegExp(`--${name}(?![\\w-])`);
}

function shortFlagPattern(
	shell: (typeof COMPLETION_SHELLS)[number],
	short: string,
): RegExp {
	return shell === 'fish'
		? new RegExp(`-s ${short}(?!\\w)`)
		: new RegExp(`-${short}(?!\\w)`);
}

test.serial('every spec flag is offered by every shell script', t => {
	for (const shell of COMPLETION_SHELLS) {
		const script = scriptFor(shell);
		for (const flag of COMPLETION_FLAGS) {
			t.true(
				longFlagPattern(shell, flag.name).test(script),
				`${shell}: missing --${flag.name}`,
			);
			if (flag.short) {
				t.true(
					shortFlagPattern(shell, flag.short).test(script),
					`${shell}: missing short flag -${flag.short}`,
				);
			}
		}
	}
});

test.serial('every spec subcommand and child token is offered by every shell', t => {
	for (const shell of COMPLETION_SHELLS) {
		const script = scriptFor(shell);
		const tokens = COMPLETION_SUBCOMMANDS.flatMap(s => [
			s.name,
			...(s.children ?? []),
		]);
		for (const token of tokens) {
			t.true(
				new RegExp(`\\b${token}\\b`).test(script),
				`${shell}: missing ${token}`,
			);
		}
	}
});

test.serial('enum flag values are completed by every shell', t => {
	for (const shell of COMPLETION_SHELLS) {
		const script = scriptFor(shell);
		const valueLists = COMPLETION_FLAGS.flatMap(f =>
			f.values ? [f.values.join(' ')] : [],
		);
		for (const list of valueLists) {
			// Assert the exact value-set syntax each shell uses for flag
			// arguments, so the assertion cannot be satisfied by the value
			// names appearing in description prose.
			const token =
				shell === 'bash'
					? `"${list}"`
					: shell === 'zsh'
						? `(${list})`
						: `-a '${list}'`;
			t.true(script.includes(token), `${shell}: missing value set ${list}`);
		}
	}
});

test.serial('scripts are rendered standalone for direct use', t => {
	t.true(renderBashCompletion().endsWith('complete -F _nanocoder nanocoder\n'));
	t.true(renderZshCompletion().startsWith('#compdef nanocoder'));
	t.true(renderFishCompletion().includes('complete -c nanocoder -f\n'));
});
