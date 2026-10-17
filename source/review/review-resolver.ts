import type {
	ReviewActivitySpan,
	ReviewActivityStore,
	ReviewActivitySummary,
} from './review-activity';
import {
	ReviewActivityStore as ActivityStore,
	sanitizeReviewActivityText,
} from './review-activity';
import {
	parseGitHubRepository,
	parseReviewRequest,
	type ReviewRequest,
} from './review-request';
import {
	createCommitSnapshot,
	createWorkingTreeSnapshot,
	type ReviewSnapshotScope,
	type ReviewTargetSnapshot,
	withTemporaryReviewRefs,
} from './review-snapshot';
import {
	defaultReviewFoundationTools,
	ReviewCancelledError,
	type ReviewFoundationTools,
	throwIfReviewAborted,
	trackReviewOperation,
} from './review-tools';

export type ReviewScopeResolution =
	| {
			status: 'ready';
			snapshot: ReviewTargetSnapshot;
			activity: ReviewActivitySummary;
	  }
	| {
			status: 'clarification';
			message: string;
			choices: string[];
			activity: ReviewActivitySummary;
	  }
	| {
			status: 'failed' | 'cancelled';
			message: string;
			activity: ReviewActivitySummary;
	  };

export interface ReviewResolverDependencies {
	tools?: ReviewFoundationTools;
	activity?: ReviewActivityStore;
	signal?: AbortSignal;
	now?: () => number;
}

interface LocalBranch {
	name: string;
	oid: string;
}

interface RemoteBranch {
	remote: string;
	name: string;
	oid: string;
}

type BranchCandidate =
	| {kind: 'local'; name: string; oid: string}
	| {kind: 'remote'; remote: string; name: string; oid: string};

interface RemoteInfo {
	name: string;
	url: string;
	repository: string | null;
}

interface PullRequestInfo {
	repository: string;
	number: string;
	headOid: string;
	headRef: string;
	headRepository: string;
	baseOid: string;
	baseRef: string;
	baseRepository: string;
}

interface DefaultBranchInfo {
	name: string;
	remote?: string;
	oid?: string;
}

class ReviewClarification extends Error {
	constructor(
		message: string,
		readonly choices: string[],
	) {
		super(message);
		this.name = 'ReviewClarification';
	}
}

function isSafeOid(value: string): boolean {
	return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value);
}

function isGitHubNotFound(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /\bHTTP 404\b|\bstatus(?: code)? 404\b|\bNot Found\b/i.test(message);
}

function scope(
	kind: ReviewSnapshotScope['kind'],
	description: string,
	commitCount?: number,
): ReviewSnapshotScope {
	return {
		kind,
		description,
		...(commitCount === undefined ? {} : {commitCount}),
	};
}

export function formatResolvedReviewScope(
	snapshot: ReviewTargetSnapshot,
): string {
	const description = sanitizeReviewActivityText(
		snapshot.scope.description,
		80,
	);
	const headDescription =
		snapshot.headKind === 'working-tree'
			? `working tree · tree ${snapshot.headDigest?.slice(0, 12) ?? 'unavailable'}`
			: snapshot.headOid.slice(0, 12);
	const baseTip =
		snapshot.baseTipOid && snapshot.baseTipOid !== snapshot.baseOid
			? ` (tip ${snapshot.baseTipOid.slice(0, 12)})`
			: '';
	return `Resolved scope: ${description} · base ${snapshot.baseOid.slice(0, 12)}${baseTip} · head ${headDescription} · ${snapshot.files.length} changed file${snapshot.files.length === 1 ? '' : 's'}`;
}

function splitLines(output: string): string[] {
	return output
		.split(/\r?\n/)
		.map(line => line.trim())
		.filter(Boolean);
}

function parseRefRows(
	output: string,
	prefix: string,
): Array<{name: string; oid: string}> {
	const branches: Array<{name: string; oid: string}> = [];
	for (const line of splitLines(output)) {
		const separator = line.indexOf('\0');
		if (separator < 0) continue;
		const fullRef = line.slice(0, separator);
		const oid = line.slice(separator + 1).trim();
		if (!fullRef.startsWith(prefix) || !isSafeOid(oid)) continue;
		branches.push({name: fullRef.slice(prefix.length), oid: oid.toLowerCase()});
	}
	return branches;
}

function parseRemoteNames(output: string): string[] {
	return [
		...new Set(splitLines(output).filter(name => !/[\0\r\n]/.test(name))),
	];
}

function validateRefName(name: string): string {
	if (
		!name ||
		name.startsWith('-') ||
		name.includes('\0') ||
		name.includes('\\') ||
		name.includes(':') ||
		/[\s~^:?*[\]]/.test(name)
	) {
		throw new Error(
			'Branch names must be exact Git refs; shell commands and path expressions are not accepted.',
		);
	}
	return name;
}

