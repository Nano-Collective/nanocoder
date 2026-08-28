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
	files: PresetFile[];
}
