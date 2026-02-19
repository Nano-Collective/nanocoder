import {readdir, readFile, stat} from 'node:fs/promises';
import {join} from 'node:path';
import type {ToolManager} from '@/tools/tool-manager';
import type {
	Skill,
	SkillMetadata,
	SkillResource,
	SkillSource,
} from '@/types/skill';
import {SkillDiscovery} from './skill-discovery';
import {parseSkillFrontmatter} from './skill-frontmatter';

const SKILL_FILE = 'SKILL.md';
const RESOURCES_DIR = 'resources';
const RELEVANCE_THRESHOLD = 5;

export class SkillManager {
	private discovery: SkillDiscovery;
	private loadedSkills = new Map<string, Skill>();
	private toolManager: ToolManager;

	constructor(toolManager: ToolManager) {
		this.toolManager = toolManager;
		this.discovery = new SkillDiscovery();
	}

	async initialize(): Promise<void> {
		await this.discovery.discoverAll();
	}

	getAvailableSkills(): SkillMetadata[] {
		return this.discovery.getAllCachedMetadata();
	}

	getLoadedSkill(skillId: string): Skill | undefined {
		return this.loadedSkills.get(skillId);
	}

	async loadSkill(skillId: string): Promise<Skill | null> {
		const existing = this.loadedSkills.get(skillId);
		if (existing) return existing;

		const metadata = this.discovery.getCachedMetadata(skillId);
		if (!metadata) {
			return null;
		}

		const pathInfo = this.discovery.getPathForSkill(skillId);
		if (!pathInfo) {
			return null;
		}

		const skill = await this.loadSkillFromPath(
			pathInfo.path,
			pathInfo.source,
			metadata,
			pathInfo.dirName,
		);
		if (skill) {
			this.loadedSkills.set(skillId, skill);
			return skill;
		}
		return null;
	}

	private async loadSkillFromPath(
		skillPath: string,
		source: SkillSource,
		metadata: SkillMetadata,
		dirName: string,
	): Promise<Skill | null> {
		const skillFile = join(skillPath, SKILL_FILE);
		let content: string;
		try {
			content = await readFile(skillFile, 'utf-8');
		} catch {
			return null;
		}

		const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)?$/);
		if (!match) {
			return null;
		}

		const skillId = `${source.type}:${dirName}`;
		const frontmatter = parseSkillFrontmatter(match[1], skillId);
		if (!frontmatter) {
			return null;
		}

		const body = (match[2] ?? '').trim();
		const resources = await this.loadSkillResources(skillPath);

		let mtime: Date;
		try {
			const st = await stat(skillPath);
			mtime = st.mtime;
		} catch {
			mtime = new Date(0);
		}

		return {
			id: skillId,
			name: metadata.name,
			description: metadata.description,
			category: metadata.category,
			version: frontmatter.version ?? '1.0.0',
			author: frontmatter.author,
			metadata,
			content: {
				instructions: body,
				examples: frontmatter.examples,
				references: frontmatter.references,
				dependencies: frontmatter.dependencies,
			},
			allowedTools: metadata.allowedTools,
			resources,
			source,
			location: skillPath,
			lastModified: mtime,
		};
	}

	private async loadSkillResources(
		skillPath: string,
	): Promise<SkillResource[]> {
		const resourcesDir = join(skillPath, RESOURCES_DIR);
		try {
			await stat(resourcesDir);
		} catch {
			return [];
		}

		const entries = await readdir(resourcesDir, {withFileTypes: true});
		const resources: SkillResource[] = [];

		for (const entry of entries) {
			if (!entry.isFile()) continue;
			const resourcePath = join(resourcesDir, entry.name);
			let st: {mode: number};
			try {
				st = await stat(resourcePath);
			} catch {
				continue;
			}
			const ext = entry.name.toLowerCase().slice(entry.name.lastIndexOf('.'));
			let type: SkillResource['type'] = 'document';
			if (['.py', '.js', '.sh', '.bat', '.ts'].includes(ext)) {
				type = 'script';
			} else if (['.txt', '.md'].includes(ext)) {
				type = entry.name.endsWith('.template') ? 'template' : 'document';
			} else if (['.json', '.yaml', '.yml', '.toml'].includes(ext)) {
				type = 'config';
			}

			const executable = Boolean(type === 'script' && st.mode & 0o111);
			resources.push({
				name: entry.name,
				path: resourcePath,
				type,
				executable: executable || undefined,
			});
		}

		return resources;
	}

	async findRelevantSkills(
		request: string,
		availableTools: string[],
	): Promise<string[]> {
		const requestLower = request.toLowerCase();
		const scored: {id: string; score: number}[] = [];

		for (const meta of this.discovery.getAllCachedMetadata()) {
			if (!meta.id) continue;
			const score = this.calculateRelevanceScore(
				meta,
				requestLower,
				availableTools,
			);
			if (score >= RELEVANCE_THRESHOLD) {
				scored.push({id: meta.id, score});
			}
		}

		scored.sort((a, b) => b.score - a.score);
		return scored.map(s => s.id);
	}

	private calculateRelevanceScore(
		meta: SkillMetadata,
		requestLower: string,
		availableTools: string[],
	): number {
		let score = 0;
		if (meta.description.toLowerCase().includes(requestLower)) {
			score += 10;
		}
		if (meta.category.toLowerCase().includes(requestLower)) {
			score += 5;
		}
		if (meta.triggers?.length) {
			for (const trigger of meta.triggers) {
				if (requestLower.includes(trigger.toLowerCase())) {
					score += 15;
				}
			}
		}
		if (meta.tags?.length) {
			for (const tag of meta.tags) {
				if (requestLower.includes(tag.toLowerCase())) {
					score += 3;
				}
			}
		}
		if (meta.allowedTools?.length) {
			const compatible = meta.allowedTools.filter(t =>
				availableTools.includes(t),
			);
			score += compatible.length;
		}
		return score;
	}

	async executeSkillResource(
		skill: Skill,
		resourceName: string,
		args?: Record<string, string>,
	): Promise<string> {
		const resource = skill.resources?.find(r => r.name === resourceName);
		if (!resource) {
			throw new Error(
				`Resource ${resourceName} not found in skill ${skill.name}`,
			);
		}

		if (resource.type === 'script' && resource.executable) {
			return this.executeSkillScript(resource.path, args);
		}
		if (resource.type === 'template') {
			return this.loadSkillTemplate(resource.path, args);
		}
		return readFile(resource.path, 'utf-8');
	}

	private async executeSkillScript(
		scriptPath: string,
		_args?: Record<string, string>,
	): Promise<string> {
		// Placeholder: no arbitrary script execution for security.
		// Callers can read the script content for the model to interpret.
		const content = await readFile(scriptPath, 'utf-8');
		return `[Script: ${scriptPath}]\n\n${content}`;
	}

	private async loadSkillTemplate(
		templatePath: string,
		args?: Record<string, string>,
	): Promise<string> {
		let template = await readFile(templatePath, 'utf-8');
		if (args) {
			for (const [key, value] of Object.entries(args)) {
				template = template.replace(
					new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'),
					String(value),
				);
			}
		}
		return template;
	}
}
