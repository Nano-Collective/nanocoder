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

test.serial('every spec flag is offered by every shell script', t => {
	for (const shell of COMPLETION_SHELLS) {
		const script = scriptFor(shell);
		const longToken = shell === 'fish' ? (name: string) => `-l ${name}` : (name: string) => `--${name}`;
		for (const flag of COMPLETION_FLAGS) {
			t.true(
				script.includes(longToken(flag.name)),
				`${shell}: missing --${flag.name}`,
			);
			if (flag.short) {
				const token = shell === 'fish' ? `-s ${flag.short}` : `-${flag.short}`;
				t.true(
					script.includes(token),
					`${shell}: missing short flag ${token}`,
				);
			}
		}
	}
});

test.serial('every spec subcommand and child token is offered by every shell', t => {
	for (const shell of COMPLETION_SHELLS) {
		const script = scriptFor(shell);
		for (const subcommand of COMPLETION_SUBCOMMANDS) {
			t.true(
				script.includes(subcommand.name),
				`${shell}: missing subcommand ${subcommand.name}`,
			);
			for (const child of subcommand.children ?? []) {
				t.true(
					script.includes(child),
					`${shell}: missing ${subcommand.name} child ${child}`,
				);
			}
		}
	}
});

test.serial('enum flag values are completed by every shell', t => {
	const modeValues = ['normal', 'auto-accept', 'yolo', 'plan'];
	const formatValues = ['text', 'json'];
	for (const shell of COMPLETION_SHELLS) {
		const script = scriptFor(shell);
		for (const value of [...modeValues, ...formatValues]) {
			t.true(script.includes(value), `${shell}: missing value ${value}`);
		}
	}
});

test.serial('scripts are rendered standalone for direct use', t => {
	t.true(renderBashCompletion().endsWith('complete -F _nanocoder nanocoder\n'));
	t.true(renderZshCompletion().startsWith('#compdef nanocoder'));
	t.true(renderFishCompletion().includes('complete -c nanocoder -f\n'));
});
