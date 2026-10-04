import type {Dirent} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {getAppDataPath} from '@/config/paths';
import {
	readSessionConfigReadOnly,
	type SessionConfig,
} from '@/config/session-config';
import {
	MAX_TIMELINE_ENTRIES,
	MAX_TIMELINE_SESSION_AGE_MS,
	MAX_TIMELINE_SESSIONS,
} from '@/constants';
import {isValidSessionId} from '@/session/session-id';
import {getSessionsDirectory} from '@/session/session-paths';
import {
	isValidSession,
	isValidSessionMetadata,
} from '@/session/session-validation';

export interface StorageFinding {
	code: string;
	message: string;
	path?: string;
	severity: 'warning' | 'error';
}

export interface StorageItem {
	name: string;
	path: string;
	sizeBytes: number;
	modifiedAt?: string;
	ageDays?: number;
	status: 'ok' | 'warning' | 'error';
	detail?: string;
}

export interface StorageSection {
	scope: 'global' | 'project';
	root: string;
	count: number;
	sizeBytes: number;
	items: StorageItem[];
	findings: StorageFinding[];
	limits?: Array<{label: string; value: string}>;
}

export interface StorageReport {
	version: 1;
	scannedAt: string;
	projectRoot: string;
	sections: {
		sessions: StorageSection;
		artifacts: StorageSection;
		timeline: StorageSection;
		checkpoints: StorageSection;
	};
}

interface ScanOptions {
	projectRoot?: string;
	appDataDir?: string;
	sessionsDir?: string;
	configDir?: string;
	now?: Date;
}

interface SessionScan {
	section: StorageSection;
	indexIds: Set<string>;
	indexReliable: boolean;
}

function section(
	scope: StorageSection['scope'],
	root: string,
	limits?: StorageSection['limits'],
): StorageSection {
	return {
		scope,
		root,
		count: 0,
		sizeBytes: 0,
		items: [],
		findings: [],
		...(limits ? {limits} : {}),
	};
}

function finding(
	store: StorageSection,
	code: string,
	message: string,
	filePath?: string,
	severity: StorageFinding['severity'] = 'warning',
): void {
	store.findings.push({
		code,
		message,
		...(filePath ? {path: filePath} : {}),
		severity,
	});
}

function isMissing(error: unknown): boolean {
	return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function unexpectedEntry(
	store: StorageSection,
	filePath: string,
	name: string,
): Promise<void> {
	const item: StorageItem = {
		name,
		path: filePath,
		sizeBytes: await fileBytes(filePath, store),
		status: 'warning',
		detail: 'Unexpected storage entry',
	};
	store.count++;
	store.sizeBytes += item.sizeBytes;
	store.items.push(item);
	finding(store, 'unexpected_entry', 'Unexpected storage entry', filePath);
}

async function directoryEntries(
	store: StorageSection,
): Promise<{entries: Dirent<string>[]; exists: boolean; readable: boolean}> {
	try {
		return {
			entries: await fs.readdir(store.root, {withFileTypes: true}),
			exists: true,
			readable: true,
		};
	} catch (error) {
		if (isMissing(error)) return {entries: [], exists: false, readable: true};
		finding(
			store,
			'directory_unreadable',
			`Cannot inspect storage directory: ${describe(error)}`,
			store.root,
			'error',
		);
		return {entries: [], exists: true, readable: false};
	}
}

/**
 * Sum logical file sizes, never traversing a symlink or leaving a store root.
 * Failures stay visible in the report rather than turning an incomplete scan
 * into a misleading "0 B".
 */
async function fileBytes(
	filePath: string,
	store: StorageSection,
): Promise<number> {
	const pending = [filePath];
	let total = 0;
	while (pending.length > 0) {
		const current = pending.pop() as string;
		try {
			const stat = await fs.lstat(current);
			if (stat.isSymbolicLink()) {
				finding(
					store,
					'symlink_skipped',
					'Symbolic link was not followed',
					current,
				);
			} else if (stat.isFile()) {
				total += stat.size;
			} else if (stat.isDirectory()) {
				const children = await fs.readdir(current);
				for (const name of children) pending.push(path.join(current, name));
			}
		} catch (error) {
			finding(
				store,
				'entry_unreadable',
				`Cannot measure entry: ${describe(error)}`,
				current,
				'error',
			);
		}
	}
	return total;
}

async function readJson(filePath: string): Promise<unknown> {
	const stat = await fs.lstat(filePath);
	if (!stat.isFile()) throw new Error('Not a regular file');
	return JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
}

/** Check each path component; lstat on the leaf alone would follow symlinked parents. */
async function checkSnapshotFile(
	root: string,
	relativePath: string,
): Promise<void> {
	if (path.isAbsolute(relativePath))
		throw new Error('Unsafe file snapshot path');
	const resolved = path.resolve(root, relativePath);
	const relative = path.relative(root, resolved);
	if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new Error('Unsafe file snapshot path');
	}
	if (!(await fs.lstat(root)).isDirectory()) {
		throw new Error('Not a regular snapshot directory');
	}
	let current = root;
	const parts = relative.split(path.sep);
	for (const [position, part] of parts.entries()) {
		current = path.join(current, part);
		const stat = await fs.lstat(current);
		if (stat.isSymbolicLink()) throw new Error('Symlinked snapshot path');
		if (position === parts.length - 1 ? !stat.isFile() : !stat.isDirectory()) {
			throw new Error('Not a regular snapshot file');
		}
	}
}