function parseLsRemote(output: string, branch: string): string | null {
	const expectedRef = `refs/heads/${branch}`;
	const matches = splitLines(output)
		.map(line => line.split(/\s+/, 2))
		.filter(
			([oid, ref]) => !!oid && !!ref && ref === expectedRef && isSafeOid(oid),
		)
		.map(([oid]) => oid?.toLowerCase())
		.filter((oid): oid is string => !!oid);
	return matches.length === 1 ? (matches[0] ?? null) : null;
}

function parsePullRequest(
	value: unknown,
	repository: string,
	number: string,
): PullRequestInfo {
	if (!value || typeof value !== 'object') {
		throw new Error(
			`GitHub returned invalid metadata for ${repository}#${number}.`,
		);
	}
	const pull = value as {
		head?: {
			sha?: unknown;
			ref?: unknown;
			repo?: {full_name?: unknown} | null;
		};
		base?: {
			sha?: unknown;
			ref?: unknown;
			repo?: {full_name?: unknown} | null;
		};
	};
	const headOid = pull.head?.sha;
	const headRef = pull.head?.ref;
	const headRepository = pull.head?.repo?.full_name;
	const baseOid = pull.base?.sha;
	const baseRef = pull.base?.ref;
	const baseRepository = pull.base?.repo?.full_name;
	if (
		typeof headOid !== 'string' ||
		!isSafeOid(headOid) ||
		typeof headRef !== 'string' ||
		typeof headRepository !== 'string' ||
		!parseGitHubRepository(`https://github.com/${headRepository}.git`) ||
		typeof baseOid !== 'string' ||
		!isSafeOid(baseOid) ||
		typeof baseRef !== 'string' ||
		typeof baseRepository !== 'string' ||
		!parseGitHubRepository(`https://github.com/${baseRepository}.git`)
	) {
		throw new Error(
			`GitHub returned incomplete revision data for ${repository}#${number}.`,
		);
	}
	validateRefName(headRef);
	validateRefName(baseRef);
	return {
		repository,
		number,
		headOid: headOid.toLowerCase(),
		headRef,
		headRepository,
		baseOid: baseOid.toLowerCase(),
		baseRef,
		baseRepository,
	};
}

async function git(
	args: string[],
	summary: string,
	tools: ReviewFoundationTools,
	activity: ReviewActivityStore,
	signal?: AbortSignal,
): Promise<string> {
	return trackReviewOperation(
		activity,
		'tool',
		'git',
		args,
		summary,
		signal,
		() => tools.execGit(args, signal),
	);
}

async function gh(
	args: string[],
	summary: string,
	tools: ReviewFoundationTools,
	activity: ReviewActivityStore,
	signal?: AbortSignal,
): Promise<string> {
	return trackReviewOperation(
		activity,
		'api',
		'gh api',
		args,
		summary,
		signal,
		() => tools.execGh(args, signal),
	);
}

async function getRemotes(
	tools: ReviewFoundationTools,
	activity: ReviewActivityStore,
	signal?: AbortSignal,
): Promise<RemoteInfo[]> {
	const names = parseRemoteNames(
		await git(
			['remote'],
			'Listing configured remotes',
			tools,
			activity,
			signal,
		),
	);
	const remotes: RemoteInfo[] = [];
	for (const name of names) {
		throwIfReviewAborted(signal);
		const url = await git(
			['remote', 'get-url', '--', name],
			'Reading a configured remote URL',
			tools,
			activity,
			signal,
		);
		remotes.push({name, url, repository: parseGitHubRepository(url)});
	}
	return remotes;
}

async function getLocalBranches(
	tools: ReviewFoundationTools,
	activity: ReviewActivityStore,
	signal?: AbortSignal,
): Promise<LocalBranch[]> {
	const output = await git(
		['for-each-ref', '--format=%(refname)%00%(objectname)', 'refs/heads/'],
		'Listing local branch candidates',
		tools,
		activity,
		signal,
	);
	return parseRefRows(output, 'refs/heads/').map(branch => ({
		name: branch.name,
		oid: branch.oid,
	}));
}

async function getRemoteBranches(
	remote: string,
	branchNames: string[],
	tools: ReviewFoundationTools,
	activity: ReviewActivityStore,
	signal?: AbortSignal,
): Promise<RemoteBranch[]> {
	const branches: RemoteBranch[] = [];
	for (const name of new Set(branchNames)) {
		throwIfReviewAborted(signal);
		validateRefName(name);
		const output = await git(
			['ls-remote', '--heads', '--', remote, `refs/heads/${name}`],
			'Checking an exact remote branch candidate',
			tools,
			activity,
			signal,
		);
		const oid = parseLsRemote(output, name);
		if (oid) branches.push({remote, name, oid});
	}
	return branches;
}

