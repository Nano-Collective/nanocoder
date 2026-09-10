/**
 * Trust Levels
 *
 * Maps the three execution trust levels from the Agentic CI/CD Gate roadmap
 * (issue #860) to strict tool allowlists. This module is intentionally
 * standalone: it does not touch `ToolManager`, `resolveToolApproval`, or
 * `DevelopmentMode`. It exists so the `verify` subcommand (Phase 2, #861)
 * and the `--trust` CLI flag (Phase 4, #863) have a single, auditable place
 * to look up "what can a run at this trust level touch" when they build the
 * tool list for the `verify-pr-review`/`verify-ci-investigator` subagents —
 * both `ToolManager.getFilteredTools(names)` and the subagent executor's
 * `tools`/`disallowedTools` filtering already accept an explicit tool-name
 * list, so `getAllowedToolNames()` below is designed to be dropped straight
 * into either.
 *
 * `git_pr` is the one tool that needs sub-action granularity, since its
 * actions (view/list/diff/comment/review/checks/logs/create) are selected by
 * input shape rather than separate tool names — see `source/tools/git/git-pr.tsx`.
 */

export type TrustLevel = 'comment-only' | 'auto-fix' | 'full-commit';

/** All `git_pr` action keys, matching `GitPrInput`'s fields in git-pr.tsx. */
export type GitPrAction =
	| 'create'
	| 'view'
	| 'list'
	| 'diff'
	| 'comment'
	| 'review'
	| 'checks'
	| 'logs';

interface ToolAllowance {
	tool: string;
	/** Omitted = every action of this tool is allowed. */
	actions?: readonly GitPrAction[];
}

const GIT_PR_READ_AND_REVIEW_ACTIONS: readonly GitPrAction[] = [
	'view',
	'list',
	'diff',
	'comment',
	'review',
	'checks',
	'logs',
];

const GIT_PR_ALL_ACTIONS: readonly GitPrAction[] = [
	...GIT_PR_READ_AND_REVIEW_ACTIONS,
	'create',
];

// Read/investigate tools — safe at every trust level, never touch the
// working tree or push anything.
//
// Deliberately excludes `web_search`/`fetch_url`: every consumer of this
// allowlist runs headless/auto-execute (no tool-approval-queue handler is
// registered — see `signalToolApproval` in `source/utils/tool-approval-queue.ts`),
// and the text these tools investigate (a PR diff, a CI log) is attacker-
// controlled. An injected instruction could have either tool exfiltrate
// local file contents to an external URL with no confirmation step, and the
// result can end up posted publicly (e.g. `verify --post-review`). A
// read-only reviewer doesn't need to browse to do its job.
const INVESTIGATION_TOOLS: readonly ToolAllowance[] = [
	{tool: 'read_file'},
	{tool: 'find_files'},
	{tool: 'search_file_contents'},
	{tool: 'list_directory'},
	{tool: 'git_status'},
	{tool: 'git_diff'},
	{tool: 'git_log'},
	{tool: 'lsp_get_diagnostics'},
];

// File-mutation tools — the write access the issue calls out explicitly as
// denied in comment-only mode. `write_file`/`string_replace` are this
// repo's primary editors (see CLAUDE.md); `git_add`/`git_commit` stage and
// commit the result; `execute_bash` covers running tests/build to verify a
// fix before committing it.
const MUTATION_TOOLS: readonly ToolAllowance[] = [
	{tool: 'write_file'},
	{tool: 'string_replace'},
	{tool: 'git_add'},
	{tool: 'git_commit'},
	{tool: 'execute_bash'},
];

/**
 * Per-level tool allowlists.
 *
 * - comment-only: investigate + comment/review on PRs. No working-tree
 *   writes, no `git_pr` create/merge.
 * - auto-fix: comment-only + file mutation/local commit + `git_pr` create
 *   (Phase 4's flow opens a fresh branch and a *draft* PR rather than
 *   pushing to the original branch directly — that workflow constraint is
 *   enforced by the Phase 4 subagent, not by this flat allowlist).
 * - full-commit: everything auto-fix has; the same tool surface, gated
 *   instead by explicit user opt-in and warnings at the CLI layer (Phase 4).
 */
