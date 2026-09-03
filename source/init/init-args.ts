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
		}
	}

	return {
		forceRegenerate: args.includes('--force') || args.includes('-f'),
		lean: args.includes('--lean'),
		preset,
	};
}