async function resolveBranchCandidate(
	request: Extract<ReviewRequest, {kind: 'branch'}>,
	remotes: RemoteInfo[],
	localBranches: LocalBranch[],
	tools: ReviewFoundationTools,
	activity: ReviewActivityStore,
	signal?: AbortSignal,
): Promise<BranchCandidate> {
	const reference = validateRefName(request.reference);
	const local = localBranches.find(branch => branch.name === reference);
	if (request.selection === 'local') {
		if (!local) {
			throw new ReviewClarification(
				`Local branch "${reference}" was not found.`,
				['Choose an existing local branch with `/review local:<name>`.'],
			);
		}
		return {kind: 'local', ...local};
	}

	const remoteSpecs: Array<{remote: string; name: string}> = [];
	for (const remote of remotes) {
		if (request.selection === 'remote') {
			const prefix = `${remote.name}/`;
			if (reference.startsWith(prefix)) {
				remoteSpecs.push({
					remote: remote.name,
					name: reference.slice(prefix.length),
				});
			} else if (
				!remotes.some(candidate => reference.startsWith(`${candidate.name}/`))
			) {
				remoteSpecs.push({remote: remote.name, name: reference});
			}
			continue;
		}

		remoteSpecs.push({remote: remote.name, name: reference});
		const prefix = `${remote.name}/`;
		if (reference.startsWith(prefix) && reference.length > prefix.length) {
			remoteSpecs.push({
				remote: remote.name,
				name: reference.slice(prefix.length),
			});
		}
	}

	const remoteBranches: RemoteBranch[] = [];
	try {
		for (const spec of remoteSpecs) {
			remoteBranches.push(
				...(await getRemoteBranches(
					spec.remote,
					[spec.name],
					tools,
					activity,
					signal,
				)),
			);
		}
	} catch (error) {
		throw new Error(
			`Could not verify configured remote branch candidates: ${sanitizeReviewActivityText(
				error instanceof Error ? error.message : String(error),
				180,
			)}. Check network access or select a local branch explicitly.`,
		);
	}

	const candidates: BranchCandidate[] = [];
	if (request.selection !== 'remote' && local) {
		candidates.push({kind: 'local', ...local});
	}
	for (const branch of remoteBranches) {
		if (
			!candidates.some(
				candidate =>
					candidate.kind === 'remote' &&
					candidate.remote === branch.remote &&
					candidate.name === branch.name,
			)
		) {
			candidates.push({kind: 'remote', ...branch});
		}
	}
	if (candidates.length === 0) {
		throw new ReviewClarification(
			`No matching branch named "${reference}" could be verified.`,
			[
				'Check the branch name and configured remotes.',
				'Use `/review local:<name>` or `/review remote:<remote>/<name>` to select explicitly.',
			],
		);
	}
	if (candidates.length > 1) {
		throw new ReviewClarification(
			`Branch "${reference}" matches more than one target.`,
			candidates.map(candidate =>
				candidate.kind === 'local'
					? `Local: ${candidate.name} (${candidate.oid.slice(0, 12)})`
					: `Remote: ${candidate.remote}/${candidate.name} (${candidate.oid.slice(0, 12)})`,
			),
		);
	}
	return candidates[0] as BranchCandidate;
}

async function getDefaultBranch(
	remotes: RemoteInfo[],
	preferredRemote: string | undefined,
	tools: ReviewFoundationTools,
	activity: ReviewActivityStore,
	signal?: AbortSignal,
): Promise<DefaultBranchInfo> {
	if (preferredRemote) {
		const selected = remotes.find(remote => remote.name === preferredRemote);
		if (!selected) {
			throw new Error(
				`The upstream remote "${preferredRemote}" is not configured; review scope cannot be verified.`,
			);
		}
		return defaultBranchFromRemote(selected, tools, activity, signal);
	}

	const configuredHeads: Array<{remote: RemoteInfo; name: string}> = [];
	for (const remote of remotes) {
		try {
			const symbolic = await git(
				['symbolic-ref', '--quiet', `refs/remotes/${remote.name}/HEAD`],
				'Checking the configured default branch',
				tools,
				activity,
				signal,
			);
			const prefix = `refs/remotes/${remote.name}/`;
			if (symbolic.startsWith(prefix)) {
				configuredHeads.push({remote, name: symbolic.slice(prefix.length)});
			}
		} catch {
			// Ask the server for its advertised HEAD below.
		}
	}
	if (configuredHeads.length === 1) {
		const head = configuredHeads[0];
		if (head)
			return defaultBranchFromRemote(
				head.remote,
				tools,
				activity,
				signal,
				head.name,
			);
	}
	if (configuredHeads.length > 1) {
		const branches = new Set(
			configuredHeads.map(head => `${head.remote.name}/${head.name}`),
		);
		throw new ReviewClarification(
			'Several remotes advertise different default branches; choose a branch or PR URL explicitly.',
			[...branches],
		);
	}
	if (remotes.length === 1) {
		const remote = remotes[0];
		if (remote) return defaultBranchFromRemote(remote, tools, activity, signal);
	}
	if (remotes.length > 1) {
		throw new ReviewClarification(
			'The repository has multiple remotes but no verified default remote. Choose a remote branch explicitly.',
			remotes.map(remote => remote.name),
		);
	}

	const localBranches = await getLocalBranches(tools, activity, signal);
	const defaults = localBranches.filter(
		branch => branch.name === 'main' || branch.name === 'master',
	);
	if (defaults.length === 1) {
		return {
			name: defaults[0]?.name ?? 'main',
			oid: defaults[0]?.oid,
		};
	}
	if (defaults.length > 1) {
		throw new ReviewClarification(
			'Both local main and master branches exist; choose a base explicitly.',
			defaults.map(branch => branch.name),
		);
	}
	throw new Error(
		'No configured remote or local default branch could be verified.',
	);
}

