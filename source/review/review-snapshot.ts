import {createHash} from 'node:crypto';
import {copyFile, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {structuredPatch} from 'diff';
import type {ReviewActivityStore} from './review-activity';
import {
	defaultReviewFoundationTools,
	type ReviewFoundationTools,
	throwIfReviewAborted,
	trackReviewOperation,
} from './review-tools';

export type ReviewScopeKind =
	| 'branch'
	| 'recent-commits'
	| 'pull-request'
	| 'working-tree';

export interface ReviewSnapshotScope {
	kind: ReviewScopeKind;
	description: string;
	commitCount?: number;
}

export interface ReviewLineMap {
	changedBaseLines: number[];
	changedHeadLines: number[];
}

export interface ReviewFileSnapshot {
	path: string;
	status: 'added' | 'modified' | 'deleted';
	baseContent: string | null;
	headContent: string | null;
	isBinary: boolean;
	lineMap: ReviewLineMap;
}

export interface ReviewTargetSnapshot {
	repositoryRoot: string;
	remoteRepository?: string;
	baseTipOid?: string;
	baseOid: string;
	headOid: string;
	headKind: 'commit' | 'working-tree';
	headDigest?: string;
	scope: ReviewSnapshotScope;
	files: ReviewFileSnapshot[];
	capturedAt: number;
}

export interface ReviewSnapshotDependencies {
	tools?: ReviewFoundationTools;
	activity: ReviewActivityStore;
	signal?: AbortSignal;
	now?: () => number;
}

export interface TemporaryReviewRefSet {
	fetch: (
		remote: string,
		sourceRef: string,
		expectedOid?: string,
	) => Promise<string>;
}

export interface ReviewChangedPath {
	path: string;
	status: 'added' | 'modified' | 'deleted';
}

const REVIEW_REF_ROOT = 'refs/nanocoder/review';
const MAX_REVIEW_FILES = 250;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_FILE_BYTES = 5 * 1024 * 1024;
const MAX_SKIPPED_NAMES_SHOWN = 5;

// Untracked files that usually hold credentials. Working-tree snapshots leave
// them out so their contents are never hashed or shown to a model. Committed
// files are reviewed as they are.
const SECRET_FILE_PATTERNS = [
	/(?:^|\/)\.env(?:\.[^/]+)?$/i,
	/(?:^|\/)\.(?:netrc|npmrc)$/i,
	/(?:^|\/)id_(?:rsa|ed25519)[^/]*$/i,
	/\.(?:pem|key|p12|pfx|keystore)$/i,
	/(?:^|\/)\.aws\/credentials$/i,
];
const SECRET_FILE_TEMPLATE = /(?:^|\/)\.env\.example$/i;

function assertOid(oid: string): string {
	if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(oid)) {
		throw new Error(
			'Git returned an invalid revision ID; the review scope was not pinned.',
		);
	}
	return oid.toLowerCase();
}

export function assertSafeReviewPath(path: string): void {
	if (
		!path ||
		path.includes('\0') ||
		path.includes('\\') ||
		path.startsWith('/') ||
		/^[A-Za-z]:/.test(path) ||
		path.split('/').some(part => part === '..' || part === '')
	) {
		throw new Error(
			'Git returned an unsafe repository path; no files were read.',
		);
	}
}

function parseNameStatusZ(output: string): ReviewChangedPath[] {
	const values = output.split('\0');
	const changed: ReviewChangedPath[] = [];
	for (let index = 0; index < values.length; ) {
		const status = values[index++];
		if (!status) continue;
		if (status.startsWith('R') || status.startsWith('C')) {
			index += 2;
			continue;
		}
		const path = values[index++];
		if (!path) continue;
		assertSafeReviewPath(path);
		if (status === 'A') {
			changed.push({path, status: 'added'});
		} else if (status === 'D') {
			changed.push({path, status: 'deleted'});
		} else {
			changed.push({path, status: 'modified'});
		}
	}
	return changed;
}