const AUTO_FIX_TOOLS: readonly ToolAllowance[] = [
	...INVESTIGATION_TOOLS,
	...MUTATION_TOOLS,
	{tool: 'git_pr', actions: GIT_PR_ALL_ACTIONS},
];

const TRUST_POLICIES: Record<TrustLevel, readonly ToolAllowance[]> = {
	'comment-only': [
		...INVESTIGATION_TOOLS,
		{tool: 'git_pr', actions: GIT_PR_READ_AND_REVIEW_ACTIONS},
	],
	// full-commit has the same tool surface as auto-fix by design (see the
	// doc comment above) — shares the same array so the two levels can't
	// silently drift apart.
	'auto-fix': AUTO_FIX_TOOLS,
	'full-commit': AUTO_FIX_TOOLS,
};

function findAllowance(
	level: TrustLevel,
	toolName: string,
): ToolAllowance | undefined {
	return TRUST_POLICIES[level].find(a => a.tool === toolName);
}

/**
 * Whether `toolName` (optionally a specific `git_pr` `action`) is permitted
 * at the given trust level. For tools other than `git_pr`, `action` is
 * ignored — the allowlist is all-or-nothing by tool name.
 */
export function isActionAllowed(
	level: TrustLevel,
	toolName: string,
	action?: GitPrAction,
): boolean {
	const allowance = findAllowance(level, toolName);
	if (!allowance) return false;
	if (!allowance.actions) return true;
	if (action === undefined) return false;
	return allowance.actions.includes(action);
}

/**
 * Dedup'd tool names permitted at the given trust level, for callers that
 * want a flat list (e.g. to pass into `ToolManager.getFilteredTools` or a
 * subagent's `tools` config) rather than per-action checks.
 */
export function getAllowedToolNames(level: TrustLevel): string[] {
	return TRUST_POLICIES[level].map(a => a.tool);
}

const ALL_TRUST_LEVELS: readonly TrustLevel[] = [
	'comment-only',
	'auto-fix',
	'full-commit',
];

export function isTrustLevel(value: unknown): value is TrustLevel {
	return (
		typeof value === 'string' &&
		(ALL_TRUST_LEVELS as readonly string[]).includes(value)
	);
}

// Tools whose mutation is safe to auto-approve in headless mode once a
// trust level has already vetted them into getAllowedToolNames() above.
// Deliberately excludes `git_pr` at every level, even full-commit: posting
// to / mutating GitHub must always be harness-mediated (see
// `postPrComment`/`pushBranch`/`createDraftPr` in `source/tools/git/utils.ts`),
// never an auto-approved raw tool call from the subagent itself — that
// invariant is what makes the "harness posts, not the LLM" pattern from
// Phase 2/3 hold even at the most-trusted level. The other MUTATION_TOOLS
// (`write_file`/`string_replace`/`git_add`/`execute_bash`) don't need to be
// listed here: their own approval policies already treat headless mode as
// not needing approval. Only `git_commit` has an unconditional
// `approval: true`, which is otherwise silently auto-denied in headless
// mode (no approval-queue handler is ever registered there).
const HEADLESS_AUTO_APPROVE_TOOLS: Record<TrustLevel, readonly string[]> = {
	'comment-only': [],
	'auto-fix': ['git_commit'],
	'full-commit': ['git_commit'],
};

export function getHeadlessAutoApproveToolNames(level: TrustLevel): string[] {
	return [...HEADLESS_AUTO_APPROVE_TOOLS[level]];
}

/**
 * Resolve the effective trust level from a CLI flag and a config value:
 * flag wins when given, else the config value, else the safe default.
 * Never infers a more permissive level than what was explicitly set.
 */
export function resolveTrustLevel(
	cliFlag: TrustLevel | undefined,
	configValue: TrustLevel | undefined,
): TrustLevel {
	return cliFlag ?? configValue ?? 'comment-only';
}
