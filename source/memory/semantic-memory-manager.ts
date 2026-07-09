import {execFile} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {getAppDataPath} from '@/config/paths';

const execFileAsync = promisify(execFile);

export interface SemanticMemory {
	id: string;
	content: string;
	createdAt: string;
	sourceSessionId?: string;
}

export interface CreateMemoryInput {
	content: string;
	sourceSessionId?: string;
}

export interface SemanticMemoryManagerOptions {
	memoryDir?: string;
	cwd?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSemanticMemory(value: unknown): value is SemanticMemory {
	if (!isRecord(value)) return false;
	return (
		typeof value.id === 'string' &&
		typeof value.content === 'string' &&
		typeof value.createdAt === 'string' &&
		(value.sourceSessionId === undefined ||
			typeof value.sourceSessionId === 'string')
	);
}

async function atomicWriteFile(filePath: string, data: string): Promise<void> {
	const tmpPath = `${filePath}.${crypto.randomUUID()}.tmp`;
	try {
		await fs.writeFile(tmpPath, data, {mode: 0o600});
		await fs.rename(tmpPath, filePath);
	} catch (error) {
		try {
			await fs.unlink(tmpPath);
		} catch (_cleanupError) {
			// Ignore cleanup errors.
		}
		throw error;
	}
}

function hashScope(scope: string): string {
	return crypto.createHash('sha256').update(scope).digest('hex').slice(0, 32);
}

function tokenize(value: string): Set<string> {
	return new Set(
		value
			.toLowerCase()
			.split(/[^a-z0-9]+/u)
			.filter(part => part.length > 1),
	);
}

export class SemanticMemoryManager {
	private readonly memoryDir: string;
	private readonly cwd: string;
	private memoryFilePath?: string;

	constructor(options: SemanticMemoryManagerOptions = {}) {
		this.memoryDir = options.memoryDir ?? path.join(getAppDataPath(), 'memory');
		this.cwd = options.cwd ?? process.cwd();
	}

	async addMemory(input: CreateMemoryInput): Promise<SemanticMemory> {
		const content = input.content.trim();
		if (!content) {
			throw new Error('Memory content cannot be empty');
		}

		const memory: SemanticMemory = {
			id: crypto.randomUUID(),
			content,
			createdAt: new Date().toISOString(),
			...(input.sourceSessionId
				? {sourceSessionId: input.sourceSessionId}
				: {}),
		};

		const memories = await this.listMemories();
		memories.push(memory);
		await this.writeMemories(memories);
		return memory;
	}

	async listMemories(): Promise<SemanticMemory[]> {
		const filePath = await this.getMemoryFilePath();
		try {
			const data = await fs.readFile(filePath, 'utf-8');
			const parsed: unknown = JSON.parse(data);
			if (!Array.isArray(parsed)) return [];
			return parsed.filter(isSemanticMemory);
		} catch (error) {
			if (
				error instanceof Error &&
				'code' in error &&
				error.code === 'ENOENT'
			) {
				return [];
			}
			throw error;
		}
	}

	async deleteMemory(id: string): Promise<boolean> {
		const memories = await this.listMemories();
		const filtered = memories.filter(memory => memory.id !== id);
		if (filtered.length === memories.length) {
			return false;
		}

		await this.writeMemories(filtered);
		return true;
	}

	async clearMemories(): Promise<void> {
		await this.writeMemories([]);
	}

	async findRelevantMemories(
		query: string,
		limit = 5,
	): Promise<SemanticMemory[]> {
		const queryTerms = tokenize(query);
		if (queryTerms.size === 0 || limit <= 0) return [];

		return (await this.listMemories())
			.map(memory => {
				const memoryTerms = tokenize(memory.content);
				let score = 0;
				for (const term of queryTerms) {
					if (memoryTerms.has(term)) score++;
				}
				return {memory, score};
			})
			.filter(result => result.score > 0)
			.sort((a, b) => {
				if (a.score !== b.score) return b.score - a.score;
				return b.memory.createdAt.localeCompare(a.memory.createdAt);
			})
			.slice(0, limit)
			.map(result => result.memory);
	}

	private async getMemoryFilePath(): Promise<string> {
		if (this.memoryFilePath) return this.memoryFilePath;

		await fs.mkdir(this.memoryDir, {recursive: true, mode: 0o700});
		const scope = await this.getRepositoryScope();
		this.memoryFilePath = path.join(this.memoryDir, `${hashScope(scope)}.json`);
		return this.memoryFilePath;
	}

	private async getRepositoryScope(): Promise<string> {
		try {
			const {stdout} = await execFileAsync(
				'git',
				['config', '--get', 'remote.origin.url'],
				{cwd: this.cwd},
			);
			const remote = stdout.trim();
			if (remote) return remote;
		} catch {
			// Non-git directories fall back to their absolute path.
		}

		return path.resolve(this.cwd);
	}

	private async writeMemories(memories: SemanticMemory[]): Promise<void> {
		const filePath = await this.getMemoryFilePath();
		await atomicWriteFile(filePath, JSON.stringify(memories, null, 2));
	}
}
