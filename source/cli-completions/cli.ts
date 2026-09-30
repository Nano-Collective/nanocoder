/**
 * CLI surface for `nanocoder completion <shell>`. Prints a self-contained
 * completion script for the requested shell so it can be eval'd, piped into
 * a file, or dropped into an fpath/completion directory.
 *
 * This module is loaded via a dynamic import from the fast path in
 * `cli.tsx`, so it must stay free of heavy app imports (Ink, providers,
 * tools). It only ever pulls in the static spec and string renderers.
 */

import {
	renderBashCompletion,
	renderFishCompletion,
	renderZshCompletion,
} from './render';
import {COMPLETION_SHELLS, type CompletionShell} from './spec';

export interface CompletionCliResult {
	exitCode: 0 | 1;
	output: string;
	stream: 'stdout' | 'stderr';
}

const USAGE = `Usage: nanocoder completion <shell>

Generate a shell completion script for nanocoder and print it to stdout.
The shell argument is required.

Shells:
  bash    Print the bash completion script
  zsh     Print the zsh completion script
  fish    Print the fish completion script

Examples:
  nanocoder completion bash >> ~/.bashrc
  nanocoder completion fish > ~/.config/fish/completions/nanocoder.fish
  eval "$(nanocoder completion zsh)"`;

function renderCompletionScript(shell: CompletionShell): string {
	switch (shell) {
		case 'bash':
			return renderBashCompletion();
		case 'zsh':
			return renderZshCompletion();
		case 'fish':
			return renderFishCompletion();
	}
}

export function runCompletionCli(args: readonly string[]): CompletionCliResult {
	if (args.includes('--help') || args.includes('-h')) {
		return {exitCode: 0, output: USAGE, stream: 'stdout'};
	}

	const shell = args[0];
	if (!shell) {
		return {
			exitCode: 1,
			output: `Error: a shell argument is required.\n\n${USAGE}`,
			stream: 'stderr',
		};
	}

	if (!(COMPLETION_SHELLS as readonly string[]).includes(shell)) {
		return {
			exitCode: 1,
			output: `Error: unknown shell "${shell}". Must be one of: ${COMPLETION_SHELLS.join(', ')}.\n\n${USAGE}`,
			stream: 'stderr',
		};
	}

	return {
		exitCode: 0,
		output: renderCompletionScript(shell as CompletionShell),
		stream: 'stdout',
	};
}
