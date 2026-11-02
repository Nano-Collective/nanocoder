import {supportedPresetNames} from '@/init/preset-registry';

export interface ParsedInitArguments {
	forceRegenerate: boolean;
	lean: boolean;
	preset?: string;
}

export class InitArgumentError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'InitArgumentError';
	}
}

/** Flags `nanocoder init` accepts besides `--preset`. */
const KNOWN_INIT_FLAGS: readonly string[] = [
	'--force',
	'-f',
	'--lean',
	'--help',
	'-h',
];

export function parseInitArguments(
	args: readonly string[],
): ParsedInitArguments {
	let preset: string | undefined;

	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		if (argument === '--preset') {
			const value = args[index + 1];
			if (!value || value.startsWith('-')) {
				throw new InitArgumentError(
					`Missing value for --preset. Supported presets: ${supportedPresetNames.join(', ')}.`,
				);
			}
			preset = value;
			index++;
		} else if (argument.startsWith('--preset=')) {
			const value = argument.slice('--preset='.length);
			if (!value) {
				throw new InitArgumentError(
					`Missing value for --preset. Supported presets: ${supportedPresetNames.join(', ')}.`,
				);
			}
			preset = value;
		} else if (
			argument.startsWith('-') &&
			!KNOWN_INIT_FLAGS.includes(argument)
		) {
			throw new InitArgumentError(
				`Unknown option "${argument}". Run "nanocoder init --help" to see available options.`,
			);
		}
	}

	return {
		forceRegenerate: args.includes('--force') || args.includes('-f'),
		lean: args.includes('--lean'),
		preset,
	};
}
