import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {AgentsTemplateGenerator} from '@/init/agents-template-generator';
import {ExistingRulesExtractor} from '@/init/existing-rules-extractor';
import {applyPresetToAnalysis, resolvePreset} from '@/init/preset-registry';
import {type ProjectAnalysis, ProjectAnalyzer} from '@/init/project-analyzer';

export interface InitializeProjectOptions {
	projectPath: string;
	forceRegenerate?: boolean;
	lean?: boolean;
	preset?: string;
}

export interface InitializeProjectResult {
	created: string[];
	preserved: string[];
	analysis: ProjectAnalysis;
	preset?: string;
}

export class ProjectAlreadyInitializedError extends Error {
	constructor() {
		super(
			'Project already initialized. Found AGENTS.md and .nanocoder/ directory.',
		);
		this.name = 'ProjectAlreadyInitializedError';
	}
}

function resolvePresetPath(projectPath: string, relativePath: string): string {
	const projectRoot = resolve(projectPath);
	const destination = resolve(projectRoot, relativePath);
	const relativeDestination = relative(projectRoot, destination);
	if (relativeDestination.startsWith('..') || isAbsolute(relativeDestination)) {
		throw new Error(`Invalid preset file path: ${relativePath}`);
	}
	return destination;
}

export function initializeProject(
	options: InitializeProjectOptions,
): InitializeProjectResult {
	const {
		projectPath,
		forceRegenerate = false,
		lean = false,
		preset: presetName,
	} = options;
	const preset = presetName ? resolvePreset(presetName) : undefined;
	const created: string[] = [];
	const preserved: string[] = [];
	const agentsPath = join(projectPath, 'AGENTS.md');
	const nanocoderDir = join(projectPath, '.nanocoder');
	const hasAgents = existsSync(agentsPath);
	const hasNanocoder = existsSync(nanocoderDir);

	if (hasAgents && hasNanocoder && !forceRegenerate) {
		throw new ProjectAlreadyInitializedError();
	}

	const detectedAnalysis = new ProjectAnalyzer(projectPath).analyze();
	const analysis = preset
		? applyPresetToAnalysis(detectedAnalysis, preset)
		: detectedAnalysis;
	const existingRules = new ExistingRulesExtractor(
		projectPath,
		forceRegenerate,
		lean ? ['CLAUDE.md'] : [],
	).extractExistingRules();

	if (!hasAgents || forceRegenerate) {
		const agentsContent = AgentsTemplateGenerator.generateAgentsMd(
			analysis,
			existingRules,
		);
		writeFileSync(agentsPath, agentsContent);
		created.push(hasAgents ? 'AGENTS.md (regenerated)' : 'AGENTS.md');

		if (existingRules.length > 0) {
			const sourceFiles = existingRules.map(rule => rule.source).join(', ');
			created.push(`↳ Merged content from: ${sourceFiles}`);
		}
	}

	if (!hasNanocoder) {
		mkdirSync(nanocoderDir, {recursive: true});
		created.push('.nanocoder/');
	}

	for (const file of preset?.files ?? []) {
		const destination = resolvePresetPath(projectPath, file.path);
		if (existsSync(destination)) {
			preserved.push(file.path);
			continue;
		}
		mkdirSync(dirname(destination), {recursive: true});
		writeFileSync(destination, file.content);
		created.push(file.path);
	}

	return {
		created,
		preserved,
		analysis,
		preset: preset?.name,
	};
}