function decodeText(buffer: Buffer): string | null {
	if (buffer.includes(0)) return null;
	try {
		return new TextDecoder('utf-8', {fatal: true}).decode(buffer);
	} catch {
		return null;
	}
}

const ABSENT = {content: null, size: 0} as const;

function mapChangedLines(
	baseContent: string | null,
	headContent: string | null,
): ReviewLineMap {
	const patch = structuredPatch(
		'file',
		'file',
		baseContent ?? '',
		headContent ?? '',
		undefined,
		undefined,
		{context: 0},
	);
	const changedBaseLines: number[] = [];
	const changedHeadLines: number[] = [];
	for (const hunk of patch.hunks) {
		let baseLine = hunk.oldStart;
		let headLine = hunk.newStart;
		for (const line of hunk.lines) {
			if (line.startsWith('-')) {
				changedBaseLines.push(baseLine++);
			} else if (line.startsWith('+')) {
				changedHeadLines.push(headLine++);
			} else if (line.startsWith(' ')) {
				baseLine++;
				headLine++;
			}
		}
	}
	return {changedBaseLines, changedHeadLines};
}

function makeSnapshot(
	repositoryRoot: string,
	baseOid: string,
	headOid: string,
	headKind: ReviewTargetSnapshot['headKind'],
	scope: ReviewSnapshotScope,
	files: ReviewFileSnapshot[],
	now: () => number,
	headDigest?: string,
	remoteRepository?: string,
	baseTipOid?: string,
): ReviewTargetSnapshot {
	return {
		repositoryRoot,
		...(remoteRepository ? {remoteRepository} : {}),
		...(baseTipOid ? {baseTipOid: assertOid(baseTipOid)} : {}),
		baseOid: assertOid(baseOid),
		headOid: assertOid(headOid),
		headKind,
		...(headDigest ? {headDigest} : {}),
		scope,
		files,
		capturedAt: now(),
	};
}

async function getRepositoryRoot(
	tools: ReviewFoundationTools,
	activity: ReviewActivityStore,
	signal?: AbortSignal,
): Promise<string> {
	return trackReviewOperation(
		activity,
		'tool',
		'git',
		['rev-parse', '--show-toplevel'],
		'Locating the repository root',
		signal,
		() => tools.execGit(['rev-parse', '--show-toplevel'], signal),
	);
}

async function readBlob(
	treeish: string,
	path: string,
	dependencies: ReviewSnapshotDependencies,
): Promise<{content: string | null; size: number}> {
	const tools = dependencies.tools ?? defaultReviewFoundationTools;
	const objectName = `${assertOid(treeish)}:${path}`;
	const objectType = await trackReviewOperation(
		dependencies.activity,
		'tool',
		'git',
		['cat-file', '-t', objectName],
		'Checking changed-file object type',
		dependencies.signal,
		() => tools.execGit(['cat-file', '-t', objectName], dependencies.signal),
	);
	// Submodule entries are commits, not blobs; there is no content to read.
	if (objectType !== 'blob') return {content: null, size: 0};
	const sizeText = await trackReviewOperation(
		dependencies.activity,
		'tool',
		'git',
		['cat-file', '-s', objectName],
		'Checking changed-file size',
		dependencies.signal,
		() => tools.execGit(['cat-file', '-s', objectName], dependencies.signal),
	);
	const size = Number(sizeText);
	if (!Number.isSafeInteger(size) || size < 0) {
		throw new Error('Git returned an invalid changed-file size.');
	}
	if (size > MAX_FILE_BYTES) {
		throw new Error(
			`Changed file "${path}" exceeds the ${MAX_FILE_BYTES / 1024} KiB snapshot limit; no review was started.`,
		);
	}
	const bytes = await trackReviewOperation(
		dependencies.activity,
		'tool',
		'git',
		['cat-file', 'blob', objectName],
		'Reading changed-file content from the pinned revision',
		dependencies.signal,
		() =>
			tools.execGitBuffer(
				['cat-file', 'blob', objectName],
				dependencies.signal,
			),
	);
	return {content: decodeText(bytes), size};
}

