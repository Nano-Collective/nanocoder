import type {ProjectAnalysis} from '@/init/project-analyzer';

export type PresetName = 'react' | 'nextjs' | 'rust';

export interface PresetFile {
	path: string;
	content: string;
}

export interface PresetDefinition {
	name: PresetName;
	description: string;
	projectType: string;
	primaryLanguage: string;
	frameworks: ProjectAnalysis['dependencies']['frameworks'];
	buildCommands: Record<string, string>;
	/** Build-command label to the package.json script required for that command. */
	packageScripts?: Record<string, string>;
	files: PresetFile[];
}
