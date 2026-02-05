/**
 * Git Utilities
 *
 * Shared utilities for git operations including command execution,
 * status parsing, and availability checks.
 */

import {execSync, spawn} from 'node:child_process';

/**
 * File change status from git
 */
export type FileChangeStatus =
	| 'added'
	| 'modified'
	| 'deleted'
	| 'renamed'
	| 'copied';

/**
 * Represents a single file change
 */
export interface FileChange {
	path: string;
	status: FileChangeStatus;
	oldPath?: string;
	additions: number;
	deletions: number;
	isBinary: boolean;
}

/**
 * Commit information
 */
export interface CommitInfo {
	hash: string;
	shortHash: string;
	author: string;
	email: string;
	date: string;
	relativeDate: string;
	subject: string;
	body: string;
	filesChanged?: number;
}

/**
 * Branch information
 */
export interface BranchInfo {
	name: string;
	current: boolean;
	upstream?: string;
	ahead: number;
	behind: number;
	lastCommit?: string;
}

/**
 * Stash entry
 */
export interface StashEntry {
	index: number;
	message: string;
	branch: string;
	date: string;
}

// ============================================================================
// Availability Checks (Synchronous - for conditional tool registration)
// ============================================================================

/**
 * Check if git is available on the system (synchronous)
 */
export function isGitAvailable(): boolean {
	try {
		execSync('git --version', {stdio: 'ignore'});
		return true;
	} catch {
		return false;
	}
}

/**
 * Check if gh CLI is available on the system (synchronous)
 */
export function isGhAvailable(): boolean {
	try {
		execSync('gh --version', {stdio: 'ignore'});
		return true;
	} catch {
		return false;
	}
}

// ============================================================================
// Git Command Execution
// ============================================================================

/**
 * Execute a git command and return the output
 */
export async function execGit(args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const proc = spawn('git', args);
		let stdout = '';
		let stderr = '';

		proc.stdout.on('data', (data: Buffer) => {
			stdout += data.toString();
		});

		proc.stderr.on('data', (data: Buffer) => {
			stderr += data.toString();
		});

		proc.on('close', (code: number | null) => {
			if (code === 0) {
				resolve(stdout.trimEnd());
			} else {
				const errorMessage =
					stderr.trim() || `Git command failed with exit code ${code}`;
				reject(new Error(errorMessage));
			}
		});

		proc.on('error', error => {
			reject(new Error(`Failed to execute git: ${error.message}`));
		});
	});
}

/**
 * Execute a gh CLI command and return the output
 */
export async function execGh(args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const proc = spawn('gh', args);
		let stdout = '';
		let stderr = '';

		proc.stdout.on('data', (data: Buffer) => {
			stdout += data.toString();
		});

		proc.stderr.on('data', (data: Buffer) => {
			stderr += data.toString();
		});

		proc.on('close', (code: number | null) => {
			if (code === 0) {
				resolve(stdout.trimEnd());
			} else {
				const errorMessage =
					stderr.trim() || `gh command failed with exit code ${code}`;
				reject(new Error(errorMessage));
			}
		});

		proc.on('error', error => {
			reject(new Error(`Failed to execute gh: ${error.message}`));
		});
	});
}

// ============================================================================
// Repository State Checks
// ============================================================================

/**
 * Check if there are uncommitted changes (staged or unstaged)
 */
export async function hasUncommittedChanges(): Promise<boolean> {
	try {
		const status = await execGit(['status', '--porcelain']);
		return status.trim().length > 0;
	} catch {
		return false;
	}
}

/**
 * Check if there are staged changes
 */
export async function hasStagedChanges(): Promise<boolean> {
	try {
		const diff = await execGit(['diff', '--cached', '--name-only']);
		return diff.trim().length > 0;
	} catch {
		return false;
	}
}

/**
 * Check if a rebase is in progress
 */
export async function isRebaseInProgress(): Promise<boolean> {
	try {
		await execGit(['rev-parse', '--git-path', 'rebase-merge']);
		const result = await execGit([
			'rev-parse',
			'--verify',
			'--quiet',
			'REBASE_HEAD',
		]);
		return result !== '';
	} catch {
		return false;
	}
}

/**
 * Check if a merge is in progress
 */
