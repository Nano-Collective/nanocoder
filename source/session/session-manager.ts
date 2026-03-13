import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {getAppConfig} from '@/config/index';
import {getAppDataPath} from '@/config/paths';
import type {Message} from '@/types/core';

/** UUID v4 pattern for session ID validation (prevents path traversal) */
const SESSION_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
}

function isValidSessionId(id: string): boolean {
	return SESSION_ID_PATTERN.test(id);
}

function isRecord(obj: unknown): obj is Record<string, unknown> {
	return typeof obj === 'object' && obj !== null && !Array.isArray(obj);
}

function isValidSessionMetadata(obj: unknown): obj is SessionMetadata {
	if (!isRecord(obj)) return false;
	return (
		typeof obj.id === 'string' &&
		typeof obj.title === 'string' &&
		typeof obj.createdAt === 'string' &&
		typeof obj.lastAccessedAt === 'string' &&
		typeof obj.messageCount === 'number' &&
		typeof obj.provider === 'string' &&
		typeof obj.model === 'string' &&
		typeof obj.workingDirectory === 'string'
	);
}

function isValidSession(obj: unknown): obj is Session {
	if (!isRecord(obj)) return false;
	return isValidSessionMetadata(obj) && Array.isArray(obj.messages);
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

export class SessionManager {
	private sessionsDir!: string;
	private sessionsIndexPath!: string;
	private initialized = false;
	/** Serializes read-modify-write of sessions.json to prevent lost updates from concurrent autosave/resume. */
	private indexWriteLock: Promise<void> = Promise.resolve();
	/** Optional explicit directory override (used by tests). */
	private readonly overrideDir?: string;

	constructor(sessionsDir?: string) {
		this.overrideDir = sessionsDir;
	}

	private resolveSessionsDir(): void {
		if (this.overrideDir) {
			this.sessionsDir = this.overrideDir;
			this.sessionsIndexPath = path.join(this.sessionsDir, 'sessions.json');
			return;
		}

		const config = getAppConfig();
		const sessionConfig = config.sessions;
		const configuredDir = sessionConfig?.directory;

		if (configuredDir) {
			// User explicitly configured a directory — expand tilde
			let sessionDirPath = configuredDir;
			if (sessionDirPath === '~') {
				sessionDirPath = path.resolve(
					process.env.HOME || process.env.USERPROFILE || '.',
				);
			} else if (sessionDirPath.startsWith('~/')) {
				sessionDirPath = path.join(
					process.env.HOME || process.env.USERPROFILE || '.',
					sessionDirPath.slice(2),
				);
			}
			this.sessionsDir = sessionDirPath;
		} else {
			// Default: use platform-aware app data path
			this.sessionsDir = path.join(getAppDataPath(), 'sessions');
		}

		this.sessionsIndexPath = path.join(this.sessionsDir, 'sessions.json');
	}

	async initialize(): Promise<void> {
		if (this.initialized) return;

		this.resolveSessionsDir();

		try {
			await fs.mkdir(this.sessionsDir, {recursive: true, mode: 0o700});
			await fs.chmod(this.sessionsDir, 0o700);
			try {
				await fs.access(this.sessionsIndexPath);
			} catch (_error) {
				await atomicWriteFile(
					this.sessionsIndexPath,
					JSON.stringify([]),
					0o600,
				);
			}

			this.initialized = true;

			// Perform cleanup of old sessions if configured
			await this.cleanupOldSessions();
		} catch (error) {
			console.error('Failed to initialize session directory:', error);
			throw error;
		}
	}

	async createSession(
		sessionData: Omit<Session, 'id' | 'createdAt' | 'lastAccessedAt'>,
	): Promise<Session> {
		const sessionId = crypto.randomUUID();
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
	 * Called when the index is missing, corrupt, or empty despite files existing.
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
						metadata.push({
							id: parsed.id,
							title: parsed.title,
							createdAt: parsed.createdAt,
							lastAccessedAt: parsed.lastAccessedAt,
							messageCount: parsed.messageCount,
							provider: parsed.provider,
							model: parsed.model,
							workingDirectory: parsed.workingDirectory,
						});
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
	}

	getSessionDirectory(): string {
		return this.sessionsDir;
	}

	/** Run a read-modify-write on the index one at a time to avoid lost updates. */
	private async withIndexLock<T>(fn: () => Promise<T>): Promise<T> {
		const prev = this.indexWriteLock;
		let release!: () => void;
		this.indexWriteLock = new Promise<void>(r => {
			release = r;
		});
		await prev;
		try {
			return await fn();
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
			}
		});
	}
}

// Export singleton instance — config is deferred to initialize()
export const sessionManager = new SessionManager();