/**
 * Read every changed file between two pinned tree-ish IDs (commits or trees).
 * Limits fail the whole snapshot rather than returning a partial scope.
 */
async function readChangedFiles(
	baseOid: string,
	headTreeish: string,
	dependencies: ReviewSnapshotDependencies,
): Promise<ReviewFileSnapshot[]> {
	const tools = dependencies.tools ?? defaultReviewFoundationTools;
	const diffArgs = [
		'diff',
		'--name-status',
		'-z',
		'--no-renames',
		'--no-ext-diff',
		'--no-color',
		baseOid,
		headTreeish,
		'--',
	];
	const nameStatus = await trackReviewOperation(
		dependencies.activity,
		'tool',
		'git',
		diffArgs,
		'Finding changed files between pinned revisions',
		dependencies.signal,
		() => tools.execGitBuffer(diffArgs, dependencies.signal),
	);
	const changed = parseNameStatusZ(nameStatus.toString('utf8'));
	if (changed.length > MAX_REVIEW_FILES) {
		throw new Error(
			`Review scope has ${changed.length} files; the safe snapshot limit is ${MAX_REVIEW_FILES}. Narrow the requested scope.`,
		);
	}
	const files: ReviewFileSnapshot[] = [];
	let totalBytes = 0;
	for (const file of changed) {
		throwIfReviewAborted(dependencies.signal);
		const base =
			file.status === 'added'
				? ABSENT
				: await readBlob(baseOid, file.path, dependencies);
		const head =
			file.status === 'deleted'
				? ABSENT
				: await readBlob(headTreeish, file.path, dependencies);
		totalBytes += base.size + head.size;
		if (totalBytes > MAX_TOTAL_FILE_BYTES) {
			throw new Error(
				`Review snapshot exceeds the ${MAX_TOTAL_FILE_BYTES / 1024 / 1024} MiB content limit; narrow the requested scope.`,
			);
		}
		const isBinary =
			(base.content === null && base.size > 0) ||
			(head.content === null && head.size > 0);
		const baseContent = isBinary ? null : base.content;
		const headContent = isBinary ? null : head.content;
		files.push({
			path: file.path,
			status: file.status,
			baseContent,
			headContent,
			isBinary,
			lineMap: mapChangedLines(baseContent, headContent),
		});
	}
	throwIfReviewAborted(dependencies.signal);
	return files;
}

export async function createCommitSnapshot(
	input: {
		baseOid: string;
		headOid: string;
		scope: ReviewSnapshotScope;
		remoteRepository?: string;
		baseTipOid?: string;
	},
	dependencies: ReviewSnapshotDependencies,
): Promise<ReviewTargetSnapshot> {
	const tools = dependencies.tools ?? defaultReviewFoundationTools;
	throwIfReviewAborted(dependencies.signal);
	const baseOid = assertOid(input.baseOid);
	const headOid = assertOid(input.headOid);
	const repositoryRoot = await getRepositoryRoot(
		tools,
		dependencies.activity,
		dependencies.signal,
	);
	const files = await readChangedFiles(baseOid, headOid, dependencies);
	return makeSnapshot(
		repositoryRoot,
		baseOid,
		headOid,
		'commit',
		input.scope,
		files,
		dependencies.now ?? Date.now,
		undefined,
		input.remoteRepository,
		input.baseTipOid,
	);
}

function looksLikeSecretFile(path: string): boolean {
	return (
		!SECRET_FILE_TEMPLATE.test(path) &&
		SECRET_FILE_PATTERNS.some(pattern => pattern.test(path))
	);
}

