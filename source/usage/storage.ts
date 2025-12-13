/**
 * Usage data storage
 * Persists usage statistics to the app data directory
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {getAppDataPath, getConfigPath} from '@/config/paths';
import {logInfo, logWarning} from '@/utils/message-queue';
import type {UsageData, SessionUsage, DailyAggregate} from '../types/usage';

const USAGE_FILE_NAME = 'usage.json';
const MAX_SESSIONS = 100;
const MAX_DAILY_AGGREGATES = 30;

function getLegacyUsageFilePath(): string {
	// Legacy location: config directory (pre-app-data change)
	try {
		const configDir = getConfigPath();
		return path.join(configDir, USAGE_FILE_NAME);
	} catch {
		return '';
	}
}

function getUsageFilePath(): string {
	const appDataDir = getAppDataPath();
	const newPath = path.join(appDataDir, USAGE_FILE_NAME);

	// If new path already exists, use it
	if (fs.existsSync(newPath)) {
		return newPath;
	}

	// Attempt one-time lazy migration from legacy location
	const legacyPath = getLegacyUsageFilePath();
	if (legacyPath && fs.existsSync(legacyPath)) {
		try {
			if (!fs.existsSync(appDataDir)) {
				fs.mkdirSync(appDataDir, {recursive: true});
			}

			try {
				fs.renameSync(legacyPath, newPath);
				logInfo(`Migrated usage data to new location: ${newPath}`);
			} catch (renameError) {
				// Fallback if rename/move fails: copy then best-effort delete
				logWarning(
					`Could not move usage file (${
						renameError instanceof Error ? renameError.message : 'unknown error'
					}), copying instead...`,
				);
				fs.copyFileSync(legacyPath, newPath);
				try {
					fs.unlinkSync(legacyPath);
					logInfo(`Successfully migrated usage data to: ${newPath}`);
				} catch {
					logWarning(
						`Migrated usage data to new location, but could not remove old file at ${legacyPath}. You may want to manually delete it.`,
					);
				}
			}

			return newPath;
		} catch (error) {
			// On any failure, fall through to using newPath without migration
			logWarning(
				`Failed to migrate usage data from ${legacyPath}: ${
					error instanceof Error ? error.message : 'unknown error'
				}. Old data remains at legacy location.`,
			);
		}
	}

	return newPath;
}

function ensureAppDataDir(): void {
	const appDataDir = getAppDataPath();
	if (!fs.existsSync(appDataDir)) {
		fs.mkdirSync(appDataDir, {recursive: true});
	}
}

function createEmptyUsageData(): UsageData {
	return {
		sessions: [],
		dailyAggregates: [],
		totalLifetime: 0,
		lastUpdated: Date.now(),
	};
}

export function readUsageData(): UsageData {
	try {
		const filePath = getUsageFilePath();

		if (!fs.existsSync(filePath)) {
			return createEmptyUsageData();
		}

		const content = fs.readFileSync(filePath, 'utf-8');
		const data = JSON.parse(content) as UsageData;

		return data;
	} catch (error) {
		logWarning('Failed to read usage data:', true, {
			context: {error},
		});
		return createEmptyUsageData();
	}
}

export function writeUsageData(data: UsageData): void {
	try {
		ensureAppDataDir();

		data.lastUpdated = Date.now();

		const filePath = getUsageFilePath();
		fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
	} catch (error) {
		logWarning('Failed to write usage data:', true, {
			context: {error},
		});
	}
}

export function addSession(session: SessionUsage): void {
	const data = readUsageData();

	// Add session to the beginning (most recent first)
	data.sessions.unshift(session);

	// Keep only last MAX_SESSIONS
	if (data.sessions.length > MAX_SESSIONS) {
		data.sessions = data.sessions.slice(0, MAX_SESSIONS);
	}

	// Update lifetime total
	data.totalLifetime += session.tokens.total;

	// Update daily aggregate
	updateDailyAggregate(data, session);

	writeUsageData(data);
}

function updateDailyAggregate(data: UsageData, session: SessionUsage): void {
	const dateParts = new Date(session.timestamp).toISOString().split('T');
	const dateStr = dateParts[0] || new Date().toISOString().split('T')[0] || '';

	// Find or create daily aggregate
	let dailyAggregate = data.dailyAggregates.find(agg => agg.date === dateStr);

	if (!dailyAggregate) {
		dailyAggregate = {
			date: dateStr,
			sessions: 0,
			totalTokens: 0,
			providers: {},
			models: {},
		};
		data.dailyAggregates.push(dailyAggregate);
	}

	// Update aggregate
	dailyAggregate.sessions += 1;
	dailyAggregate.totalTokens += session.tokens.total;

	// Update provider stats
	dailyAggregate.providers[session.provider] =
		(dailyAggregate.providers[session.provider] || 0) + session.tokens.total;

	// Update model stats
	dailyAggregate.models[session.model] =
		(dailyAggregate.models[session.model] || 0) + session.tokens.total;

	// Sort by date (newest first) and keep only last MAX_DAILY_AGGREGATES
	data.dailyAggregates.sort((a, b) => b.date.localeCompare(a.date));
	if (data.dailyAggregates.length > MAX_DAILY_AGGREGATES) {
		data.dailyAggregates = data.dailyAggregates.slice(0, MAX_DAILY_AGGREGATES);
	}
}

export function getTodayAggregate(): DailyAggregate | null {
	const data = readUsageData();
	const todayParts = new Date().toISOString().split('T');
	const today = todayParts[0] || '';

	return data.dailyAggregates.find(agg => agg.date === today) || null;
}

export function getLastNDaysAggregate(days: number): {
	totalTokens: number;
	totalSessions: number;
	avgTokensPerDay: number;
} {
	const data = readUsageData();
	const cutoffDate = new Date();
	cutoffDate.setDate(cutoffDate.getDate() - days);
	const cutoffParts = cutoffDate.toISOString().split('T');
	const cutoffStr = cutoffParts[0] || '';

	const relevantAggregates = data.dailyAggregates.filter(
		agg => agg.date >= cutoffStr,
	);

	const totalTokens = relevantAggregates.reduce(
		(sum, agg) => sum + agg.totalTokens,
		0,
	);
	const totalSessions = relevantAggregates.reduce(
		(sum, agg) => sum + agg.sessions,
		0,
	);

	return {
		totalTokens,
		totalSessions,
		avgTokensPerDay: Math.round(totalTokens / (days || 1)),
	};
}

/**
 * Clear all usage data
 */
export function clearUsageData(): void {
	try {
		const filePath = getUsageFilePath();
		if (fs.existsSync(filePath)) {
			fs.unlinkSync(filePath);
		}
	} catch (error) {
		logWarning('Failed to clear usage data:', true, {
			context: {error},
		});
	}
}
