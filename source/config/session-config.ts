import fs from 'node:fs';
import path from 'node:path';
import {getConfigPath} from '@/config/paths';
import type {AppConfig} from '@/types/config';

export type SessionConfig = NonNullable<AppConfig['sessions']>;

/** One set of session defaults for the app and the read-only inspector. */
export const DEFAULT_SESSION_CONFIG: SessionConfig = {
	autoSave: true,
	saveInterval: 30000,
	maxSessions: 100,
	maxMessages: 1000,
	retentionDays: 30,
	directory: '',
	smartTitles: true,
};

function sessionNumber(value: unknown, min: number, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value)
		? Math.max(min, value)
		: fallback;
}

/** Apply exactly the same session preferences in the app and diagnostics. */
export function normalizeSessionConfig(value: unknown): SessionConfig | null {
	if (!value || typeof value !== 'object') return null;
	const sessions = value as Record<string, unknown>;
	const defaults = DEFAULT_SESSION_CONFIG;
	return {
		autoSave:
			sessions.autoSave !== undefined
				? Boolean(sessions.autoSave)
				: defaults.autoSave,
		saveInterval: sessionNumber(
			sessions.saveInterval,
			1000,
			defaults.saveInterval ?? 30000,
		),
		maxSessions: sessionNumber(
			sessions.maxSessions,
			1,
			defaults.maxSessions ?? 100,
		),
		maxMessages: sessionNumber(
			sessions.maxMessages,
			1,
			defaults.maxMessages ?? 1000,
		),
		retentionDays: sessionNumber(
			sessions.retentionDays,
			1,
			defaults.retentionDays ?? 30,
		),
		directory:
			typeof sessions.directory === 'string'
				? sessions.directory
				: defaults.directory,
		smartTitles:
			sessions.smartTitles !== undefined
				? Boolean(sessions.smartTitles)
				: defaults.smartTitles,
		titleModel:
			typeof sessions.titleModel === 'string' ? sessions.titleModel : undefined,
		titleProvider:
			typeof sessions.titleProvider === 'string'
				? sessions.titleProvider
				: undefined,
	};
}

interface SessionConfigRead {
	config: SessionConfig;
	errors: Array<{path: string; message: string}>;
}

/**
 * Follow the app's project-over-global precedence without initializing any
 * preferences or importing the broader application config graph.
 */
export function readSessionConfigReadOnly(
	projectRoot: string,
	configRoot = getConfigPath(),
): SessionConfigRead {
	const errors: SessionConfigRead['errors'] = [];
	for (const filePath of [
		path.join(projectRoot, 'nanocoder-preferences.json'),
		path.join(configRoot, 'nanocoder-preferences.json'),
	]) {
		try {
			const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
			const nanocoder =
				parsed && typeof parsed === 'object' && 'nanocoder' in parsed
					? parsed.nanocoder
					: undefined;
			const sessions =
				nanocoder && typeof nanocoder === 'object' && 'sessions' in nanocoder
					? nanocoder.sessions
					: undefined;
			const config = normalizeSessionConfig(sessions);
			if (config) return {config, errors};
		} catch (error) {
			if (
				error instanceof Error &&
				'code' in error &&
				error.code === 'ENOENT'
			) {
				continue;
			}
			errors.push({
				path: filePath,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return {config: {...DEFAULT_SESSION_CONFIG}, errors};
}
