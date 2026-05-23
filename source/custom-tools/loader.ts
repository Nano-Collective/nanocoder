import {existsSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {getConfigPath} from '@/config/paths';
import {parseCustomToolFile} from '@/custom-tools/parser';
import type {LoadedCustomTool} from '@/types/custom-tools';

export interface CustomToolLoadError {
	file: string;
	error: string;
}

export interface CustomToolLoadResult {
	tools: LoadedCustomTool[];
	errors: CustomToolLoadError[];
}

function isSafeEntry(entry: string): boolean {
	return (
		entry !== '..' &&
		entry !== '.' &&
		!entry.includes('/') &&
		!entry.includes('\\')
	);
}

/**
 * Scans `.nanocoder/tools/` (project) and the personal tools dir for `.md`
 * custom-tool files. Personal first, project second so project files shadow
 * personal ones by `name`. Duplicate names within the same directory: the
 * first wins, the second is logged as an error.
 *
 * `.ts`/`.js` files are deliberately ignored — Phase 2 will pick them up.
 */
export class CustomToolLoader {
	private projectRoot: string;
	private projectToolsDir: string;
	private personalToolsDir: string;
	private errors: CustomToolLoadError[] = [];

	constructor(projectRoot: string = process.cwd()) {
		this.projectRoot = projectRoot;
		this.projectToolsDir = join(projectRoot, '.nanocoder', 'tools');
		this.personalToolsDir = join(getConfigPath(), 'tools');
	}

	getProjectToolsDirectory(): string {
		return this.projectToolsDir;
	}

	getPersonalToolsDirectory(): string {
		return this.personalToolsDir;
	}

	getProjectRoot(): string {
		return this.projectRoot;
	}

	hasCustomTools(): boolean {
		return (
			existsSync(this.projectToolsDir) || existsSync(this.personalToolsDir)
		);
	}

	getErrors(): CustomToolLoadError[] {
		return [...this.errors];
	}

	/**
	 * Discover and parse all custom tools. Project entries override personal
	 * ones by name. Returns the merged set plus any per-file errors that
	 * occurred.
	 */
	load(): CustomToolLoadResult {
		this.errors = [];
		const byName = new Map<string, LoadedCustomTool>();

		const personal = this.scanDirectory(this.personalToolsDir, 'personal');
		for (const t of personal) {
			if (byName.has(t.metadata.name)) {
				this.errors.push({
					file: t.filePath,
					error: `Duplicate tool name "${t.metadata.name}" in personal tools directory — keeping the first.`,
				});
				continue;
			}
			byName.set(t.metadata.name, t);
		}

		const project = this.scanDirectory(this.projectToolsDir, 'project');
		const seenInProject = new Set<string>();
		for (const t of project) {
			if (seenInProject.has(t.metadata.name)) {
				this.errors.push({
					file: t.filePath,
					error: `Duplicate tool name "${t.metadata.name}" in project tools directory — keeping the first.`,
				});
				continue;
			}
			seenInProject.add(t.metadata.name);
			// Project tools always override personal ones — no error.
			byName.set(t.metadata.name, t);
		}

		return {tools: Array.from(byName.values()), errors: this.getErrors()};
	}

	private scanDirectory(
		dir: string,
		source: 'personal' | 'project',
	): LoadedCustomTool[] {
		if (!existsSync(dir)) return [];
		const out: LoadedCustomTool[] = [];
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch (err) {
			this.errors.push({file: dir, error: String(err)});
			return [];
		}

		for (const entry of entries) {
			if (!isSafeEntry(entry)) continue;
			if (!entry.endsWith('.md')) continue;
			const fullPath = join(dir, entry);
			let stat: ReturnType<typeof statSync>;
			try {
				stat = statSync(fullPath);
			} catch {
				continue;
			}
			if (!stat.isFile()) continue;

			try {
				const parsed = parseCustomToolFile(fullPath);
				out.push({
					metadata: parsed.metadata,
					body: parsed.body,
					filePath: fullPath,
					source,
					subscribe: parsed.subscribe,
				});
			} catch (err) {
				this.errors.push({
					file: fullPath,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}
		return out;
	}
}