async function defaultBranchFromRemote(
	remote: RemoteInfo,
	tools: ReviewFoundationTools,
	activity: ReviewActivityStore,
	signal?: AbortSignal,
	preferredName?: string,
): Promise<DefaultBranchInfo> {
	let name = preferredName;
	if (!name) {
		const advertised = await git(
			['ls-remote', '--symref', '--', remote.name, 'HEAD'],
			'Verifying the remote default branch',
			tools,
			activity,
			signal,
		);
		const refLine = splitLines(advertised).find(line =>
			line.startsWith('ref: refs/heads/'),
		);
		const match = refLine?.match(/^ref: refs\/heads\/(.+)\s+HEAD$/);
		name = match?.[1];
	}
	if (!name) {
		throw new Error(
			`Could not verify the default branch for remote "${remote.name}". Pass an explicit branch or pull request URL.`,
		);
	}
	validateRefName(name);
	const oid = await getRemoteBranchOid(
		remote.name,
		name,
		tools,
		activity,
		signal,
	);
	if (!oid) {
		throw new Error(
			`Remote default branch "${remote.name}/${name}" could not be verified.`,
		);
	}
	return {name, remote: remote.name, oid};
}

async function getRemoteBranchOid(
	remote: string,
	name: string,
	tools: ReviewFoundationTools,
	activity: ReviewActivityStore,
	signal?: AbortSignal,
): Promise<string | null> {
	validateRefName(name);
	const output = await git(
		['ls-remote', '--heads', '--', remote, `refs/heads/${name}`],
		'Pinning a remote branch candidate',
		tools,
		activity,
		signal,
	);
	return parseLsRemote(output, name);
}

