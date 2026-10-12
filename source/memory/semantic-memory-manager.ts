import {execFile} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {getAppDataPath} from '@/config/paths';

const execFileAsync = promisify(execFile);

/**
 * Git state captured when a memory is saved, so a later recall can tell
 * whether the files the memory talks about have changed since.
 */
export interface MemoryGitSnapshot {
	/** The commit HEAD pointed at when the memory was saved. */
	commit: string;
	/** The checked-out branch. Absent on a detached HEAD. */
	branch?: string;
	/** Repo-relative paths of tracked files the memory mentions, mapped to their content hash at save time. */
	files: Record<string, string>;
}

export interface SemanticMemory {
	id: string;
	content: string;
	category: string;
	timestamp: string;
	sourceSessionId?: string;
	git?: MemoryGitSnapshot;
}

export interface MemoryFileChange {
	path: string;
	status: 'modified' | 'deleted';
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

/**
 * How long a lock may go un-refreshed before a waiter treats it as abandoned.
 * The holder heartbeats well inside this, so an un-refreshed lock means the
 * holder is gone or wedged rather than merely slow.
 */
const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 15_000;
/** Refresh interval while the lock is held. Comfortably inside the stale window. */
const LOCK_HEARTBEAT_MS = 2_000;

/**
 * Is the process with this pid still around?
 *
 * `kill(pid, 0)` is the canonical probe: it checks for the process without
 * signalling it. EPERM means it exists but belongs to someone else, which
 * still counts as alive; only ESRCH means gone.
 *
 * `vscode/discovery.ts` has its own copy of this. That module is deliberately
 * free of `@/` aliases so the VS Code extension can bundle it, so it cannot
 * import a shared helper, and a ten-line duplicate beats teaching esbuild
 * about the source tree's path aliases.
 */
function isProcessAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException)?.code === 'EPERM';
	}
}

/** Read the pid a lock file records, or null if it is unreadable/malformed. */
async function readLockOwner(lockPath: string): Promise<number | null> {
	try {
		const raw = (await fs.readFile(lockPath, 'utf8')).trim();
		const pid = Number(raw);
		return Number.isInteger(pid) && pid > 0 ? pid : null;
	} catch {
		return null;
	}
}

/**
 * Decide whether a lock we could not create is abandoned and may be removed.
 *
 * Elapsed time alone is not the question. The mtime used to be stamped once
 * at acquisition and never touched again, so "held for more than 10 seconds"
 * and "abandoned" were the same test - and any operation that legitimately
 * ran longer than that had its lock deleted out from under it by a waiter in
 * another process. Both then ran the critical section at once and finished
 * with `atomicWriteFile`, so the loser's memories were silently dropped
 * rather than merged.
 *
 * Two signals instead. A dead owner is abandoned immediately, however fresh
 * the file looks. A live owner is left alone unless its heartbeat has stopped
 * for longer than the stale window, which covers both a wedged holder and the
 * case where the recorded pid has been recycled by an unrelated process.
 */
/** @internal Exported for tests: this is where the reclaim decision lives. */
export async function isLockAbandoned(lockPath: string): Promise<boolean> {
	const owner = await readLockOwner(lockPath);
	// A dead owner is abandoned outright, however recently the file was
	// touched. A null owner means the file is unreadable or half-written, so
	// there is no pid to judge and only the heartbeat is left to go on.
	if (owner !== null && !isProcessAlive(owner)) return true;
	return await isHeartbeatStale(lockPath);
}

async function isHeartbeatStale(lockPath: string): Promise<boolean> {
	try {
		const stat = await fs.stat(lockPath);
		return Date.now() - stat.mtimeMs > LOCK_STALE_MS;
	} catch {
		// Gone already; the retry will just take it.
		return false;
	}
}