async function scanSessions(
	root: string,
	config: SessionConfig,
	scope: StorageSection['scope'],
): Promise<SessionScan> {
	const store = section(scope, root, [
		{label: 'Max saved sessions', value: String(config.maxSessions)},
		{label: 'Retention', value: `${config.retentionDays} days`},
	]);
	const {entries, exists, readable} = await directoryEntries(store);
	const indexPath = path.join(root, 'sessions.json');
	let indexReliable = false;
	const indexIds = new Set<string>();
	if (readable && exists) {
		try {
			const parsed = await readJson(indexPath);
			if (!Array.isArray(parsed)) throw new Error('Expected an array');
			indexReliable = true;
			for (const [position, entry] of parsed.entries()) {
				if (
					!isValidSessionMetadata(entry) ||
					!isValidSessionId(entry.id) ||
					indexIds.has(entry.id)
				) {
					indexReliable = false;
					finding(
						store,
						'index_entry_invalid',
						`Invalid or duplicate index entry at position ${position}`,
						indexPath,
						'error',
					);
				} else {
					indexIds.add(entry.id);
				}
			}
		} catch (error) {
			finding(
				store,
				isMissing(error) ? 'index_missing' : 'index_invalid',
				`Cannot read session index: ${describe(error)}`,
				indexPath,
				'error',
			);
		}
	}

	const diskIds = new Set<string>();
	for (const entry of entries) {
		const filePath = path.join(root, entry.name);
		if (entry.name === 'sessions.json') {
			store.sizeBytes += await fileBytes(filePath, store);
			continue;
		}
		if (!entry.name.endsWith('.json') || !entry.isFile()) {
			await unexpectedEntry(store, filePath, entry.name);
			continue;
		}
		const id = entry.name.slice(0, -'.json'.length);
		if (!isValidSessionId(id)) {
			const item: StorageItem = {
				name: entry.name,
				path: filePath,
				sizeBytes: await fileBytes(filePath, store),
				status: 'warning',
				detail: 'Unexpected session filename',
			};
			store.count++;
			store.sizeBytes += item.sizeBytes;
			store.items.push(item);
			finding(
				store,
				'session_filename_invalid',
				'Unexpected session filename',
				filePath,
			);
			continue;
		}
		store.count++;
		diskIds.add(id);
		const item: StorageItem = {
			name: entry.name,
			path: filePath,
			sizeBytes: await fileBytes(filePath, store),
			status: 'ok',
		};
		store.sizeBytes += item.sizeBytes;
		try {
			const stat = await fs.lstat(filePath);
			item.modifiedAt = stat.mtime.toISOString();
			const session = await readJson(filePath);
			if (!isValidSession(session) || session.id !== id) {
				throw new Error('Invalid session data or ID does not match filename');
			}
			item.detail = 'Valid session';
		} catch (error) {
			item.status = 'error';
			item.detail = 'Unreadable or invalid session';
			finding(
				store,
				'session_invalid',
				`Cannot read session: ${describe(error)}`,
				filePath,
				'error',
			);
		}
		if (indexReliable && item.status !== 'error' && !indexIds.has(id)) {
			item.status = 'warning';
			finding(
				store,
				'session_unindexed',
				'Session file is absent from index',
				filePath,
			);
		}
		store.items.push(item);
	}
	if (indexReliable) {
		for (const id of indexIds) {
			if (!diskIds.has(id)) {
				finding(
					store,
					'session_missing',
					`Indexed session ${id} has no file`,
					path.join(root, `${id}.json`),
					'error',
				);
			}
		}
	}
	return {section: store, indexIds, indexReliable};
}

