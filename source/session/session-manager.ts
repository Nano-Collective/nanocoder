import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {getAppConfig} from '@/config/index';
import type {Message} from '@/types/core';

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

export class SessionManager {
	private sessionsDir: string;
	private sessionsIndexPath: string;

	constructor() {
		const config = getAppConfig();
		const sessionConfig = config.sessions;

		// Resolve session directory path
		let sessionDirPath = sessionConfig?.directory || '~/.nanocoder-sessions';
		if (sessionDirPath === '~') {
			sessionDirPath = os.homedir();
		} else if (sessionDirPath.startsWith('~/')) {
			sessionDirPath = path.join(os.homedir(), sessionDirPath.slice(2));
		}

		this.sessionsDir = sessionDirPath;
		this.sessionsIndexPath = path.join(this.sessionsDir, 'sessions.json');
	}

	async initialize(): Promise<void> {
		try {
			await fs.mkdir(this.sessionsDir, {recursive: true});
			try {
				await fs.access(this.sessionsIndexPath);
			} catch (_error) {
				await fs.writeFile(this.sessionsIndexPath, JSON.stringify([]), {
					mode: 0o600,
				});
			}

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
		const sessionId = Date.now().toString();
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
		const sessionFilePath = path.join(this.sessionsDir, `${session.id}.json`);

		await fs.writeFile(sessionFilePath, JSON.stringify(session, null, 2), {
			mode: 0o600,
		});

		// Update sessions index
		const sessions = await this.listSessions();
		const existingSessionIndex = sessions.findIndex(s => s.id === session.id);

		const sessionMetadata: SessionMetadata = {
			id: session.id,
			title: session.title,
			createdAt: session.createdAt,
			lastAccessedAt: new Date().toISOString(),
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

		await fs.writeFile(
			this.sessionsIndexPath,
			JSON.stringify(sessions, null, 2),
			{mode: 0o600},
		);
	}

	async listSessions(): Promise<SessionMetadata[]> {
		try {
			const data = await fs.readFile(this.sessionsIndexPath, 'utf-8');
			return JSON.parse(data) as SessionMetadata[];
		} catch (_error) {
			// If file doesn't exist or is invalid, return empty array
			return [];
		}
	}

	async loadSession(sessionId: string): Promise<Session | null> {
		try {
			const sessionFilePath = path.join(this.sessionsDir, `${sessionId}.json`);
			const data = await fs.readFile(sessionFilePath, 'utf-8');
			const session = JSON.parse(data) as Session;

			// Update last accessed time
			const updatedSession = {
				...session,
				lastAccessedAt: new Date().toISOString(),
			};

			await this.saveSession(updatedSession);
			return updatedSession;
		} catch (_error) {
			return null;
		}
	}

	async deleteSession(sessionId: string): Promise<void> {
		try {
			// Remove session file
			const sessionFilePath = path.join(this.sessionsDir, `${sessionId}.json`);
			await fs.unlink(sessionFilePath);

			// Remove from sessions index
			const sessions = await this.listSessions();
			const filteredSessions = sessions.filter(s => s.id !== sessionId);
			await fs.writeFile(
				this.sessionsIndexPath,
				JSON.stringify(filteredSessions, null, 2),
				{mode: 0o600},
			);
		} catch (_error) {
			// Ignore errors if file doesn't exist
		}
	}

	async getSessionDirectory(): Promise<string> {
		return this.sessionsDir;
	}

	private async enforceSessionLimits(): Promise<void> {
		const config = getAppConfig();
		const sessionConfig = config.sessions;
		const maxSessions = sessionConfig?.maxSessions || 100;

		const sessions = await this.listSessions();
		if (sessions.length > maxSessions) {
			// Sort by lastAccessedAt ascending (oldest first)
			const sortedSessions = sessions.sort(
				(a, b) =>
					new Date(a.lastAccessedAt).getTime() -
					new Date(b.lastAccessedAt).getTime(),
			);

			// Delete oldest sessions beyond the limit
			const sessionsToDelete = sortedSessions.slice(
				0,
				sessions.length - maxSessions,
			);
			for (const session of sessionsToDelete) {
				await this.deleteSession(session.id);
			}
		}
	}

	private async cleanupOldSessions(): Promise<void> {
		const config = getAppConfig();
		const sessionConfig = config.sessions;
		const retentionDays = sessionConfig?.retentionDays || 30;

		const cutoffDate = new Date();
		cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

		const sessions = await this.listSessions();
		const oldSessions = sessions.filter(
			session => new Date(session.lastAccessedAt) < cutoffDate,
		);

		for (const session of oldSessions) {
			await this.deleteSession(session.id);
		}
	}
}

// Export singleton instance
export const sessionManager = new SessionManager();