async function withExclusiveLock<T>(
	lockPath: string,
	operation: () => Promise<T>,
): Promise<T> {
	const deadline = Date.now() + LOCK_WAIT_MS;
	while (true) {
		try {
			const handle = await fs.open(lockPath, 'wx', 0o600);
			// Keep the lock's mtime moving for as long as we hold it, so a
			// waiter can tell "still working" from "abandoned". Unref'd: this
			// must never be the thing keeping the process alive.
			const heartbeat = setInterval(() => {
				const now = new Date();
				fs.utimes(lockPath, now, now).catch(() => {
					// Lock removed under us; the release below notices.
				});
			}, LOCK_HEARTBEAT_MS);
			heartbeat.unref();
			try {
				await handle.writeFile(String(process.pid), 'utf8');
				return await operation();
			} finally {
				clearInterval(heartbeat);
				await handle.close();
				try {
					const owner = (await fs.readFile(lockPath, 'utf8')).trim();
					if (owner === String(process.pid)) {
						await fs.unlink(lockPath);
					}
				} catch {
					// Lock already gone or stolen.
				}
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
			if (await isLockAbandoned(lockPath)) {
				try {
					await fs.unlink(lockPath);
				} catch {
					// Someone else reclaimed it first; retry the create.
				}
				continue;
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

/**
 * Snapshot paths are later read from disk, so only repo-relative paths that
 * stay inside the repository are accepted from the store.
 */
function isSafeRelativePath(file: string): boolean {
	return (
		file.length > 0 &&
		!path.isAbsolute(file) &&
		!file.split(/[\\/]/u).includes('..')
	);
}

function isMemoryGitSnapshot(value: unknown): value is MemoryGitSnapshot {
	if (!isRecord(value) || typeof value.commit !== 'string') return false;
	if (value.branch !== undefined && typeof value.branch !== 'string') {
		return false;
	}
	const {files} = value;
	return (
		isRecord(files) &&
		Object.entries(files).every(
			([file, hash]) => typeof hash === 'string' && isSafeRelativePath(file),
		)
	);
}

/**
 * The snapshot only feeds the staleness warning, so a malformed one costs the
 * memory its warning, never the memory itself.
 */
function withValidGitSnapshot(memory: SemanticMemory): SemanticMemory {
	if (memory.git === undefined || isMemoryGitSnapshot(memory.git)) {
		return memory;
	}
	const {git: _invalid, ...rest} = memory;
	return rest;
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
const SINGLE_HIT_MIN_RATIO = 0.5;

function tokenize(value: string): Set<string> {
	return new Set(
		value
			.toLowerCase()
			.split(/[^a-z0-9]+/u)
			.filter(part => part.length > 1 && !STOPWORDS.has(part)),
	);
}

const GIT_TIMEOUT_MS = 5_000;
const MAX_FILE_CANDIDATES = 20;
const MAX_SNAPSHOT_FILES = 10;
const FILE_REFERENCE_PATTERN = /^(?:[\w.-]+\/)*[\w-][\w.-]*\.[A-Za-z][\w]*$/u;

/**
 * Path-like words in a memory ("auth.ts", "src/lib/db.py"). Only candidates:
 * they are matched against the tracked files before anything is recorded.
 */
function extractFileCandidates(content: string): string[] {
	const candidates = new Set<string>();
	for (const word of content.split(/[^\w./-]+/u)) {
		const candidate = word.replace(/^(?:\.\/|\/)+/u, '').replace(/[./]+$/u, '');
		if (
			FILE_REFERENCE_PATTERN.test(candidate) &&
			!candidate.split('/').includes('..')
		) {
			candidates.add(candidate);
			if (candidates.size >= MAX_FILE_CANDIDATES) break;
		}
	}
	return [...candidates];
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
		const git = await this.captureGitSnapshot(content);
		const memory: SemanticMemory = {
			id: crypto.randomUUID(),
			content,
			category,
			timestamp: new Date().toISOString(),
			...(input.sourceSessionId
				? {sourceSessionId: input.sourceSessionId}
				: {}),
			...(git ? {git} : {}),
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
			return parsed.filter(isSemanticMemory).map(withValidGitSnapshot);
		} catch (error) {
			if (
				error instanceof SyntaxError ||
				(error instanceof Error && 'code' in error && error.code === 'ENOENT')
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
				let matchedQueryTerms = 0;
				let categoryHit = false;
				for (const term of queryTerms) {
					if (categoryTerms.has(term)) categoryHit = true;
					if (memoryTerms.has(term) || categoryTerms.has(term)) {
						matchedQueryTerms++;
					}
				}
				const relevanceRatio = matchedQueryTerms / queryTerms.size;
				return {memory, matchedQueryTerms, categoryHit, relevanceRatio};
			})
			.filter(
				result =>
					result.relevanceRatio >= MIN_RELEVANCE_RATIO &&
					(result.categoryHit ||
						result.matchedQueryTerms >= 2 ||
						result.relevanceRatio >= SINGLE_HIT_MIN_RATIO),
			)
			.sort((a, b) => {
				if (a.matchedQueryTerms !== b.matchedQueryTerms) {
					return b.matchedQueryTerms - a.matchedQueryTerms;
				}
				return b.memory.timestamp.localeCompare(a.memory.timestamp);
			})
			.slice(0, limit)
			.map(result => result.memory);
	}

	/**
	 * Which files referenced by these memories have changed or been deleted
	 * since each memory was saved, keyed by memory id. Memories with nothing
	 * changed are left out. Compares working-tree content, so uncommitted edits
	 * count, and a commit moving on by itself does not mark anything stale.
	 */
	async findChangedFiles(
		memories: SemanticMemory[],
	): Promise<Map<string, MemoryFileChange[]>> {
		const changes = new Map<string, MemoryFileChange[]>();
		const tracked = memories.filter(
			memory => memory.git && Object.keys(memory.git.files).length > 0,
		);
		if (tracked.length === 0) return changes;

		const root = await this.getRepositoryRoot();
		const paths = [
			...new Set(
				tracked.flatMap(memory => Object.keys(memory.git?.files ?? {})),
			),
		];
		const current = await this.hashExistingFiles(root, paths);

		for (const memory of tracked) {
			const changed: MemoryFileChange[] = [];
			for (const [file, savedHash] of Object.entries(memory.git?.files ?? {})) {
				const currentHash = current.get(file);
				if (currentHash === undefined) {
					changed.push({path: file, status: 'deleted'});
				} else if (currentHash !== savedHash) {
					changed.push({path: file, status: 'modified'});
				}
			}
			if (changed.length > 0) changes.set(memory.id, changed);
		}
		return changes;
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

	private async git(args: string[], cwd: string): Promise<string> {
		const {stdout} = await execFileAsync('git', args, {
			cwd,
			timeout: GIT_TIMEOUT_MS,
		});
		return stdout;
	}

	private async getRepositoryRoot(): Promise<string> {
		return (await this.git(['rev-parse', '--show-toplevel'], this.cwd)).trim();
	}

	/**
	 * Commit, branch and hashes of the tracked files the memory mentions.
	 * Undefined outside a git repository or before the first commit; a save
	 * never fails because git did.
	 */
	private async captureGitSnapshot(
		content: string,
	): Promise<MemoryGitSnapshot | undefined> {
		try {
			const root = await this.getRepositoryRoot();
			const commit = (await this.git(['rev-parse', 'HEAD'], root)).trim();
			if (!commit) return undefined;
			const branch = (
				await this.git(['branch', '--show-current'], root)
			).trim();
			const referenced = await this.resolveReferencedFiles(root, content);
			const hashes = await this.hashExistingFiles(root, referenced);
			return {
				commit,
				...(branch ? {branch} : {}),
				files: Object.fromEntries(hashes),
			};
		} catch {
			return undefined;
		}
	}

	/**
	 * Map path-like words to tracked files. A bare name ("auth.ts") counts
	 * only when exactly one tracked file has it: guessing between several
	 * would put warnings on memories about a different file.
	 */
	private async resolveReferencedFiles(
		root: string,
		content: string,
	): Promise<string[]> {
		const candidates = extractFileCandidates(content);
		if (candidates.length === 0) return [];

		const output = await this.git(
			[
				'ls-files',
				'-z',
				'--',
				...candidates.map(candidate => `:(glob)**/${candidate}`),
			],
			root,
		);
		const trackedFiles = output.split('\0').filter(Boolean);

		const resolved = new Set<string>();
		for (const candidate of candidates) {
			const matches = trackedFiles.filter(
				file => file === candidate || file.endsWith(`/${candidate}`),
			);
			if (matches.length === 1 && matches[0]) resolved.add(matches[0]);
			if (resolved.size >= MAX_SNAPSHOT_FILES) break;
		}
		return [...resolved];
	}

	/**
	 * Content hashes for the files that exist, in one `git hash-object` call.
	 * Missing files are left out of the result, which is how a deletion shows.
	 * `--no-filters` hashes the bytes on disk without running any configured
	 * clean filter; the hash is only ever compared with another one made the
	 * same way.
	 */
	private async hashExistingFiles(
		root: string,
		files: string[],
	): Promise<Map<string, string>> {
		const existing: string[] = [];
		for (const file of files) {
			try {
				if ((await fs.stat(path.join(root, file))).isFile()) {
					existing.push(file);
				}
			} catch {
				// Deleted or unreadable: reported as missing.
			}
		}
		if (existing.length === 0) return new Map();

		const output = await this.git(
			['hash-object', '--no-filters', '--', ...existing],
			root,
		);
		const hashes = output.trim().split('\n');
		return new Map(
			existing.flatMap((file, index) => {
				const hash = hashes[index]?.trim();
				return hash ? [[file, hash] as const] : [];
			}),
		);
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