export async function isMergeInProgress(): Promise<boolean> {
	try {
		await execGit(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD']);
		return true;
	} catch {
		return false;
	}
}

// ============================================================================
// Branch Operations
// ============================================================================

/**
 * Get the current branch name
 */
export async function getCurrentBranch(): Promise<string> {
	try {
		return await execGit(['rev-parse', '--abbrev-ref', 'HEAD']);
	} catch {
		return 'HEAD'; // Detached HEAD state
	}
}

/**
 * Get the default branch (main or master)
 */
export async function getDefaultBranch(): Promise<string> {
	try {
		const remoteBranch = await execGit([
			'symbolic-ref',
			'refs/remotes/origin/HEAD',
			'--short',
		]);
		return remoteBranch.replace('origin/', '');
	} catch {
		// Fall back to checking if main or master exists
		try {
			await execGit(['rev-parse', '--verify', 'main']);
			return 'main';
		} catch {
			try {
				await execGit(['rev-parse', '--verify', 'master']);
				return 'master';
			} catch {
				return 'main';
			}
		}
	}
}

/**
 * Check if a branch exists
 */
export async function branchExists(name: string): Promise<boolean> {
	try {
		await execGit(['rev-parse', '--verify', `refs/heads/${name}`]);
		return true;
	} catch {
		return false;
	}
}

/**
 * Get the upstream branch for the current branch
 */
export async function getUpstreamBranch(): Promise<string | null> {
	try {
		return await execGit(['rev-parse', '--abbrev-ref', '@{upstream}']);
	} catch {
		return null;
	}
}

/**
 * Get ahead/behind counts relative to upstream
 */
export async function getAheadBehind(): Promise<{
	ahead: number;
	behind: number;
}> {
	try {
		const upstream = await getUpstreamBranch();
		if (!upstream) return {ahead: 0, behind: 0};

		const result = await execGit([
			'rev-list',
			'--left-right',
			'--count',
			`${upstream}...HEAD`,
		]);
		const [behind, ahead] = result.split('\t').map(n => parseInt(n, 10) || 0);
		return {ahead, behind};
	} catch {
		return {ahead: 0, behind: 0};
	}
}

/**
 * Get list of local branches
 */
export async function getLocalBranches(): Promise<BranchInfo[]> {
	try {
		const output = await execGit([
			'branch',
			'--format=%(refname:short)|%(upstream:short)|%(upstream:track,nobracket)|%(HEAD)',
		]);

		return output
			.split('\n')
			.filter(line => line.trim())
			.map(line => {
				const [name, upstream, track, head] = line.split('|');
				let ahead = 0;
				let behind = 0;

				if (track) {
					const aheadMatch = track.match(/ahead (\d+)/);
					const behindMatch = track.match(/behind (\d+)/);
					if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
					if (behindMatch) behind = parseInt(behindMatch[1], 10);
				}

				return {
					name: name || '',
					current: head === '*',
					upstream: upstream || undefined,
					ahead,
					behind,
				};
			});
	} catch {
		return [];
	}
}

/**
 * Get list of remote branches
 */
export async function getRemoteBranches(): Promise<string[]> {
	try {
		const output = await execGit(['branch', '-r', '--format=%(refname:short)']);
		return output
			.split('\n')
			.filter(line => line.trim() && !line.includes('HEAD'));
	} catch {
		return [];
	}
}

// ============================================================================
// Commit Operations
// ============================================================================

/**
 * Get unpushed commits (commits ahead of upstream)
 */
export async function getUnpushedCommits(): Promise<CommitInfo[]> {
	try {
		const upstream = await getUpstreamBranch();
		if (!upstream) return [];

		return await getCommits({range: `${upstream}..HEAD`});
	} catch {
		return [];
	}
}

/**
 * Check if the last commit has been pushed
 */
export async function isLastCommitPushed(): Promise<boolean> {
	try {
		const upstream = await getUpstreamBranch();
		if (!upstream) return false;

		const {ahead} = await getAheadBehind();
		return ahead === 0;
	} catch {
		return false;
	}
}

/**
 * Get commits with various filters
 */
export async function getCommits(options: {
	count?: number;
	range?: string;
	file?: string;
	author?: string;
	since?: string;
	grep?: string;
}): Promise<CommitInfo[]> {
	try {
		const args = ['log', '--format=%H|%h|%an|%ae|%ad|%ar|%s', '--date=short'];

		if (options.count) args.push(`-n`, options.count.toString());
		if (options.range) args.push(options.range);
		if (options.author) args.push(`--author=${options.author}`);
		if (options.since) args.push(`--since=${options.since}`);
		if (options.grep) args.push(`--grep=${options.grep}`);
		if (options.file) args.push('--', options.file);

		const output = await execGit(args);
		if (!output.trim()) return [];

		return output.split('\n').map(line => {
			const [hash, shortHash, author, email, date, relativeDate, subject] =
				line.split('|');
			return {
				hash: hash || '',
				shortHash: shortHash || '',
				author: author || '',
				email: email || '',
				date: date || '',
				relativeDate: relativeDate || '',
				subject: subject || '',
				body: '',
			};
		});
	} catch {
		return [];
	}
}

// ============================================================================
// Status Parsing
// ============================================================================

/**
 * Map git status character to FileChangeStatus
 */
function mapStatusChar(char: string): FileChangeStatus {
	switch (char) {
		case 'A':
			return 'added';
		case 'D':
			return 'deleted';
		case 'R':
			return 'renamed';
		case 'C':
			return 'copied';
		case 'M':
		default:
			return 'modified';
	}
}

/**
 * Parse git status --porcelain output
 */
export function parseGitStatus(statusOutput: string): {
	staged: FileChange[];
	unstaged: FileChange[];
	untracked: string[];
	conflicts: string[];
} {
	const staged: FileChange[] = [];
	const unstaged: FileChange[] = [];
	const untracked: string[] = [];
	const conflicts: string[] = [];

	const lines = statusOutput.split('\n').filter(line => line);

	for (const line of lines) {
		if (line.length < 3) continue;

		const indexStatus = line[0];
		const workTreeStatus = line[1];
		const path = line.slice(3);

		// Detect conflicts
		if (
			indexStatus === 'U' ||
			workTreeStatus === 'U' ||
			(indexStatus === 'A' && workTreeStatus === 'A') ||
			(indexStatus === 'D' && workTreeStatus === 'D')
		) {
			conflicts.push(path);
			continue;
		}

		// Untracked files
		if (indexStatus === '?' && workTreeStatus === '?') {
			untracked.push(path);
			continue;
		}

		// Staged changes
		if (indexStatus !== ' ' && indexStatus !== '?') {
			staged.push({
				path,
				status: mapStatusChar(indexStatus),
				additions: 0,
				deletions: 0,
				isBinary: false,
			});
		}

		// Unstaged changes
		if (workTreeStatus !== ' ' && workTreeStatus !== '?') {
			unstaged.push({
				path,
				status: mapStatusChar(workTreeStatus),
				additions: 0,
				deletions: 0,
				isBinary: false,
			});
		}
	}

	return {staged, unstaged, untracked, conflicts};
}

/**
 * Get diff stats for files (additions/deletions)
 */
export async function getDiffStats(
	staged: boolean = false,
): Promise<Map<string, {additions: number; deletions: number}>> {
	const stats = new Map<string, {additions: number; deletions: number}>();

	try {
		const args = ['diff', '--numstat'];
		if (staged) args.push('--cached');

		const output = await execGit(args);
		if (!output.trim()) return stats;

		for (const line of output.split('\n')) {
			const parts = line.split('\t');
			if (parts.length >= 3) {
				const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
				const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
				const path = parts[2];
				stats.set(path, {additions, deletions});
			}
		}
	} catch {
		// Ignore errors
	}

	return stats;
}

// ============================================================================
// Stash Operations
// ============================================================================

/**
 * Get list of stashes
 */
export async function getStashList(): Promise<StashEntry[]> {
	try {
		const output = await execGit(['stash', 'list', '--format=%gd|%gs|%cr']);
		if (!output.trim()) return [];

		return output.split('\n').map((line, index) => {
			const [ref, message, date] = line.split('|');
			const branchMatch = message?.match(/WIP on ([^:]+):/);
			return {
				index,
				message: message || ref || `stash@{${index}}`,
				branch: branchMatch?.[1] || 'unknown',
				date: date || '',
			};
		});
	} catch {
		return [];
	}
}

/**
 * Get stash count
 */
export async function getStashCount(): Promise<number> {
	try {
		const output = await execGit(['stash', 'list']);
		if (!output.trim()) return 0;
		return output.split('\n').length;
	} catch {
		return 0;
	}
}

// ============================================================================
// Remote Operations
// ============================================================================

/**
 * Check if a remote exists
 */
export async function remoteExists(name: string): Promise<boolean> {
	try {
		const remotes = await execGit(['remote']);
		return remotes.split('\n').includes(name);
	} catch {
		return false;
	}
}

// ============================================================================
// Diff Output Helpers
// ============================================================================

/**
 * Truncate diff output if too long
 */
export function truncateDiff(
	diff: string,
	maxLines: number = 500,
): {
	content: string;
	truncated: boolean;
	totalLines: number;
} {
	const lines = diff.split('\n');
	const totalLines = lines.length;

	if (totalLines <= maxLines) {
		return {content: diff, truncated: false, totalLines};
	}

	const truncatedContent = lines.slice(0, maxLines).join('\n');
	return {
		content:
			truncatedContent +
			`\n\n... [Diff truncated: showing ${maxLines} of ${totalLines} lines]`,
		truncated: true,
		totalLines,
	};
}

// ============================================================================
// Formatting Helpers
// ============================================================================

/**
 * Format file status character for display
 */
export function formatStatusChar(status: FileChangeStatus): string {
	switch (status) {
		case 'added':
			return 'A';
		case 'modified':
			return 'M';
		case 'deleted':
			return 'D';
		case 'renamed':
			return 'R';
		case 'copied':
			return 'C';
		default:
			return '?';
	}
}
