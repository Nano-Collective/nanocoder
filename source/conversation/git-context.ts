import {defineSessionValue} from '@/services/session-context';
import {getProjectRoot} from '@/services/session-cwd';
import {
	execGitReadOnlySync,
	getCurrentBranchSync,
	getDefaultBranchSync,
	isGitAvailable,
	parseGitStatus,
} from '@/tools/git/utils';
import {getLogger} from '@/utils/logging';

/**
 * A compact view of the repository taken when the session's system prompt is
 * first built, so the model's first answer already knows the branch, whether
 * the tree is dirty and what the last commits were, without a git tool call.
 */

const MAX_CHANGED_PATHS = 10;
const MAX_COMMITS = 5;
const MAX_LINE_LENGTH = 120;

export interface GitSnapshot {
	branch: string;
	detached: boolean;
	defaultBranch: string | null;
	upstream: string | null;
	upstreamGone: boolean;
	ahead: number;
	behind: number;
	/** null when `git status` could not be read (timeout, git error). */
	status: {
		staged: number;
		modified: number;
		untracked: number;
		conflicted: number;
		/** Porcelain lines (`XY path`), capped at MAX_CHANGED_PATHS. */
		paths: string[];
		totalPaths: number;
	} | null;
	/** `<short hash> <subject>`, newest first. */
	commits: string[];
}

function clip(line: string): string {
	return line.length > MAX_LINE_LENGTH
		? `${line.slice(0, MAX_LINE_LENGTH - 3)}...`
		: line;
}

/**
 * Parse the `## ...` header of `git status --porcelain --branch`, e.g.
 * `## main...origin/main [ahead 1, behind 2]` or `## topic...origin/topic [gone]`.
 */
export function parseBranchHeader(line: string): {
	upstream: string | null;
	upstreamGone: boolean;
	ahead: number;
	behind: number;
} {
	const header = line.replace(/^##\s*/, '');
	const upstreamMatch = header.match(/\.\.\.(\S+)/);
	const tracking = header.match(/\[([^\]]+)\]\s*$/)?.[1] ?? '';
	return {
		upstream: upstreamMatch ? upstreamMatch[1] : null,
		upstreamGone: tracking === 'gone',
		ahead: Number.parseInt(tracking.match(/ahead (\d+)/)?.[1] ?? '0', 10),
		behind: Number.parseInt(tracking.match(/behind (\d+)/)?.[1] ?? '0', 10),
	};
}

/**
 * Read a snapshot of the repository at `root`. Returns null when the folder
 * is not a git repository or git is not installed. Only local, read-only git
 * commands run (no fetch), each with a short timeout: a status that times out
 * on a huge repository is left out rather than delaying the session.
 */
export function readGitSnapshot(root: string): GitSnapshot | null {
	if (!isGitAvailable()) return null;
	const current = getCurrentBranchSync(root);
	if (!current) return null;

	const snapshot: GitSnapshot = {
		branch: current.branch,
		detached: current.detached,
		defaultBranch: getDefaultBranchSync(root),
		upstream: null,
		upstreamGone: false,
		ahead: 0,
		behind: 0,
		status: null,
		commits: [],
	};

	try {
		const output = execGitReadOnlySync(
			['status', '--porcelain', '--branch', '--untracked-files=normal'],
			{cwd: root},
		);
		const lines = output.split('\n');
		const header = lines[0]?.startsWith('##') ? lines.shift() : undefined;
		if (header) Object.assign(snapshot, parseBranchHeader(header));
		const changed = lines.filter(line => line.length >= 3);
		const {staged, unstaged, untracked, conflicts} = parseGitStatus(
			changed.join('\n'),
		);
		snapshot.status = {
			staged: staged.length,
			modified: unstaged.length,
			untracked: untracked.length,
			conflicted: conflicts.length,
			paths: changed.slice(0, MAX_CHANGED_PATHS).map(clip),
			totalPaths: changed.length,
		};
	} catch (error) {
		getLogger().debug('Git snapshot: status unavailable', {error});
	}

	try {
		const log = execGitReadOnlySync(
			['log', `-n${MAX_COMMITS}`, '--no-color', '--format=%h %s', '--'],
			{cwd: root},
		);
		snapshot.commits = log
			.split('\n')
			.filter(Boolean)
			.slice(0, MAX_COMMITS)
			.map(clip);
	} catch (error) {
		// A repository without commits yet fails here; leave the list empty.
		getLogger().debug('Git snapshot: log unavailable', {error});
	}

	return snapshot;
}

export function formatGitSnapshot(snapshot: GitSnapshot): string {
	const lines = [
		'## REPOSITORY SNAPSHOT',
		'',
		'Taken at session start; it may be stale. Re-check with git before acting on it.',
		'',
	];

	let branch = snapshot.detached
		? `detached HEAD at ${snapshot.branch}`
		: snapshot.branch;
	if (snapshot.defaultBranch && snapshot.defaultBranch !== snapshot.branch) {
		branch += ` (default branch: ${snapshot.defaultBranch})`;
	} else if (!snapshot.detached && snapshot.defaultBranch) {
		branch += ' (default branch)';
	}
	lines.push(`Branch: ${branch}`);

	if (snapshot.upstream) {
		const tracking = snapshot.upstreamGone
			? 'gone from the remote'
			: `${snapshot.ahead} ahead, ${snapshot.behind} behind`;
		lines.push(`Upstream: ${snapshot.upstream} (${tracking})`);
	} else if (!snapshot.detached) {
		lines.push('Upstream: none');
	}

	const status = snapshot.status;
	if (status) {
		if (status.totalPaths === 0) {
			lines.push('Working tree: clean');
		} else {
			const counts = [
				status.staged && `${status.staged} staged`,
				status.modified && `${status.modified} modified`,
				status.untracked && `${status.untracked} untracked`,
				status.conflicted && `${status.conflicted} conflicted`,
			].filter(Boolean);
			lines.push(`Working tree: ${counts.join(', ')}`);
			for (const path of status.paths) lines.push(`  ${path}`);
			const more = status.totalPaths - status.paths.length;
			if (more > 0) lines.push(`  ... and ${more} more`);
		}
	}

	if (snapshot.commits.length > 0) {
		lines.push('Recent commits:');
		for (const commit of snapshot.commits) lines.push(`  ${commit}`);
	}

	return lines.join('\n');
}

// The snapshot is taken once per session and per project root, so the system
// prompt stays byte-identical across turns (prompt caching) and git runs once.
const cachedSection = defineSessionValue<{root: string; section: string}>();

/**
 * The git snapshot prompt section for the current project root, or '' when it
 * is not a git repository. Computed on first use and reused for the session.
 */
export function getGitContextSection(): string {
	const root = getProjectRoot();
	const cached = cachedSection.get();
	if (cached && cached.root === root) return cached.section;

	let section = '';
	try {
		const snapshot = readGitSnapshot(root);
		section = snapshot ? formatGitSnapshot(snapshot) : '';
	} catch (error) {
		getLogger().debug('Git snapshot failed', {error});
	}
	cachedSection.set({root, section});
	return section;
}
