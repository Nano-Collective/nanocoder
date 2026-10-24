import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
	type ArtifactManager,
	artifactManager,
} from '@/artifacts/artifact-manager';
import {getAppConfig} from '@/config/index';
import {MAX_SESSION_NAME_LENGTH} from '@/constants';
import {isValidSessionId} from '@/session/session-id';
import {getSessionsDirectory} from '@/session/session-paths';
import {
	isValidSession,
	isValidSessionMetadata,
} from '@/session/session-validation';
import type {Message} from '@/types/core';
import {withExclusiveLock} from '@/utils/exclusive-file-lock';

export interface Session {
	id: string;
	title: string;
	createdAt: string;
	lastAccessedAt: string;
	messageCount: number;
	provider: string;
	model: string;
	workingDirectory: string;
	messages: Message[];
	/** True once a user has explicitly renamed this session, so autosave's
	 * auto-derived title (from the latest message) stops overwriting it. */
	titleManuallySet?: boolean;
	/** True once the background titler has named this session, so the
	 * heuristic title stops overwriting it and we never re-generate. */
	titleGenerated?: boolean;
}

export interface SessionMetadata {
	id: string;
	title: string;
	createdAt: string;
	lastAccessedAt: string;
	messageCount: number;
	provider: string;
	model: string;
	workingDirectory: string;
	titleManuallySet?: boolean;
	titleGenerated?: boolean;
}

/** Write data to a temp file then atomically rename into place. */
async function atomicWriteFile(
	filePath: string,
	data: string,
	mode: number,
): Promise<void> {
	const tmpPath = `${filePath}.${crypto.randomUUID()}.tmp`;
	try {
		await fs.writeFile(tmpPath, data, {mode});
		await fs.rename(tmpPath, filePath);
	} catch (error) {
		// Clean up temp file on failure
		try {
			await fs.unlink(tmpPath);
		} catch (_cleanupError) {
			// Ignore cleanup errors
		}
		throw error;
	}
}