async function scanArtifacts(
	root: string,
	sessions: SessionScan,
	now: Date,
): Promise<StorageSection> {
	const store = section('global', root);
	const {entries} = await directoryEntries(store);
	let unknownOwnership = false;
	for (const entry of entries) {
		const dir = path.join(root, entry.name);
		if (!entry.isDirectory()) {
			await unexpectedEntry(store, dir, entry.name);
			continue;
		}
		store.count++;
		const item: StorageItem = {
			name: entry.name,
			path: dir,
			sizeBytes: await fileBytes(dir, store),
			status: 'ok',
		};
		store.sizeBytes += item.sizeBytes;
		try {
			const stat = await fs.lstat(dir);
			item.modifiedAt = stat.mtime.toISOString();
			item.ageDays = Math.max(
				0,
				Math.floor((now.getTime() - stat.mtimeMs) / 86_400_000),
			);
			const marker = path.join(dir, '.ephemeral.json');
			let ephemeral = false;
			try {
				const data = await readJson(marker);
				ephemeral = true;
				const pid =
					data && typeof data === 'object' && 'pid' in data ? data.pid : null;
				if (typeof pid === 'number' && Number.isInteger(pid) && pid > 0) {
					try {
						process.kill(pid, 0);
					} catch (error) {
						if (
							error instanceof Error &&
							'code' in error &&
							error.code === 'ESRCH'
						) {
							item.status = 'warning';
							item.detail = 'Stale ephemeral session: process is not running';
							finding(store, 'artifact_ephemeral_stale', item.detail, dir);
						}
					}
				}
			} catch (error) {
				if (!isMissing(error)) throw error;
			}
			if (!isValidSessionId(entry.name)) {
				item.status = 'warning';
				item.detail = 'Unexpected artifact directory name';
				finding(store, 'artifact_name_invalid', item.detail, dir);
			} else if (ephemeral) {
				item.detail ??= 'Ephemeral session';
			} else if (sessions.indexIds.has(entry.name)) {
				item.detail = 'Saved session';
			} else if (!sessions.indexReliable) {
				item.detail = 'Ownership unknown: session index unavailable';
				unknownOwnership = true;
			} else if (now.getTime() - stat.mtimeMs < 24 * 60 * 60 * 1000) {
				item.detail = 'Unassociated, within 24-hour grace period';
			} else {
				item.status = 'warning';
				item.detail = 'Potential orphan: no saved session';
				finding(store, 'artifact_unassociated', item.detail, dir);
			}
		} catch (error) {
			item.status = 'error';
			finding(store, 'artifact_unreadable', describe(error), dir, 'error');
		}
		store.items.push(item);
	}
	if (unknownOwnership) {
		finding(
			store,
			'ownership_unknown',
			'Session index unavailable; artifact ownership cannot be determined',
			store.root,
		);
	}
	return store;
}

