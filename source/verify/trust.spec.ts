/**
 * Trust Level Tests
 */

import test from 'ava';
import {SubagentLoader} from '@/subagents/subagent-loader';
import {
	getAllowedToolNames,
	getHeadlessAutoApproveToolNames,
	isActionAllowed,
	isGitPrCallAllowed,
	isTrustLevel,
	resolveTrustLevel,
} from './trust';

console.log('\ntrust.spec.ts – Trust Levels');

// ============================================================================
// comment-only: the write-access boundary the issue calls out explicitly
// ============================================================================

test('comment-only denies write_file', t => {
	t.false(isActionAllowed('comment-only', 'write_file'));
});

test('comment-only denies string_replace', t => {
	t.false(isActionAllowed('comment-only', 'string_replace'));
});

test('comment-only denies execute_bash', t => {
	t.false(isActionAllowed('comment-only', 'execute_bash'));
});

test('comment-only denies git_add and git_commit', t => {
	t.false(isActionAllowed('comment-only', 'git_add'));
	t.false(isActionAllowed('comment-only', 'git_commit'));
});

test('comment-only allows read/investigate tools', t => {
	t.true(isActionAllowed('comment-only', 'read_file'));
	t.true(isActionAllowed('comment-only', 'find_files'));
	t.true(isActionAllowed('comment-only', 'search_file_contents'));
	t.true(isActionAllowed('comment-only', 'list_directory'));
	t.true(isActionAllowed('comment-only', 'git_status'));
	t.true(isActionAllowed('comment-only', 'git_diff'));
	t.true(isActionAllowed('comment-only', 'git_log'));
	t.true(isActionAllowed('comment-only', 'lsp_get_diagnostics'));
});

test('comment-only denies web_search and fetch_url (headless + untrusted-diff exfiltration risk)', t => {
	t.false(isActionAllowed('comment-only', 'web_search'));
	t.false(isActionAllowed('comment-only', 'fetch_url'));
});

test('comment-only allows read-only git_pr actions but not comment/review/create', t => {
	t.true(isActionAllowed('comment-only', 'git_pr', 'view'));
	t.true(isActionAllowed('comment-only', 'git_pr', 'list'));
	t.true(isActionAllowed('comment-only', 'git_pr', 'diff'));
	t.true(isActionAllowed('comment-only', 'git_pr', 'checks'));
	t.true(isActionAllowed('comment-only', 'git_pr', 'logs'));
	t.false(isActionAllowed('comment-only', 'git_pr', 'comment'));
	t.false(isActionAllowed('comment-only', 'git_pr', 'review'));
	t.false(isActionAllowed('comment-only', 'git_pr', 'create'));
});

test('isGitPrCallAllowed checks every action present in the call arguments', t => {
	t.true(isGitPrCallAllowed('comment-only', {diff: 7}));
	t.true(isGitPrCallAllowed('comment-only', {checks: {pr: 7}, view: 7}));
	t.false(isGitPrCallAllowed('comment-only', {comment: {pr: 7, body: 'x'}}));
	t.false(
		isGitPrCallAllowed('comment-only', {
			review: {pr: 7, verdict: 'approve'},
		}),
	);
	t.false(isGitPrCallAllowed('comment-only', {create: {title: 'x'}}));
	// A read mixed with a write is denied as a whole.
	t.false(
		isGitPrCallAllowed('comment-only', {
			diff: 7,
			comment: {pr: 7, body: 'x'},
		}),
	);
	t.true(isGitPrCallAllowed('auto-fix', {create: {title: 'x'}}));
});

test('comment-only requires an explicit action for git_pr', t => {
	t.false(isActionAllowed('comment-only', 'git_pr'));
});

test('comment-only denies unknown tools', t => {
	t.false(isActionAllowed('comment-only', 'some_unknown_tool'));
});

// ============================================================================
// auto-fix
// ============================================================================

test('auto-fix allows file mutation and local commit', t => {
	t.true(isActionAllowed('auto-fix', 'write_file'));
	t.true(isActionAllowed('auto-fix', 'string_replace'));
	t.true(isActionAllowed('auto-fix', 'git_add'));
	t.true(isActionAllowed('auto-fix', 'git_commit'));
	t.true(isActionAllowed('auto-fix', 'execute_bash'));
});

test('auto-fix allows git_pr create (to open a draft PR)', t => {
	t.true(isActionAllowed('auto-fix', 'git_pr', 'create'));
});

test('auto-fix still allows every comment-only tool', t => {
	for (const tool of getAllowedToolNames('comment-only')) {
		if (tool === 'git_pr') continue; // action set differs on purpose
		t.true(isActionAllowed('auto-fix', tool));
	}
});

// ============================================================================
// full-commit
// ============================================================================

test('full-commit allows everything auto-fix allows', t => {
	t.true(isActionAllowed('full-commit', 'write_file'));
	t.true(isActionAllowed('full-commit', 'execute_bash'));
	t.true(isActionAllowed('full-commit', 'git_pr', 'create'));
});

