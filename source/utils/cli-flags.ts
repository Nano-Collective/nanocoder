/**
 * Filter known CLI flags from an argument list, returning only positional
 * arguments. Shared by the `run` prompt extraction in cli.tsx and the
 * `review` CLI arg parsing in review-cli.ts to keep the flag set in one
 * place and prevent regressions like the one caught in review round 2.
 */
export function filterCliFlags(args: string[]): string[] {
	const positionals: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (
			arg === '--vscode' ||
			arg === '--json' ||
			arg === '--trust-directory' ||
			arg === '--plain' ||
			arg === '--no-plain' ||
			arg === '--no-alt-screen' ||
			arg === '--alt-screen'
		) {
			continue;
		} else if (
			arg === '--vscode-port' ||
			arg === '--provider' ||
			arg === '--model' ||
			arg === '--context-max' ||
			arg === '--output-format'
		) {
			i++; // skip this flag and its value
			continue;
		} else if (arg === '--mode') {
			i++; // skip this flag and its value
			continue;
		} else if (arg.startsWith('--mode=')) {
			continue; // skip fused form
		} else if (arg.startsWith('--output-format=')) {
			continue; // skip fused form
		} else {
			positionals.push(arg);
		}
	}
	return positionals;
}