async function findSecretLookingUntrackedFiles(
	repositoryRoot: string,
	dependencies: ReviewSnapshotDependencies,
): Promise<string[]> {
	const tools = dependencies.tools ?? defaultReviewFoundationTools;
	const listArgs = [
		'-C',
		repositoryRoot,
		'ls-files',
		'-z',
		'--others',
		'--exclude-standard',
	];
	const untracked = await trackReviewOperation(
		dependencies.activity,
		'tool',
		'git',
		listArgs,
		'Listing untracked files',
		dependencies.signal,
		() => tools.execGit(listArgs, dependencies.signal),
	);
	const skipped = untracked.split('\0').filter(looksLikeSecretFile);
	if (skipped.length > 0) {
		const shown = skipped.slice(0, MAX_SKIPPED_NAMES_SHOWN).join(', ');
		const hidden = skipped.length - MAX_SKIPPED_NAMES_SHOWN;
		// Avoid "secret:" in the text; activity redaction treats what follows
		// it as a secret value and would hide the file names.
		const label = skipped.length === 1 ? 'file' : 'files';
		dependencies.activity
			.begin({
				source: 'review',
				name: 'Skip secret-looking files',
				summary: `Skipped ${skipped.length} untracked ${label} that may contain secrets: ${shown}${hidden > 0 ? ` and ${hidden} more` : ''}`,
			})
			.complete();
	}
	return skipped;
}

/**
 * Record the worktree (tracked changes plus untracked, non-ignored files) as a
 * Git tree through a throwaway index, so the real index and files are never
 * touched and the review reads one pinned tree like any commit review.
 * Untracked files that look like secrets are left out and reported by name.
 */
async function writeWorkingTree(
	repositoryRoot: string,
	dependencies: ReviewSnapshotDependencies,
): Promise<string> {
	const tools = dependencies.tools ?? defaultReviewFoundationTools;
	const indexArgs = [
		'rev-parse',
		'--path-format=absolute',
		'--git-path',
		'index',
	];
	const realIndex = await tools.execGit(indexArgs, dependencies.signal);
	const directory = await mkdtemp(join(tmpdir(), 'nanocoder-review-index-'));
	const scratchIndex = join(directory, 'index');
	try {
		// Starting from a copy keeps Git's stat cache, so unchanged files are
		// not re-hashed. A repository without an index starts empty.
		await copyFile(realIndex, scratchIndex).catch((error: unknown) => {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
			dependencies.activity
				.begin({
					source: 'review',
					name: 'Copy Git index',
					summary: 'Copying the Git index into a scratch index',
				})
				.fail(
					error,
					'Could not copy the Git index; recording the worktree from an empty index instead',
				);
		});
		const skipped = await findSecretLookingUntrackedFiles(
			repositoryRoot,
			dependencies,
		);
		// A pathspec file keeps long skip lists off the command line, and
		// literal magic stops names like `a*.pem` from matching other files.
		const pathspecFile = join(directory, 'pathspec');
		await writeFile(
			pathspecFile,
			['.', ...skipped.map(path => `:(exclude,literal)${path}`)]
				.map(pathspec => `${pathspec}\0`)
				.join(''),
		);
		const env = {GIT_INDEX_FILE: scratchIndex};
		const addArgs = [
			'-C',
			repositoryRoot,
			'add',
			'--all',
			`--pathspec-from-file=${pathspecFile}`,
			'--pathspec-file-nul',
		];
		await trackReviewOperation(
			dependencies.activity,
			'tool',
			'git',
			addArgs,
			'Recording worktree changes in a scratch index',
			dependencies.signal,
			() => tools.execGit(addArgs, dependencies.signal, env),
		);
		return assertOid(
			await trackReviewOperation(
				dependencies.activity,
				'tool',
				'git',
				['write-tree'],
				'Pinning the worktree as a tree ID',
				dependencies.signal,
				() => tools.execGit(['write-tree'], dependencies.signal, env),
			),
		);
	} finally {
		await rm(directory, {recursive: true, force: true});
	}
}