async function scanTimeline(root: string, now: Date): Promise<StorageSection> {
	const store = section('project', root, [
		{label: 'Session limit', value: String(MAX_TIMELINE_SESSIONS)},
		{
			label: 'Maximum age',
			value: `${Math.round(MAX_TIMELINE_SESSION_AGE_MS / 86_400_000)} days`,
		},
		{label: 'Entries per session', value: String(MAX_TIMELINE_ENTRIES)},
	]);
	const {entries} = await directoryEntries(store);
	const dirs: Array<{name: string; dir: string; mtimeMs: number}> = [];
	for (const entry of entries) {
		const dir = path.join(root, entry.name);
		if (!entry.isDirectory()) {
			await unexpectedEntry(store, dir, entry.name);
			continue;
		}
		try {
			const stat = await fs.lstat(dir);
			dirs.push({name: entry.name, dir, mtimeMs: stat.mtimeMs});
		} catch (error) {
			finding(store, 'timeline_unreadable', describe(error), dir, 'error');
		}
	}
	dirs.sort((a, b) => b.mtimeMs - a.mtimeMs);
	for (const {name, dir, mtimeMs} of dirs) {
		const item: StorageItem = {
			name,
			path: dir,
			sizeBytes: await fileBytes(dir, store),
			modifiedAt: new Date(mtimeMs).toISOString(),
			status: 'ok',
		};
		store.count++;
		store.sizeBytes += item.sizeBytes;
		try {
			const index = await readJson(path.join(dir, 'timeline.json'));
			if (
				!index ||
				typeof index !== 'object' ||
				!('entries' in index) ||
				!Array.isArray(index.entries) ||
				!('nextSeq' in index) ||
				typeof index.nextSeq !== 'number'
			) {
				throw new Error('Invalid timeline index');
			}
			item.detail = `${index.entries.length} entries`;
			if (index.entries.length > MAX_TIMELINE_ENTRIES) {
				item.status = 'warning';
				finding(
					store,
					'timeline_over_limit',
					'Timeline exceeds entry limit',
					dir,
				);
			}
		} catch (error) {
			item.status = 'error';
			finding(
				store,
				'timeline_index_invalid',
				`Cannot read timeline index: ${describe(error)}`,
				path.join(dir, 'timeline.json'),
				'error',
			);
		}
		if (now.getTime() - mtimeMs > MAX_TIMELINE_SESSION_AGE_MS) {
			if (item.status === 'ok') item.status = 'warning';
			finding(
				store,
				'timeline_retention_threshold',
				'Past automatic retention threshold; this does not prove the session is inactive',
				dir,
			);
		}
		store.items.push(item);
	}
	if (dirs.length > MAX_TIMELINE_SESSIONS) {
		finding(
			store,
			'timeline_retention_threshold',
			'Timeline directory count exceeds the configured limit; active sessions may be exempt',
			root,
		);
	}
	return store;
}

