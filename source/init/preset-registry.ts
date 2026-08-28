import type {PresetDefinition, PresetName} from '@/init/presets';
import type {ProjectAnalysis} from '@/init/project-analyzer';
import {nextjsPreset} from '@/init/templates/preset-nextjs';
import {reactPreset} from '@/init/templates/preset-react';
import {rustPreset} from '@/init/templates/preset-rust';

const presets: Record<PresetName, PresetDefinition> = {
	react: reactPreset,
	nextjs: nextjsPreset,
	rust: rustPreset,
};

export const supportedPresetNames = Object.freeze(
	Object.keys(presets) as PresetName[],
);

export class UnknownPresetError extends Error {
	constructor(name: string) {
		super(
			`Unknown preset "${name}". Supported presets: ${supportedPresetNames.join(', ')}.`,
		);
		this.name = 'UnknownPresetError';
	}
}

export function resolvePreset(name: string): PresetDefinition {
	const preset = presets[name as PresetName];
	if (!preset) throw new UnknownPresetError(name);
	return preset;
}

export function applyPresetToAnalysis(
	analysis: ProjectAnalysis,
	preset: PresetDefinition,
): ProjectAnalysis {
	const existingFrameworkNames = new Set(
		analysis.dependencies.frameworks.map(framework => framework.name),
	);
	const presetFrameworks = preset.frameworks.filter(
		framework => !existingFrameworkNames.has(framework.name),
	);

	const primary = analysis.languages.primary ?? {
		name: preset.primaryLanguage,
		extensions: [],
		percentage: 100,
		files: [],
	};

	return {
		...analysis,
		projectType: preset.projectType,
		languages: {
			...analysis.languages,
			primary,
			all:
				analysis.languages.all.length > 0 ? analysis.languages.all : [primary],
		},
		dependencies: {
			...analysis.dependencies,
			frameworks: [...presetFrameworks, ...analysis.dependencies.frameworks],
		},
		buildCommands: {
			...preset.buildCommands,
			...analysis.buildCommands,
		},
	};
}