export async function createWorkingTreeSnapshot(
	input: {
		scope: ReviewSnapshotScope;
	},
	dependencies: ReviewSnapshotDependencies,
): Promise<ReviewTargetSnapshot> {
	const tools = dependencies.tools ?? defaultReviewFoundationTools;
	throwIfReviewAborted(dependencies.signal);
	const repositoryRoot = await getRepositoryRoot(
		tools,
		dependencies.activity,
		dependencies.signal,
	);
	const headOid = assertOid(
		await trackReviewOperation(
			dependencies.activity,
			'tool',
			'git',
			['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}'],
			'Pinning the worktree base revision',
			dependencies.signal,
			() =>
				tools.execGit(
					['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}'],
					dependencies.signal,
				),
		),
	);
	const treeOid = await writeWorkingTree(repositoryRoot, dependencies);
	const files = await readChangedFiles(headOid, treeOid, dependencies);
	return makeSnapshot(
		repositoryRoot,
		headOid,
		headOid,
		'working-tree',
		input.scope,
		files,
		dependencies.now ?? Date.now,
		treeOid,
	);
}

/**
 * Fetch remote revisions into fixed refs named after their source, so a
 * rerun overwrites the same ref and two concurrent reviews of different
 * targets can never read each other's tips. The refs are removed afterwards
 * on a best-effort basis; one left behind by a crash is overwritten next run.
 */
export async function withTemporaryReviewRefs<T>(
	dependencies: ReviewSnapshotDependencies,
	operation: (refs: TemporaryReviewRefSet) => Promise<T>,
): Promise<T> {
	const tools = dependencies.tools ?? defaultReviewFoundationTools;
	throwIfReviewAborted(dependencies.signal);
	const createdRefs = new Set<string>();
	const refs: TemporaryReviewRefSet = {
		fetch: async (remote, sourceRef, expectedOid) => {
			throwIfReviewAborted(dependencies.signal);
			if (
				!sourceRef.startsWith('refs/') ||
				sourceRef.includes('\0') ||
				sourceRef.includes('..')
			) {
				throw new Error('Remote revision name is not a valid ref.');
			}
			await tools.execGit(['check-ref-format', sourceRef], dependencies.signal);
			const remoteKey = createHash('sha256')
				.update(remote)
				.digest('hex')
				.slice(0, 12);
			const destinationRef = `${REVIEW_REF_ROOT}/${remoteKey}/${sourceRef.slice('refs/'.length)}`;
			createdRefs.add(destinationRef);
			const fetchArgs = [
				'fetch',
				'--no-tags',
				'--no-write-fetch-head',
				'--no-recurse-submodules',
				'--refmap=',
				'--',
				remote,
				`+${sourceRef}:${destinationRef}`,
			];
			await trackReviewOperation(
				dependencies.activity,
				'tool',
				'git fetch',
				fetchArgs,
				'Fetching a pinned remote revision without checkout',
				dependencies.signal,
				() => tools.execGit(fetchArgs, dependencies.signal),
			);
			const verifyArgs = [
				'rev-parse',
				'--verify',
				'--end-of-options',
				`${destinationRef}^{commit}`,
			];
			const oid = assertOid(
				await trackReviewOperation(
					dependencies.activity,
					'tool',
					'git rev-parse',
					verifyArgs,
					'Verifying the fetched revision ID',
					dependencies.signal,
					() => tools.execGit(verifyArgs, dependencies.signal),
				),
			);
			if (expectedOid && oid !== assertOid(expectedOid)) {
				throw new Error(
					'The remote ref changed while the review snapshot was being pinned. Retry after the remote settles.',
				);
			}
			return oid;
		},
	};

	try {
		return await operation(refs);
	} finally {
		for (const ref of createdRefs) {
			await tools.execGit(['update-ref', '-d', ref]).catch(() => undefined);
		}
	}
}