async function resolveCommit(
	ref: string,
	tools: ReviewFoundationTools,
	activity: ReviewActivityStore,
	signal?: AbortSignal,
): Promise<string> {
	const oid = await git(
		['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`],
		'Resolving a commit object',
		tools,
		activity,
		signal,
	);
	if (!isSafeOid(oid)) {
		throw new Error(
			'Git returned an invalid commit ID; the review scope was not pinned.',
		);
	}
	return oid.toLowerCase();
}

async function getMergeBase(
	baseOid: string,
	headOid: string,
	tools: ReviewFoundationTools,
	activity: ReviewActivityStore,
	signal?: AbortSignal,
): Promise<string> {
	const mergeBase = await git(
		['merge-base', baseOid, headOid],
		'Finding the common base of pinned revisions',
		tools,
		activity,
		signal,
	);
	if (!isSafeOid(mergeBase)) {
		throw new Error(
			'Git could not verify a common base for the requested revisions.',
		);
	}
	return mergeBase.toLowerCase();
}

async function snapshotBranch(
	candidate: BranchCandidate,
	remotes: RemoteInfo[],
	tools: ReviewFoundationTools,
	activity: ReviewActivityStore,
	signal: AbortSignal | undefined,
	now: () => number,
): Promise<ReviewTargetSnapshot> {
	return withTemporaryReviewRefs({tools, activity, signal, now}, async refs => {
		const headOid =
			candidate.kind === 'local'
				? candidate.oid
				: await refs.fetch(
						candidate.remote,
						`refs/heads/${candidate.name}`,
						candidate.oid,
					);
		const preferredRemote =
			candidate.kind === 'remote' ? candidate.remote : undefined;
		const base = await getDefaultBranch(
			remotes,
			preferredRemote,
			tools,
			activity,
			signal,
		);
		const baseOid =
			base.remote && base.oid
				? await refs.fetch(base.remote, `refs/heads/${base.name}`, base.oid)
				: (base.oid ??
					(await resolveCommit(
						`refs/heads/${base.name}`,
						tools,
						activity,
						signal,
					)));
		const mergeBase =
			baseOid === headOid
				? headOid
				: await getMergeBase(baseOid, headOid, tools, activity, signal);
		const label =
			candidate.kind === 'local'
				? `local branch "${candidate.name}" against "${base.name}"`
				: `remote branch "${candidate.remote}/${candidate.name}" against "${base.name}"`;
		return createCommitSnapshot(
			{
				baseOid: mergeBase,
				headOid,
				scope: scope('branch', label),
				...(candidate.kind === 'remote'
					? {
							remoteRepository:
								remotes.find(remote => remote.name === candidate.remote)
									?.repository ?? undefined,
						}
					: {}),
			},
			{tools, activity, signal, now},
		);
	});
}

async function snapshotRecentCommits(
	count: number,
	branchName: string | undefined,
	tools: ReviewFoundationTools,
	activity: ReviewActivityStore,
	signal?: AbortSignal,
	now: () => number = Date.now,
): Promise<ReviewTargetSnapshot> {
	let headOid: string;
	let branchLabel: string;
	if (branchName) {
		const branchRequest: Extract<ReviewRequest, {kind: 'branch'}> = {
			kind: 'branch',
			reference: branchName,
			selection: 'auto',
		};
		const remotes = await getRemotes(tools, activity, signal);
		const branches = await getLocalBranches(tools, activity, signal);
		const candidate = await resolveBranchCandidate(
			branchRequest,
			remotes,
			branches,
			tools,
			activity,
			signal,
		);
		if (candidate.kind === 'remote') {
			return withTemporaryReviewRefs(
				{tools, activity, signal, now},
				async refs => {
					const remoteHead = await refs.fetch(
						candidate.remote,
						`refs/heads/${candidate.name}`,
						candidate.oid,
					);
					return snapshotCommitRange(
						count,
						remoteHead,
						`${candidate.remote}/${candidate.name}`,
						tools,
						activity,
						signal,
						now,
						remotes.find(remote => remote.name === candidate.remote)
							?.repository ?? undefined,
					);
				},
			);
		}
		headOid = candidate.oid;
		branchLabel = candidate.name;
	} else {
		headOid = await resolveCommit('HEAD', tools, activity, signal);
		const branch = await git(
			['symbolic-ref', '--quiet', '--short', 'HEAD'],
			'Reading the current branch name',
			tools,
			activity,
			signal,
		).catch(() => `detached at ${headOid.slice(0, 12)}`);
		branchLabel = branch;
	}
	return snapshotCommitRange(
		count,
		headOid,
		branchLabel,
		tools,
		activity,
		signal,
		now,
	);
}

async function snapshotCommitRange(
	count: number,
	headOid: string,
	branchName: string,
	tools: ReviewFoundationTools,
	activity: ReviewActivityStore,
	signal?: AbortSignal,
	now: () => number = Date.now,
	remoteRepository?: string,
): Promise<ReviewTargetSnapshot> {
	const output = await git(
		['rev-list', '--first-parent', `--max-count=${count + 1}`, headOid],
		'Selecting the requested recent commits',
		tools,
		activity,
		signal,
	);
	const commits = splitLines(output);
	if (commits.some(oid => !isSafeOid(oid))) {
		throw new Error(
			'Git returned invalid commit IDs for the requested history.',
		);
	}
	if (commits.length <= count) {
		throw new ReviewClarification(
			`Branch "${branchName}" has fewer than ${count + 1} commits, so the requested range has no verifiable parent.`,
			['Choose a smaller commit count or a different branch.'],
		);
	}
	const rangeBase = commits[count];
	const rangeHead = commits[0];
	if (!rangeBase || !rangeHead) {
		throw new Error('Git could not resolve the requested commit range.');
	}
	return createCommitSnapshot(
		{
			baseOid: rangeBase,
			headOid: rangeHead,
			scope: scope(
				'recent-commits',
				`last ${count} commits on "${branchName}"`,
				count,
			),
			remoteRepository,
		},
		{tools, activity, signal, now},
	);
}

async function parseUpstream(
	remotes: RemoteInfo[],
	tools: ReviewFoundationTools,
	activity: ReviewActivityStore,
	signal?: AbortSignal,
): Promise<{remote: string; name: string} | null> {
	const upstream = await git(
		['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
		'Checking the current branch upstream',
		tools,
		activity,
		signal,
	).catch(() => null);
	if (!upstream) return null;
	const remote = remotes
		.map(candidate => candidate.name)
		.filter(name => upstream.startsWith(`${name}/`))
		.sort((left, right) => right.length - left.length)[0];
	if (!remote) return null;
	return {remote, name: upstream.slice(remote.length + 1)};
}

async function snapshotDefaultScope(
	remotes: RemoteInfo[],
	localBranches: LocalBranch[],
	tools: ReviewFoundationTools,
	activity: ReviewActivityStore,
	signal?: AbortSignal,
	now: () => number = Date.now,
): Promise<ReviewTargetSnapshot> {
	const currentBranch = await git(
		['symbolic-ref', '--quiet', '--short', 'HEAD'],
		'Reading the current branch',
		tools,
		activity,
		signal,
	).catch(() => null);
	const headOid = await resolveCommit('HEAD', tools, activity, signal);
	const status = await git(
		['status', '--porcelain=v1', '-z', '--untracked-files=all'],
		'Checking for dirty worktree changes',
		tools,
		activity,
		signal,
	);
	const hasDirtyChanges = status.length > 0;
	if (!currentBranch) {
		if (hasDirtyChanges) {
			throw new ReviewClarification(
				'The repository is detached and has worktree changes; choose which snapshot to review.',
				['Review the detached working tree with `/review working tree`.'],
			);
		}
		throw new ReviewClarification(
			'The repository is in detached-HEAD state; no branch target can be inferred.',
			['Pass an explicit branch, recent-commit request, or pull-request URL.'],
		);
	}

	const upstream = await parseUpstream(remotes, tools, activity, signal);
	if (upstream) {
		const remote = remotes.find(
			candidate => candidate.name === upstream.remote,
		);
		if (!remote) {
			throw new ReviewClarification(
				`The current branch refers to missing remote "${upstream.remote}"; its ahead/dirty state cannot be verified.`,
				['Use `/review working tree` or choose a verified branch explicitly.'],
			);
		}
		let upstreamOid: string | null;
		try {
			upstreamOid = await getRemoteBranchOid(
				upstream.remote,
				upstream.name,
				tools,
				activity,
				signal,
			);
		} catch (error) {
			if (hasDirtyChanges) {
				throw new ReviewClarification(
					`The upstream branch could not be verified, so dirty changes cannot be distinguished from unpushed commits: ${sanitizeReviewActivityText(
						error instanceof Error ? error.message : String(error),
						180,
					)}`,
					[
						'Review only the current worktree with `/review working tree`.',
						'Restore remote access and retry to compare branch-ahead commits.',
					],
				);
			}
			throw error;
		}
		if (!upstreamOid) {
			throw new ReviewClarification(
				`The upstream branch "${upstream.remote}/${upstream.name}" no longer exists or could not be verified.`,
				['Use `/review working tree` or choose another verified branch.'],
			);
		}
		return withTemporaryReviewRefs(
			{tools, activity, signal, now},
			async refs => {
				const pinnedUpstream = await refs.fetch(
					upstream.remote,
					`refs/heads/${upstream.name}`,
					upstreamOid,
				);
				const counts = splitLines(
					await git(
						[
							'rev-list',
							'--left-right',
							'--count',
							`${pinnedUpstream}...${headOid}`,
						],
						'Distinguishing local commits from worktree edits',
						tools,
						activity,
						signal,
					),
				)[0]?.split(/\s+/);
				const behindText = counts?.[0];
				const aheadText = counts?.[1];
				const behind = Number(behindText);
				const ahead = Number(aheadText);
				if (
					!behindText ||
					!aheadText ||
					!/^\d+$/.test(behindText) ||
					!/^\d+$/.test(aheadText) ||
					!Number.isSafeInteger(behind) ||
					!Number.isSafeInteger(ahead)
				) {
					throw new Error(
						'Git could not determine the current branch-ahead count.',
					);
				}
				if (hasDirtyChanges && ahead > 0) {
					throw new ReviewClarification(
						'Both uncommitted worktree changes and local commits ahead of the upstream branch are present.',
						[
							'Review the dirty worktree with `/review working tree`.',
							`Review local commits with \`/review last ${ahead} commits on this branch\`.`,
						],
					);
				}
				if (hasDirtyChanges) {
					return createWorkingTreeSnapshot(
						{
							scope: scope(
								'working-tree',
								`dirty worktree on "${currentBranch}"`,
							),
						},
						{tools, activity, signal, now},
					);
				}
				if (ahead === 0) {
					return createCommitSnapshot(
						{
							baseOid: headOid,
							headOid,
							scope: scope(
								'branch',
								`no local commits ahead of ${upstream.remote}/${upstream.name}`,
							),
						},
						{tools, activity, signal, now},
					);
				}
				const mergeBase = await getMergeBase(
					pinnedUpstream,
					headOid,
					tools,
					activity,
					signal,
				);
				return createCommitSnapshot(
					{
						baseOid: mergeBase,
						headOid,
						scope: scope(
							'branch',
							`${ahead} local commit${ahead === 1 ? '' : 's'} ahead of ${upstream.remote}/${upstream.name}`,
							ahead,
						),
					},
					{tools, activity, signal, now},
				);
			},
		);
	}

	if (hasDirtyChanges) {
		throw new ReviewClarification(
			'The current branch has dirty worktree changes but no configured upstream, so its committed branch scope cannot be distinguished safely.',
			[
				'Review the dirty worktree with `/review working tree`.',
				'Configure an upstream or pass an explicit branch/PR target.',
			],
		);
	}

	const current = localBranches.find(branch => branch.name === currentBranch);
	if (!current) {
		throw new Error('The current branch could not be matched to a local ref.');
	}
	return snapshotBranch(
		{kind: 'local', ...current},
		remotes,
		tools,
		activity,
		signal,
		now,
	);
}

async function discoverPullRequestRepositories(
	remotes: RemoteInfo[],
	tools: ReviewFoundationTools,
	activity: ReviewActivityStore,
	signal?: AbortSignal,
): Promise<string[]> {
	const repositories = new Map<string, string>();
	for (const remote of remotes) {
		if (remote.repository) {
			repositories.set(remote.repository.toLowerCase(), remote.repository);
		}
	}
	if (repositories.size === 0) {
		throw new Error(
			'Cannot determine a GitHub repository from configured remotes. Pass a full GitHub pull-request URL instead.',
		);
	}
	const candidates = new Map(repositories);
	for (const repository of repositories.values()) {
		let metadata: unknown;
		try {
			metadata = JSON.parse(
				await gh(
					['api', `repos/${repository}`],
					'Inspecting a configured GitHub repository',
					tools,
					activity,
					signal,
				),
			);
		} catch (error) {
			// A 404 may mean an inaccessible private repo; skipping it could hide a
			// collision and make a bare PR number select the wrong target.
			throw new Error(
				`Could not inspect GitHub repository "${repository}": ${sanitizeReviewActivityText(
					error instanceof Error ? error.message : String(error),
					140,
				)}. Pass a full PR URL if that repository is not accessible.`,
			);
		}
		if (!metadata || typeof metadata !== 'object') {
			throw new Error(
				`GitHub returned invalid repository metadata for "${repository}".`,
			);
		}
		const parent = (metadata as {parent?: {full_name?: unknown}}).parent
			?.full_name;
		if (
			typeof parent === 'string' &&
			/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(parent)
		) {
			candidates.set(parent.toLowerCase(), parent);
		}
	}
	return [...candidates.values()];
}

async function readPullRequest(
	repository: string,
	number: string,
	tools: ReviewFoundationTools,
	activity: ReviewActivityStore,
	signal?: AbortSignal,
): Promise<PullRequestInfo> {
	const result = await gh(
		['api', `repos/${repository}/pulls/${number}`],
		`Reading metadata for PR #${number}`,
		tools,
		activity,
		signal,
	);
	return parsePullRequest(JSON.parse(result), repository, number);
}

async function resolvePullRequest(
	request: Extract<ReviewRequest, {kind: 'pull-request'}>,
	remotes: RemoteInfo[],
	tools: ReviewFoundationTools,
	activity: ReviewActivityStore,
	signal: AbortSignal | undefined,
	now: () => number,
): Promise<ReviewTargetSnapshot> {
	let pull: PullRequestInfo | undefined;
	if (request.repository) {
		pull = await readPullRequest(
			request.repository,
			request.number,
			tools,
			activity,
			signal,
		);
	} else {
		const repositories = await discoverPullRequestRepositories(
			remotes,
			tools,
			activity,
			signal,
		);
		const matches: PullRequestInfo[] = [];
		for (const repository of repositories) {
			try {
				matches.push(
					await readPullRequest(
						repository,
						request.number,
						tools,
						activity,
						signal,
					),
				);
			} catch (error) {
				if (isGitHubNotFound(error)) continue;
				throw error;
			}
		}
		if (matches.length === 0) {
			throw new ReviewClarification(
				`PR #${request.number} was not found in configured repositories.`,
				['Pass a full GitHub PR URL to specify the owner and repository.'],
			);
		}
		if (matches.length > 1) {
			throw new ReviewClarification(
				`PR #${request.number} exists in multiple configured repositories.`,
				matches.map(match => `${match.repository}#${match.number}`),
			);
		}
		pull = matches[0];
	}
	if (!pull) throw new Error('Pull request metadata could not be resolved.');
	if (pull.baseRepository.toLowerCase() !== pull.repository.toLowerCase()) {
		throw new Error(
			`PR metadata identifies base repository "${pull.baseRepository}" instead of "${pull.repository}".`,
		);
	}

	const configuredRemote = remotes.find(
		candidate =>
			candidate.repository?.toLowerCase() === pull.repository.toLowerCase(),
	);
	const remote =
		configuredRemote?.name ??
		(tools.githubRepositoryUrl
			? tools.githubRepositoryUrl(pull.repository)
			: `https://github.com/${pull.repository}.git`);
	return withTemporaryReviewRefs({tools, activity, signal, now}, async refs => {
		const headOid = await refs.fetch(
			remote,
			`refs/pull/${pull.number}/head`,
			pull.headOid,
		);
		const baseOid = await refs.fetch(remote, `refs/heads/${pull.baseRef}`);
		const mergeBase = await getMergeBase(
			baseOid,
			headOid,
			tools,
			activity,
			signal,
		);
		return createCommitSnapshot(
			{
				baseOid: mergeBase,
				headOid,
				scope: scope(
					'pull-request',
					`PR #${pull.number} in ${pull.repository}`,
				),
				remoteRepository: pull.repository,
				baseTipOid: baseOid,
			},
			{tools, activity, signal, now},
		);
	});
}

async function resolveSnapshot(
	request: ReviewRequest,
	tools: ReviewFoundationTools,
	activity: ReviewActivityStore,
	signal: AbortSignal | undefined,
	now: () => number,
): Promise<ReviewTargetSnapshot> {
	if (request.kind === 'working-tree') {
		return createWorkingTreeSnapshot(
			{scope: scope('working-tree', 'explicit working-tree snapshot')},
			{tools, activity, signal, now},
		);
	}
	if (request.kind === 'recent-commits') {
		return snapshotRecentCommits(
			request.count,
			request.branch,
			tools,
			activity,
			signal,
			now,
		);
	}
	const remotes = await getRemotes(tools, activity, signal);
	if (request.kind === 'pull-request') {
		return resolvePullRequest(request, remotes, tools, activity, signal, now);
	}
	if (request.kind === 'branch') {
		const localBranches = await getLocalBranches(tools, activity, signal);
		const candidate = await resolveBranchCandidate(
			request,
			remotes,
			localBranches,
			tools,
			activity,
			signal,
		);
		return snapshotBranch(candidate, remotes, tools, activity, signal, now);
	}
	const localBranches = await getLocalBranches(tools, activity, signal);
	return snapshotDefaultScope(
		remotes,
		localBranches,
		tools,
		activity,
		signal,
		now,
	);
}

/**
 * Resolve a human request into a deterministic, immutable review snapshot.
 * Request text is parsed as data; git and gh are invoked only with validated
 * argument arrays. The caller owns the resulting snapshot and activity trace.
 */
export async function resolveReviewScope(
	input: string,
	dependencies: ReviewResolverDependencies = {},
): Promise<ReviewScopeResolution> {
	const tools = dependencies.tools ?? defaultReviewFoundationTools;
	const activity = dependencies.activity ?? new ActivityStore();
	const now = dependencies.now ?? Date.now;
	let run: ReviewActivitySpan | undefined;
	try {
		if (activity.getStatus() !== 'running') {
			throw new Error(
				'A review activity store can only be used for one run; create a new store for each review.',
			);
		}
		run = activity.begin({
			source: 'review',
			name: 'Resolve review scope',
			summary: 'Interpreting the requested review scope',
		});
		throwIfReviewAborted(dependencies.signal);
		const parsed = parseReviewRequest(input);
		if (!parsed.ok) {
			run.complete('Request needs a more specific scope');
			activity.finish('completed');
			return {
				status: 'clarification',
				message: parsed.error,
				choices: [
					'Name a branch, paste a GitHub PR URL, request recent commits, or choose the working tree.',
				],
				activity: activity.toSummary(),
			};
		}
		run.progress('Discovering exact candidate revisions');
		const snapshot = await resolveSnapshot(
			parsed.request,
			tools,
			activity,
			dependencies.signal,
			now,
		);
		run.complete(formatResolvedReviewScope(snapshot));
		activity.finish('completed');
		return {
			status: 'ready',
			snapshot,
			activity: activity.toSummary(),
		};
	} catch (error) {
		if (!run) {
			const failureActivity = new ActivityStore({now});
			const failure = failureActivity.begin({
				source: 'review',
				name: 'Resolve review scope',
				summary: 'Could not start review scope resolution',
			});
			const message = sanitizeReviewActivityText(
				error instanceof Error ? error.message : String(error),
				400,
			);
			failure.fail(error, 'Review activity store is not available');
			failureActivity.finish('failed');
			return {
				status: 'failed',
				message,
				activity: failureActivity.toSummary(),
			};
		}
		if (error instanceof ReviewClarification) {
			run.complete(error.message);
			activity.finish('completed');
			return {
				status: 'clarification',
				message: sanitizeReviewActivityText(error.message, 400),
				choices: error.choices.map(choice =>
					sanitizeReviewActivityText(choice, 200),
				),
				activity: activity.toSummary(),
			};
		}
		const message = sanitizeReviewActivityText(
			error instanceof Error ? error.message : String(error),
			400,
		);
		if (/temporary refs could not be removed/i.test(message)) {
			run.fail(error, 'Review stopped but temporary ref cleanup failed');
			activity.finish('failed');
			return {
				status: 'failed',
				message,
				activity: activity.toSummary(),
			};
		}
		if (dependencies.signal?.aborted || error instanceof ReviewCancelledError) {
			run.cancel('Cancelled before review scope resolution completed');
			activity.finish('cancelled');
			return {
				status: 'cancelled',
				message:
					'Review scope resolution was cancelled; temporary refs were cleaned up.',
				activity: activity.toSummary(),
			};
		}
		run.fail(error, 'Could not verify the requested review scope');
		activity.finish('failed');
		return {
			status: 'failed',
			message,
			activity: activity.toSummary(),
		};
	}
}