async function scanCheckpoints(root: string): Promise<StorageSection> {
	const store = section('project', root);
	const {entries} = await directoryEntries(store);
	for (const entry of entries) {
		const dir = path.join(root, entry.name);
		if (!entry.isDirectory()) {
			await unexpectedEntry(store, dir, entry.name);
			continue;
		}
		const item: StorageItem = {
			name: entry.name,
			path: dir,
			sizeBytes: await fileBytes(dir, store),
			status: 'ok',
		};
		store.count++;
		store.sizeBytes += item.sizeBytes;
		try {
			item.modifiedAt = (await fs.lstat(dir)).mtime.toISOString();
			const metadata = await readJson(path.join(dir, 'metadata.json'));
			const conversation = await readJson(path.join(dir, 'conversation.json'));
			if (
				!metadata ||
				typeof metadata !== 'object' ||
				!('name' in metadata) ||
				typeof metadata.name !== 'string' ||
				!('timestamp' in metadata) ||
				typeof metadata.timestamp !== 'string' ||
				!('messageCount' in metadata) ||
				typeof metadata.messageCount !== 'number' ||
				!('filesChanged' in metadata) ||
				!Array.isArray(metadata.filesChanged) ||
				!conversation ||
				typeof conversation !== 'object' ||
				!('messages' in conversation) ||
				!Array.isArray(conversation.messages)
			) {
				throw new Error('Invalid checkpoint metadata or conversation');
			}
			item.detail = `${metadata.messageCount} messages`;
			const filesRoot = path.join(dir, 'files');
			for (const relativePath of metadata.filesChanged) {
				if (typeof relativePath !== 'string') {
					throw new Error('Invalid file snapshot path');
				}
				const resolved = path.resolve(filesRoot, relativePath);
				const relative = path.relative(filesRoot, resolved);
				if (
					path.isAbsolute(relativePath) ||
					!relative ||
					relative.startsWith('..') ||
					path.isAbsolute(relative)
				) {
					item.status = 'error';
					finding(
						store,
						'checkpoint_snapshot_unsafe',
						'Recorded snapshot path escapes the checkpoint',
						path.join(dir, 'metadata.json'),
						'error',
					);
					continue;
				}
				const filePath = path.resolve(filesRoot, relativePath);
				try {
					await checkSnapshotFile(filesRoot, relativePath);
				} catch (error) {
					item.status = 'warning';
					finding(
						store,
						'checkpoint_snapshot_missing',
						`Cannot read recorded snapshot: ${describe(error)}`,
						filePath,
					);
				}
			}
			if (
				('skippedFiles' in metadata &&
					Array.isArray(metadata.skippedFiles) &&
					metadata.skippedFiles.length > 0) ||
				('truncatedFileCount' in metadata &&
					typeof metadata.truncatedFileCount === 'number' &&
					metadata.truncatedFileCount > 0)
			) {
				item.status = 'warning';
				finding(
					store,
					'checkpoint_incomplete',
					'Checkpoint recorded skipped or truncated files at capture',
					dir,
				);
			}
		} catch (error) {
			item.status = 'error';
			finding(
				store,
				'checkpoint_invalid',
				`Cannot read checkpoint: ${describe(error)}`,
				dir,
				'error',
			);
		}
		store.items.push(item);
	}
	return store;
}

/** Inspect existing stores only. Never initialize managers: their reads can write or prune. */
export async function collectStorageReport(
	options: ScanOptions = {},
): Promise<StorageReport> {
	const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
	const appDataDir = path.resolve(options.appDataDir ?? getAppDataPath());
	const {config, errors} = readSessionConfigReadOnly(
		projectRoot,
		options.configDir,
	);
	const configuredDir = config.directory;
	const sessionsDir = path.resolve(
		projectRoot,
		options.sessionsDir ??
			(configuredDir
				? getSessionsDirectory(configuredDir)
				: path.join(appDataDir, 'sessions')),
	);
	const now = options.now ?? new Date();
	const sessions = await scanSessions(
		sessionsDir,
		config,
		configuredDir &&
			!path.isAbsolute(configuredDir) &&
			!configuredDir.startsWith('~')
			? 'project'
			: 'global',
	);
	for (const error of errors) {
		finding(
			sessions.section,
			'config_unreadable',
			`Cannot read session preferences: ${error.message}`,
			error.path,
			'error',
		);
	}
	if (errors.length > 0) sessions.indexReliable = false;
	return {
		version: 1,
		scannedAt: now.toISOString(),
		projectRoot,
		sections: {
			sessions: sessions.section,
			artifacts: await scanArtifacts(
				path.join(appDataDir, 'artifacts'),
				sessions,
				now,
			),
			timeline: await scanTimeline(
				path.join(projectRoot, '.nanocoder', 'timeline'),
				now,
			),
			checkpoints: await scanCheckpoints(
				path.join(projectRoot, '.nanocoder', 'checkpoints'),
			),
		},
	};
}
