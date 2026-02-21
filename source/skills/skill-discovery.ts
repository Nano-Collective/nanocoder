import {readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {existsSync} from 'fs';
import {getConfigPath} from '@/config/paths';
import type {SkillMetadata, SkillSource} from '@/types/skill';
import {getLogger} from '@/utils/logging';
import {
	parseSkillFrontmatter,
	type SkillFrontmatter,
} from './skill-frontmatter';

const SKILL_FILE = 'SKILL.md';

export interface SkillPathInfo {
	source: SkillSource;
	dirName: string;
	path: string;
}

export class SkillDiscovery {
	private sources = new Map<string, SkillSource>();
	private metadataCache = new Map<string, SkillFrontmatter>();
	private pathCache = new Map<string, SkillPathInfo>();

	constructor() {
		this.initializeDefaultSources();
	}

	private initializeDefaultSources(): void {
		this.addSource({
			type: 'personal',
			location: join(getConfigPath(), 'skills'),
			priority: 1,
			enabled: true,
		});
		this.addSource({
			type: 'project',
			location: join(process.cwd(), '.nanocoder', 'skills'),
			priority: 2,
			enabled: true,
		});
	}

	addSource(source: SkillSource): void {
		const key = `${source.type}:${source.location}`;
		this.sources.set(key, source);
	}

	getSources(): SkillSource[] {
		return Array.from(this.sources.values()).sort(
			(a, b) => a.priority - b.priority,
		);
	}

	async discoverAll(): Promise<SkillMetadata[]> {
		const allMetadata: SkillMetadata[] = [];
		this.metadataCache.clear();
		this.pathCache.clear();

		for (const [sourceId, source] of this.sources) {
			if (!source.enabled) continue;
			try {
				const metadata = await this.discoverInSource(sourceId, source);
				for (const m of metadata) {
					if (m.id) {
						this.metadataCache.set(m.id, m);
						allMetadata.push(m);
					}
				}
			} catch (error) {
				const logger = getLogger();
				logger.warn(`Failed to discover skills in ${sourceId}:`, error);
			}
		}

		return allMetadata;
	}

	private async discoverInSource(
		sourceId: string,
		source: SkillSource,
	): Promise<SkillMetadata[]> {
		const skillsPath = source.location;
		if (!existsSync(skillsPath)) {
			return [];
		}

		const entries = await readdir(skillsPath, {withFileTypes: true});
		const skillDirs = entries.filter(e => e.isDirectory());
		const metadata: SkillMetadata[] = [];

		for (const skillDir of skillDirs) {
			const skillPath = join(skillsPath, skillDir.name);
			const skillId = `${source.type}:${skillDir.name}`;
			const meta = await this.loadSkillMetadata(skillPath, skillId);
			if (meta) {
				metadata.push(meta);
				this.pathCache.set(skillId, {
					source,
					dirName: skillDir.name,
					path: skillPath,
				});
			}
		}

		return metadata;
	}

	async loadSkillMetadata(
		skillPath: string,
		skillId: string,
	): Promise<SkillMetadata | null> {
		const skillFile = join(skillPath, SKILL_FILE);
		if (!existsSync(skillFile)) {
			return null;
		}

		try {
			const content = await readFile(skillFile, 'utf-8');
			const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
			if (!match?.[1]) {
				getLogger().warn(`Skill ${skillPath} missing frontmatter`);
				return null;
			}
			const parsed = parseSkillFrontmatter(match[1], skillId);
			return parsed ?? null;
		} catch (error) {
			getLogger().error(
				`Failed to load skill metadata from ${skillPath}:`,
				error,
			);
			return null;
		}
	}

	getCachedMetadata(skillId: string): SkillFrontmatter | undefined {
		return this.metadataCache.get(skillId);
	}

	getAllCachedMetadata(): SkillFrontmatter[] {
		return Array.from(this.metadataCache.values());
	}

	getPathForSkill(skillId: string): SkillPathInfo | undefined {
		return this.pathCache.get(skillId);
	}
}