function isEnoent(error: unknown): boolean {
	return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function toSessionMetadata(session: Session): SessionMetadata {
	return {
		id: session.id,
		title: session.title,
		createdAt: session.createdAt,
		lastAccessedAt: session.lastAccessedAt,
		messageCount: session.messageCount,
		provider: session.provider,
		model: session.model,
		workingDirectory: session.workingDirectory,
		titleManuallySet: session.titleManuallySet,
		titleGenerated: session.titleGenerated,
	};
}

export class SessionManager {
	private sessionsDir!: string;
	private sessionsIndexPath!: string;
	private initialized = false;
	/** Serializes read-modify-write of sessions.json within this process. Other processes are kept out by the lock file in withIndexLock. */
	private indexWriteLock: Promise<void> = Promise.resolve();
	/** Optional explicit directory override (used by tests). */
	private readonly overrideDir?: string;

	constructor(
		sessionsDir?: string,
		private readonly artifacts: ArtifactManager = artifactManager,
	) {
		this.overrideDir = sessionsDir;
	}

	private resolveSessionsDir(): void {
		if (this.overrideDir) {
			this.sessionsDir = this.overrideDir;
			this.sessionsIndexPath = path.join(this.sessionsDir, 'sessions.json');
			return;
		}

		this.sessionsDir = getSessionsDirectory(getAppConfig().sessions?.directory);
		this.sessionsIndexPath = path.join(this.sessionsDir, 'sessions.json');
	}

	async initialize(): Promise<void> {
		if (this.initialized) return;

		this.resolveSessionsDir();

		try {
			await fs.mkdir(this.sessionsDir, {recursive: true, mode: 0o700});
			await fs.chmod(this.sessionsDir, 0o700);
			await this.withIndexLock(() => this.reconcileIndex());

			this.initialized = true;

			// Perform cleanup of old sessions if configured
			await this.cleanupOldSessions();
		} catch (error) {
			console.error('Failed to initialize session directory:', error);
			throw error;
		}
	}

	async createSession(
		sessionData: Omit<Session, 'id' | 'createdAt' | 'lastAccessedAt'> & {
			id?: string;
		},
	): Promise<Session> {
		// A caller-supplied id is used verbatim as a path segment, so validate it
		// rather than trusting it. Anything unexpected falls back to a fresh id
		// instead of reaching path.join().
		const sessionId =
			sessionData.id && isValidSessionId(sessionData.id)
				? sessionData.id
				: crypto.randomUUID();
		const timestamp = new Date().toISOString();

		const session: Session = {
			id: sessionId,
			title: sessionData.title,
			createdAt: timestamp,
			lastAccessedAt: timestamp,
			messageCount: sessionData.messageCount,
			provider: sessionData.provider,
			model: sessionData.model,
			workingDirectory: sessionData.workingDirectory,
			messages: sessionData.messages,
			titleManuallySet: sessionData.titleManuallySet,
		};

		await this.saveSession(session);
		await this.enforceSessionLimits();
		return session;
	}

	async saveSession(session: Session): Promise<void> {
		if (!isValidSessionId(session.id)) {
			throw new Error(`Invalid session ID: ${session.id}`);
		}

		// File write and index update happen together under the lock
		// to prevent orphaned files if the process dies between them.
		await this.withIndexLock(async () => {
			const sessionFilePath = path.join(this.sessionsDir, `${session.id}.json`);

			// Write session file atomically
			await atomicWriteFile(
				sessionFilePath,
				JSON.stringify(session, null, 2),
				0o600,
			);

			// Update index
			const sessions = await this.readIndex();
			const existingSessionIndex = sessions.findIndex(s => s.id === session.id);

			const sessionMetadata: SessionMetadata = {
				id: session.id,
				title: session.title,
				createdAt: session.createdAt,
				lastAccessedAt: session.lastAccessedAt,
				messageCount: session.messageCount,
				provider: session.provider,
				model: session.model,
				workingDirectory: session.workingDirectory,
				titleManuallySet: session.titleManuallySet,
				titleGenerated: session.titleGenerated,
			};

			if (existingSessionIndex >= 0) {
				sessions[existingSessionIndex] = sessionMetadata;
			} else {
				sessions.push(sessionMetadata);
			}

			await atomicWriteFile(
				this.sessionsIndexPath,
				JSON.stringify(sessions, null, 2),
				0o600,
			);
		});
	}

	/** Read the index file (internal helper — not locked). */
	private async readIndex(): Promise<SessionMetadata[]> {
		try {
			const data = await fs.readFile(this.sessionsIndexPath, 'utf-8');
			const parsed: unknown = JSON.parse(data);
			if (!Array.isArray(parsed)) return this.rebuildIndex();
			const valid = parsed.filter(isValidSessionMetadata);
			if (valid.length === 0 && parsed.length > 0) {
				// Index had entries but none were valid — try recovery
				return this.rebuildIndex();
			}
			return valid;
		} catch (_error) {
			return this.rebuildIndex();
		}
	}

	/**
	 * Rebuild the index by scanning session files on disk.
	 * Called when the index is corrupt, or empty despite files existing. A
	 * missing or incomplete index is repaired at startup by reconcileIndex.
	 */
	private async rebuildIndex(): Promise<SessionMetadata[]> {
		try {
			const entries = await fs.readdir(this.sessionsDir);
			const sessionFiles = entries.filter(
				e => e.endsWith('.json') && e !== 'sessions.json',
			);
			if (sessionFiles.length === 0) return [];

			const metadata: SessionMetadata[] = [];
			for (const file of sessionFiles) {
				try {
					const filePath = path.join(this.sessionsDir, file);
					const data = await fs.readFile(filePath, 'utf-8');
					const parsed: unknown = JSON.parse(data);
					if (isValidSession(parsed)) {
						metadata.push(toSessionMetadata(parsed));
					}
				} catch (_fileError) {
					// Skip unreadable files
				}
			}

			// Persist rebuilt index
			if (metadata.length > 0) {
				await atomicWriteFile(
					this.sessionsIndexPath,
					JSON.stringify(metadata, null, 2),
					0o600,
				);
			}

			return metadata;
		} catch (_error) {
			return [];
		}
	}

	/**
	 * Bring sessions.json back in line with the session files on disk.
	 *
	 * readIndex trusts any index that parses, so an entry it lost - two
	 * processes saving at once before the index had a cross-process lock, a
	 * deleted index, a crash - stayed lost: the session file was on disk, but
	 * resume, retention and pruning never saw it. Runs once per process at
	 * startup, under the index lock. Indexes valid session files the index is
	 * missing, drops entries whose file is gone, and creates the index if it
	 * does not exist. Only the unindexed files are read.
	 */
	private async reconcileIndex(): Promise<void> {
		const indexExists = await fs.access(this.sessionsIndexPath).then(
			() => true,
			() => false,
		);
		const indexed = indexExists ? await this.readIndex() : [];
		const onDisk = await this.listSessionFileIds();

		const indexedIds = new Set(indexed.map(s => s.id));
		const kept = indexed.filter(s => onDisk.has(s.id));
		const recovered: SessionMetadata[] = [];
		for (const id of onDisk) {
			if (indexedIds.has(id)) continue;
			const session = await this.readSession(id);
			if (session) recovered.push(toSessionMetadata(session));
		}

		if (
			indexExists &&
			recovered.length === 0 &&
			kept.length === indexed.length
		) {
			return;
		}

		await atomicWriteFile(
			this.sessionsIndexPath,
			JSON.stringify([...kept, ...recovered], null, 2),
			0o600,
		);
	}

	/** Ids of the session files in the sessions directory. */
	private async listSessionFileIds(): Promise<Set<string>> {
		const ids = new Set<string>();
		for (const entry of await fs.readdir(this.sessionsDir)) {
			if (!entry.endsWith('.json') || entry === 'sessions.json') continue;
			const id = entry.slice(0, -'.json'.length);
			if (isValidSessionId(id)) ids.add(id);
		}
		return ids;
	}

	/**
	 * Delete artifact directories with no surviving session.
	 *
	 * Runs at startup regardless of the autosave setting. With autosave off no
	 * session file is ever written, so nothing else would ever reclaim these
	 * directories; with autosave on, every `/clear` retires a session id and
	 * only the persisted ones are kept.
	 *
	 * The startup caller fires this before anything has initialized the
	 * manager, and with autosave off nothing ever does. So the sessions
	 * directory is resolved here, read-only: no directory is created, no index
	 * is rewritten and retention does not run. A store that exists but cannot
	 * be read keeps every artifact directory, because treating every saved
	 * session as unknown would delete their plans, tasks and walkthroughs.
	 *
	 * Best-effort: any failure is swallowed, since reclaiming disk must never
	 * block or crash startup.
	 */
	async cleanupOrphanedArtifacts(liveSessionId?: string): Promise<void> {
		try {
			const known = await this.knownSessionIds();
			if (!known) return;
			if (liveSessionId) known.add(liveSessionId);
			await this.artifacts.cleanupOrphanedSessions(known);
		} catch {
			// Never let artifact housekeeping break startup.
		}
	}

	/**
	 * Ids of every saved session: the session files on disk plus anything the
	 * index lists, so neither a lost index entry nor a stray one decides alone.
	 * An empty set when there is no sessions directory (nothing was ever
	 * saved), and null when the store exists but cannot be read.
	 */
	private async knownSessionIds(): Promise<Set<string> | null> {
		if (!this.sessionsIndexPath) this.resolveSessionsDir();

		let known: Set<string>;
		try {
			known = await this.listSessionFileIds();
		} catch (error) {
			return isEnoent(error) ? new Set() : null;
		}

		try {
			const parsed: unknown = JSON.parse(
				await fs.readFile(this.sessionsIndexPath, 'utf-8'),
			);
			if (Array.isArray(parsed)) {
				for (const entry of parsed.filter(isValidSessionMetadata)) {
					known.add(entry.id);
				}
			}
		} catch {
			// No usable index: the session files on disk already name every
			// saved session.
		}
		return known;
	}

	async listSessions(options?: {
		workingDirectory?: string;
	}): Promise<SessionMetadata[]> {
		const sessions = await this.readIndex();
		if (options?.workingDirectory) {
			const normalized = path.normalize(options.workingDirectory);
			return sessions.filter(
				s => path.normalize(s.workingDirectory) === normalized,
			);
		}
		return sessions;
	}

	/** Read a session from disk without updating lastAccessedAt (no write). */
	async readSession(sessionId: string): Promise<Session | null> {
		if (!isValidSessionId(sessionId)) return null;

		try {
			const sessionFilePath = path.join(this.sessionsDir, `${sessionId}.json`);
			const data = await fs.readFile(sessionFilePath, 'utf-8');
			const parsed: unknown = JSON.parse(data);
			if (!isValidSession(parsed)) return null;
			return parsed;
		} catch (_error) {
			return null;
		}
	}

	async loadSession(sessionId: string): Promise<Session | null> {
		const session = await this.readSession(sessionId);
		if (!session) return null;

		// Update last accessed time
		const updatedSession = {
			...session,
			lastAccessedAt: new Date().toISOString(),
		};

		await this.saveSession(updatedSession);
		return updatedSession;
	}

	/** Persist a user-chosen title, marking it so autosave stops overwriting it. */
	async renameSession(
		sessionId: string,
		title: string,
	): Promise<Session | null> {
		const trimmed = title.trim();
		if (!trimmed) {
			throw new Error('Session name cannot be empty.');
		}
		if (trimmed.length > MAX_SESSION_NAME_LENGTH) {
			throw new Error(
				`Session name must be ${MAX_SESSION_NAME_LENGTH} characters or less.`,
			);
		}

		const session = await this.readSession(sessionId);
		if (!session) return null;

		const updatedSession: Session = {
			...session,
			title: trimmed,
			titleManuallySet: true,
			lastAccessedAt: new Date().toISOString(),
		};

		await this.saveSession(updatedSession);
		return updatedSession;
	}

	async deleteSession(sessionId: string): Promise<void> {
		if (!isValidSessionId(sessionId)) {
			throw new Error(`Invalid session ID: ${sessionId}`);
		}

		const sessionFilePath = path.join(this.sessionsDir, `${sessionId}.json`);

		// Delete file — only ignore ENOENT
		try {
			await fs.unlink(sessionFilePath);
		} catch (error: unknown) {
			if (!isEnoent(error)) {
				throw error;
			}
		}

		// Update index — let errors propagate
		await this.withIndexLock(async () => {
			const sessions = await this.readIndex();
			const filteredSessions = sessions.filter(s => s.id !== sessionId);
			await atomicWriteFile(
				this.sessionsIndexPath,
				JSON.stringify(filteredSessions, null, 2),
				0o600,
			);
		});

		await this.artifacts.deleteSessionArtifacts(sessionId);
	}

	getSessionDirectory(): string {
		return this.sessionsDir;
	}

	/**
	 * Run a read-modify-write on the index one at a time to avoid lost updates.
	 *
	 * The promise chain orders callers in this process. Every Nanocoder process
	 * shares the same store, though (other terminals, the VS Code extension,
	 * parallel `nanocoder run`s), so the update also holds `sessions.json.lock`.
	 * Without it, two processes saving at once each rename their own copy of the
	 * index into place, and the session the other one added is silently lost.
	 */
	private async withIndexLock<T>(fn: () => Promise<T>): Promise<T> {
		const prev = this.indexWriteLock;
		let release!: () => void;
		this.indexWriteLock = new Promise<void>(r => {
			release = r;
		});
		await prev;
		try {
			// Before initialize() there is no index path to lock, and the caller
			// fails on that missing path exactly as it did before.
			if (!this.sessionsIndexPath) return await fn();
			return await withExclusiveLock(`${this.sessionsIndexPath}.lock`, fn);
		} finally {
			release();
		}
	}

	private async enforceSessionLimits(): Promise<void> {
		const config = getAppConfig();
		const sessionConfig = config.sessions;
		const maxSessions = sessionConfig?.maxSessions || 100;

		await this.withIndexLock(async () => {
			const sessions = await this.readIndex();
			if (sessions.length <= maxSessions) return;

			// Sort by lastAccessedAt ascending (oldest first)
			const sortedSessions = sessions.sort(
				(a, b) =>
					new Date(a.lastAccessedAt).getTime() -
					new Date(b.lastAccessedAt).getTime(),
			);

			const sessionsToDelete = sortedSessions.slice(
				0,
				sessions.length - maxSessions,
			);
			const idsToDelete = new Set(sessionsToDelete.map(s => s.id));

			// Rewrite index first so sessions are deregistered even if
			// file deletion partially fails.
			const remaining = sortedSessions.filter(s => !idsToDelete.has(s.id));
			await atomicWriteFile(
				this.sessionsIndexPath,
				JSON.stringify(remaining, null, 2),
				0o600,
			);

			// Then delete files — only ignore ENOENT
			for (const session of sessionsToDelete) {
				const filePath = path.join(this.sessionsDir, `${session.id}.json`);
				try {
					await fs.unlink(filePath);
				} catch (error: unknown) {
					if (!isEnoent(error)) {
						throw error;
					}
				}
				await this.artifacts.deleteSessionArtifacts(session.id);
			}
		});
	}

	private async cleanupOldSessions(): Promise<void> {
		const config = getAppConfig();
		const sessionConfig = config.sessions;
		const retentionDays = sessionConfig?.retentionDays || 30;

		const cutoffDate = new Date();
		cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

		await this.withIndexLock(async () => {
			const sessions = await this.readIndex();
			const oldSessions = sessions.filter(
				session => new Date(session.lastAccessedAt) < cutoffDate,
			);

			if (oldSessions.length === 0) return;

			const idsToDelete = new Set(oldSessions.map(s => s.id));

			// Rewrite index first so sessions are deregistered even if
			// file deletion partially fails.
			const remaining = sessions.filter(s => !idsToDelete.has(s.id));
			await atomicWriteFile(
				this.sessionsIndexPath,
				JSON.stringify(remaining, null, 2),
				0o600,
			);

			// Then delete files — only ignore ENOENT
			for (const session of oldSessions) {
				const filePath = path.join(this.sessionsDir, `${session.id}.json`);
				try {
					await fs.unlink(filePath);
				} catch (error: unknown) {
					if (!isEnoent(error)) {
						throw error;
					}
				}
				await this.artifacts.deleteSessionArtifacts(session.id);
			}
		});
	}
}

// Export singleton instance — config is deferred to initialize()
export const sessionManager = new SessionManager();
