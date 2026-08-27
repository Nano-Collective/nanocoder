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
	category: string;
	timestamp: string;
	sourceSessionId?: string;
}

export interface CreateMemoryInput {
	content: string;
	category?: string;
	sourceSessionId?: string;
}

export interface SemanticMemoryManagerOptions {
	memoryDir?: string;
	cwd?: string;
	maxStoredMemories?: number;
}

const DEFAULT_MAX_STORED_MEMORIES = 500;

const writeQueues = new Map<string, Promise<unknown>>();

function enqueueByKey<T>(key: string, operation: () => Promise<T>): Promise<T> {
	const previous = writeQueues.get(key) ?? Promise.resolve();
	const result = previous.then(operation, operation);
	writeQueues.set(
		key,
		result.then(
			() => undefined,
			() => undefined,
		),
	);
	return result;
}

const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 15_000;

async function withExclusiveLock<T>(
	lockPath: string,
	operation: () => Promise<T>,
): Promise<T> {
	const deadline = Date.now() + LOCK_WAIT_MS;
	while (true) {
		try {
			const handle = await fs.open(lockPath, 'wx', 0o600);
			try {
				return await operation();
			} finally {
				await handle.close();
				await fs.unlink(lockPath).catch(() => undefined);
			}
		} catch (error) {
			const code =
				error instanceof Error && 'code' in error
					? (error as NodeJS.ErrnoException).code
					: undefined;
			if (code !== 'EEXIST') throw error;
			if (Date.now() >= deadline) {
				throw new Error(`Timed out waiting for memory file lock: ${lockPath}`);
			}
			try {
				const stat = await fs.stat(lockPath);
				if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
					await fs.unlink(lockPath);
					continue;
				}
			} catch {
				// Lock gone; retry create.
			}
			await new Promise(resolve => setTimeout(resolve, 20));
		}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSemanticMemory(value: unknown): value is SemanticMemory {
	if (!isRecord(value)) return false;
	return (
		typeof value.id === 'string' &&
		typeof value.content === 'string' &&
		typeof value.category === 'string' &&
		typeof value.timestamp === 'string' &&
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

const STOPWORDS = new Set([
	'a',
	'about',
	'after',
	'again',
	'all',
	'am',
	'an',
	'and',
	'any',
	'are',
	'as',
	'at',
	'be',
	'been',
	'being',
	'but',
	'by',
	'can',
	'could',
	'did',
	'do',
	'does',
	'doing',
	'down',
	'during',
	'each',
	'few',
	'for',
	'from',
	'further',
	'had',
	'has',
	'have',
	'having',
	'he',
	'her',
	'here',
	'hers',
	'herself',
	'him',
	'himself',
	'his',
	'how',
	'if',
	'in',
	'into',
	'is',
	'it',
	'its',
	'itself',
	'just',
	'me',
	'more',
	'most',
	'my',
	'myself',
	'no',
	'nor',
	'not',
	'now',
	'of',
	'off',
	'on',
	'once',
	'only',
	'or',
	'other',
	'our',
	'ours',
	'ourselves',
	'out',
	'over',
	'own',
	'same',
	'she',
	'should',
	'so',
	'some',
	'such',
	'than',
	'that',
	'the',
	'their',
	'theirs',
	'them',
	'themselves',
	'then',
	'there',
	'these',
	'they',
	'this',
	'those',
	'through',
	'to',
	'too',
	'under',
	'until',
	'up',
	'very',
	'was',
	'we',
	'were',
	'what',
	'when',
	'where',
	'which',
	'while',
	'who',
	'whom',
	'why',
	'will',
	'with',
	'would',
	'you',
	'your',
	'yours',
	'yourself',
	'yourselves',
]);

const MIN_RELEVANCE_RATIO = 0.1;

function tokenize(value: string): Set<string> {
	return new Set(
		value
			.toLowerCase()
			.split(/[^a-z0-9]+/u)
			.filter(part => part.length > 1 && !STOPWORDS.has(part)),
	);
}

export class SemanticMemoryManager {
	private readonly memoryDir: string;
	private readonly cwd: string;
	private readonly maxStoredMemories: number;
	private memoryFilePath?: string;

	constructor(options: SemanticMemoryManagerOptions = {}) {
		this.memoryDir = options.memoryDir ?? path.join(getAppDataPath(), 'memory');
		this.cwd = options.cwd ?? process.cwd();
		this.maxStoredMemories = Math.max(
			1,
			options.maxStoredMemories ?? DEFAULT_MAX_STORED_MEMORIES,
		);
	}

	private mutate<T>(operation: () => Promise<T>): Promise<T> {
		return this.getMemoryFilePath().then(filePath =>
			enqueueByKey(filePath, () =>
				withExclusiveLock(`${filePath}.lock`, operation),
			),
		);
	}

	async addMemory(input: CreateMemoryInput): Promise<SemanticMemory> {
		const content = input.content.trim();
		if (!content) {
			throw new Error('Memory content cannot be empty');
		}

		const category = input.category?.trim() || 'project';
		const memory: SemanticMemory = {
			id: crypto.randomUUID(),
			content,
			category,
			timestamp: new Date().toISOString(),
			...(input.sourceSessionId
				? {sourceSessionId: input.sourceSessionId}
				: {}),
		};

		return this.mutate(async () => {
			const memories = await this.listMemories();
			memories.push(memory);
			await this.writeMemories(memories);
			return memory;
		});
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
		return this.mutate(async () => {
			const memories = await this.listMemories();
			const filtered = memories.filter(memory => memory.id !== id);
			if (filtered.length === memories.length) {
				return false;
			}

			await this.writeMemories(filtered);
			return true;
		});
	}

	async clearMemories(): Promise<void> {
		await this.mutate(() => this.writeMemories([]));
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
				const categoryTerms = tokenize(memory.category);
				let score = 0;
				for (const term of queryTerms) {
					if (memoryTerms.has(term)) score++;
					if (categoryTerms.has(term)) score++;
				}
				const vocabularySize = memoryTerms.size + categoryTerms.size;
				const relevanceRatio =
					vocabularySize === 0 ? 0 : score / vocabularySize;
				return {memory, score, relevanceRatio};
			})
			.filter(
				result =>
					result.score > 0 && result.relevanceRatio >= MIN_RELEVANCE_RATIO,
			)
			.sort((a, b) => {
				if (a.score !== b.score) return b.score - a.score;
				return b.memory.timestamp.localeCompare(a.memory.timestamp);
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

	private capMemories(memories: SemanticMemory[]): SemanticMemory[] {
		if (memories.length <= this.maxStoredMemories) return memories;

		const keep = new Set(
			[...memories]
				.sort((a, b) => {
					const byTime = b.timestamp.localeCompare(a.timestamp);
					return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
				})
				.slice(0, this.maxStoredMemories)
				.map(memory => memory.id),
		);

		return memories.filter(memory => keep.has(memory.id));
	}

	private async writeMemories(memories: SemanticMemory[]): Promise<void> {
		const filePath = await this.getMemoryFilePath();
		await atomicWriteFile(
			filePath,
			JSON.stringify(this.capMemories(memories), null, 2),
		);
	}
}
