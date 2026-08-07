import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {getAppDataPath} from '@/config/paths';

const SESSION_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ARTIFACT_FILES = {
	implementation_plan: 'implementation_plan.md',
	task: 'task.md',
	tasks: 'tasks.json',
} as const;

export type ArtifactKind = keyof typeof ARTIFACT_FILES;

export class ArtifactManager {
	constructor(
		private readonly rootDir = path.join(getAppDataPath(), 'artifacts'),
	) {}

	getArtifactPath(sessionId: string, kind: ArtifactKind): string {
		this.validateSessionId(sessionId);
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

	async deleteSessionArtifacts(sessionId: string): Promise<void> {
		this.validateSessionId(sessionId);
		await fs.rm(path.join(this.rootDir, sessionId), {
			recursive: true,
			force: true,
		});
	}

	private validateSessionId(sessionId: string): void {
		if (!SESSION_ID_PATTERN.test(sessionId)) {
			throw new Error(`Invalid session ID: ${sessionId}`);
		}
	}
}

export const artifactManager = new ArtifactManager();
