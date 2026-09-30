import crypto from 'node:crypto';
import type {Dirent} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {getAppDataPath} from '@/config/paths';
import {isValidSessionId} from '@/session/session-id';

const ARTIFACT_FILES = {
	implementation_plan: 'implementation_plan.md',
	task: 'task.md',
	tasks: 'tasks.json',
	walkthrough: 'walkthrough.md',
} as const;

const EPHEMERAL_MARKER = '.ephemeral.json';

export type ArtifactKind = keyof typeof ARTIFACT_FILES;
export type UserArtifactKind = Exclude<ArtifactKind, 'tasks'>;

export interface ArtifactDescriptor {
	kind: UserArtifactKind;
	path: string;
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (
			!(error instanceof Error) || !('code' in error) || error.code !== 'ESRCH'
		);
	}
}

const USER_ARTIFACT_KINDS: UserArtifactKind[] = [
	'implementation_plan',
	'task',
	'walkthrough',
];

export class ArtifactManager {
	constructor(
		private readonly rootDir = path.join(getAppDataPath(), 'artifacts'),
	) {}

	getArtifactPath(sessionId: string, kind: ArtifactKind): string {
		this.validateSessionId(sessionId);
		return path.join(this.rootDir, sessionId, ARTIFACT_FILES[kind]);
	}

	tryGetArtifactPath(
		sessionId: string,
		kind: ArtifactKind,
	): string | undefined {
		if (!isValidSessionId(sessionId)) return undefined;
		return path.join(this.rootDir, sessionId, ARTIFACT_FILES[kind]);
	}

	async writeArtifact(
		sessionId: string,
		kind: ArtifactKind,
		content: string,
	): Promise<string> {
		const filePath = this.getArtifactPath(sessionId, kind);
		const sessionDir = path.dirname(filePath);
		await fs.mkdir(sessionDir, {recursive: true, mode: 0o700});
		await fs.chmod(sessionDir, 0o700);

		const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
		try {
			await fs.writeFile(temporaryPath, content, {
				encoding: 'utf8',
				mode: 0o600,
			});
			await fs.rename(temporaryPath, filePath);
		} catch (error) {
			await fs.unlink(temporaryPath).catch(() => {});
			throw error;
		}

		return filePath;
	}

	async readArtifact(
		sessionId: string,
		kind: ArtifactKind,
	): Promise<string | null> {
		const filePath = this.getArtifactPath(sessionId, kind);
		try {
			return await fs.readFile(filePath, 'utf8');
		} catch (error) {
			if (
				error instanceof Error &&
				'code' in error &&
				error.code === 'ENOENT'
			) {
				return null;
			}
			throw error;
		}
	}

	async listArtifacts(sessionId: string): Promise<ArtifactDescriptor[]> {
		const artifacts: ArtifactDescriptor[] = [];
		for (const kind of USER_ARTIFACT_KINDS) {
			const artifactPath = this.getArtifactPath(sessionId, kind);
			try {
				await fs.access(artifactPath);
				artifacts.push({kind, path: artifactPath});
			} catch (error) {
				if (
					!(error instanceof Error) ||
					!('code' in error) ||
					error.code !== 'ENOENT'
				) {
					throw error;
				}
			}
		}
		return artifacts;
	}

	async deleteSessionArtifacts(sessionId: string): Promise<void> {
		if (!isValidSessionId(sessionId)) return;
		await fs.rm(path.join(this.rootDir, sessionId), {
			recursive: true,
			force: true,
		});
	}

	/**
	 * Drop artifact directories that no live session refers to.
	 *
	 * Session deletion and session retention both call
	 * `deleteSessionArtifacts`, but neither fires for a session that was never
	 * written to disk — the common case when `sessions.autoSave` is off, and
	 * for every `/clear`, which retires the current session id and mints a new
	 * one. Without this sweep those directories accumulate in app data forever.
	 *
	 * `keep` is the set of session ids that still exist (plus the live one).
	 * Directories younger than `minAgeMs` are spared so a session that is mid
	 * first-autosave is never swept out from under itself.
	 */
	async cleanupOrphanedSessions(
		keep: Iterable<string>,
		minAgeMs = 24 * 60 * 60 * 1000,
	): Promise<void> {
		let entries: Dirent<string>[];
		try {
			entries = await fs.readdir(this.rootDir, {withFileTypes: true});
		} catch (error) {
			if (
				error instanceof Error &&
				'code' in error &&
				error.code === 'ENOENT'
			) {
				return;
			}
			throw error;
		}

		const keepSet = new Set(keep);
		const cutoff = Date.now() - minAgeMs;

		for (const entry of entries) {
			if (!entry.isDirectory() || !isValidSessionId(entry.name)) continue;
			if (keepSet.has(entry.name)) continue;
			const sessionDir = path.join(this.rootDir, entry.name);
			try {
				// An ephemeral marker means the plain-shell sweep owns this
				// directory; leave it to `cleanupStaleEphemeralSessions`.
				await fs.access(path.join(sessionDir, EPHEMERAL_MARKER));
				continue;
			} catch {
				// No marker — this is a normal interactive session directory.
			}
			// minAgeMs <= 0 disables the grace period entirely. Comparing against
			// a same-millisecond cutoff is unreliable — stat() reports sub-ms
			// precision that Date.now() truncates — so make it an explicit case
			// rather than a race.
			if (minAgeMs > 0) {
				try {
					const stats = await fs.stat(sessionDir);
					if (stats.mtimeMs > cutoff) continue;
				} catch {
					continue;
				}
			}
			await this.deleteSessionArtifacts(entry.name);
		}
	}

	async markEphemeralSession(
		sessionId: string,
		pid = process.pid,
	): Promise<void> {
		this.validateSessionId(sessionId);
		const sessionDir = path.join(this.rootDir, sessionId);
		await fs.mkdir(sessionDir, {recursive: true, mode: 0o700});
		await fs.chmod(sessionDir, 0o700);
		await fs.writeFile(
			path.join(sessionDir, EPHEMERAL_MARKER),
			JSON.stringify({pid, createdAt: new Date().toISOString()}),
			{encoding: 'utf8', mode: 0o600},
		);
	}

	async cleanupStaleEphemeralSessions(
		processAlive: (pid: number) => boolean = isProcessAlive,
	): Promise<void> {
		let entries: Dirent<string>[];
		try {
			entries = await fs.readdir(this.rootDir, {withFileTypes: true});
		} catch (error) {
			if (
				error instanceof Error &&
				'code' in error &&
				error.code === 'ENOENT'
			) {
				return;
			}
			throw error;
		}

		for (const entry of entries) {
			if (!entry.isDirectory() || !isValidSessionId(entry.name)) continue;
			const markerPath = path.join(this.rootDir, entry.name, EPHEMERAL_MARKER);
			let marker: unknown;
			try {
				marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
			} catch {
				continue;
			}
			const pid =
				marker && typeof marker === 'object'
					? (marker as Record<string, unknown>).pid
					: undefined;
			if (
				typeof pid !== 'number' ||
				!Number.isInteger(pid) ||
				pid <= 0 ||
				processAlive(pid)
			) {
				continue;
			}
			await this.deleteSessionArtifacts(entry.name);
		}
	}

	private validateSessionId(sessionId: string): void {
		if (!isValidSessionId(sessionId)) {
			throw new Error(`Invalid session ID: ${sessionId}`);
		}
	}
}

export const artifactManager = new ArtifactManager();