// ============================================================================
// getAllowedToolNames
// ============================================================================

test('getAllowedToolNames returns a strictly increasing surface across levels', t => {
	const commentOnly = new Set(getAllowedToolNames('comment-only'));
	const autoFix = new Set(getAllowedToolNames('auto-fix'));
	const fullCommit = new Set(getAllowedToolNames('full-commit'));

	for (const tool of commentOnly) {
		t.true(autoFix.has(tool));
	}
	for (const tool of autoFix) {
		t.true(fullCommit.has(tool));
	}
	t.true(autoFix.has('write_file'));
	t.false(commentOnly.has('write_file'));
});

test('getAllowedToolNames includes git_pr exactly once per level', t => {
	for (const level of ['comment-only', 'auto-fix', 'full-commit'] as const) {
		const names = getAllowedToolNames(level);
		t.is(names.filter(n => n === 'git_pr').length, 1);
	}
});

// ============================================================================
// Drift guard: verify-pr-review.md's frontmatter tools list is the default
// used outside of `verify` (e.g. if invoked via /agent), so it should stay
// in lockstep with the comment-only allowlist that `verify/cli.ts` enforces
// at runtime via SubagentExecutor.execute()'s toolOverride.
// ============================================================================

test.serial(
	"verify-pr-review's frontmatter tools match trust.ts's comment-only allowlist",
	async t => {
		const loader = new SubagentLoader();
		await loader.initialize();
		const config = await loader.getSubagent('verify-pr-review');

		t.truthy(config, 'verify-pr-review subagent should exist');
		const frontmatterTools = new Set(config?.tools ?? []);
		const trustTools = new Set(getAllowedToolNames('comment-only'));

		t.deepEqual(
			frontmatterTools,
			trustTools,
			'verify-pr-review.md tools: list has drifted from trust.ts comment-only allowlist',
		);
	},
);

test.serial(
	"verify-ci-investigator's frontmatter tools match trust.ts's auto-fix allowlist",
	async t => {
		// Unlike verify-pr-review (always comment-only), this subagent runs at
		// a runtime-resolved trust level (Phase 4: comment-only/auto-fix/
		// full-commit — see source/daemon/entry.ts and ci-fix-runner.ts, both
		// of which pass an explicit toolOverride that always wins at runtime).
		// Its frontmatter is therefore checked against the *widest* level
		// (auto-fix, identical to full-commit by design) it can ever run at,
		// so a human reading the file isn't misled into thinking it's
		// unconditionally read-only.
		const loader = new SubagentLoader();
		await loader.initialize();
		const config = await loader.getSubagent('verify-ci-investigator');

		t.truthy(config, 'verify-ci-investigator subagent should exist');
		const frontmatterTools = new Set(config?.tools ?? []);
		const trustTools = new Set(getAllowedToolNames('auto-fix'));

		t.deepEqual(
			frontmatterTools,
			trustTools,
			'verify-ci-investigator.md tools: list has drifted from trust.ts auto-fix allowlist',
		);
	},
);

// ============================================================================
// isTrustLevel / getHeadlessAutoApproveToolNames / resolveTrustLevel (Phase 4)
// ============================================================================

test('isTrustLevel accepts exactly the three known levels', t => {
	t.true(isTrustLevel('comment-only'));
	t.true(isTrustLevel('auto-fix'));
	t.true(isTrustLevel('full-commit'));
});

test('isTrustLevel rejects anything else', t => {
	t.false(isTrustLevel('yolo'));
	t.false(isTrustLevel(''));
	t.false(isTrustLevel(undefined));
	t.false(isTrustLevel(null));
	t.false(isTrustLevel(42));
});

test('getHeadlessAutoApproveToolNames is empty at comment-only', t => {
	t.deepEqual(getHeadlessAutoApproveToolNames('comment-only'), []);
});

test('getHeadlessAutoApproveToolNames includes git_commit at auto-fix and full-commit', t => {
	t.deepEqual(getHeadlessAutoApproveToolNames('auto-fix'), ['git_commit']);
	t.deepEqual(getHeadlessAutoApproveToolNames('full-commit'), ['git_commit']);
});

test('getHeadlessAutoApproveToolNames never includes git_pr at any level', t => {
	for (const level of ['comment-only', 'auto-fix', 'full-commit'] as const) {
		t.false(getHeadlessAutoApproveToolNames(level).includes('git_pr'));
	}
});

test('resolveTrustLevel: CLI flag wins when given', t => {
	t.is(resolveTrustLevel('full-commit', 'auto-fix'), 'full-commit');
});

test('resolveTrustLevel: config value used when no flag given', t => {
	t.is(resolveTrustLevel(undefined, 'auto-fix'), 'auto-fix');
});

test('resolveTrustLevel: defaults to comment-only when neither is given', t => {
	t.is(resolveTrustLevel(undefined, undefined), 'comment-only');
});
