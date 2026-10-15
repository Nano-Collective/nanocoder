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
	const normalizedName = name.trim().toLowerCase();
	if (!Object.hasOwn(presets, normalizedName)) {
		throw new UnknownPresetError(name);
	}
	return presets[normalizedName as PresetName];
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
	const detectedPackageScripts = analysis.dependencies.buildInfo.scripts ?? {};
	const presetBuildCommands = Object.fromEntries(
		Object.entries(preset.buildCommands).filter(([action]) => {
			const packageScript = preset.packageScripts?.[action];
			return (
				packageScript === undefined ||
				Object.hasOwn(detectedPackageScripts, packageScript)
			);
		}),
	);

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
			...presetBuildCommands,
			...analysis.buildCommands,
		},
	};
}
