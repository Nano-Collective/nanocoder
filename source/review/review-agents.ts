/**
 * Built-in subagents for the agentic review pipeline.
 *
 * The finder investigates the changed code with read-only tools and emits
 * FINDING blocks; the verifier judges one finding at a time and emits a
 * VERDICT block. Both are registered programmatically (not as markdown
 * files) so they ship with the package without depending on file discovery.
 *
 * User and project agent definitions win over these: registration is
 * skipped for names that already exist.
 */

import type {SubagentLoader} from '@/subagents/subagent-loader.js';
import type {SubagentConfigWithSource} from '@/subagents/types.js';

/**
 * The exact tool set both review agents may use. Read-only on purpose: a
 * reviewer that cannot write also cannot damage the tree it is reviewing.
 * Enforced twice — in the advertised tool set and at the execution boundary —
 * via the executor's runtime limits.
 */
export const REVIEW_READ_ONLY_TOOLS = [
	'git_diff',
	'git_log',
	'read_file',
	'search_file_contents',
	'lsp_get_diagnostics',
] as const;

export const REVIEW_FINDER_AGENT = 'review-finder';
export const REVIEW_VERIFIER_AGENT = 'review-verifier';

const FINDER_SYSTEM_PROMPT = `You are a meticulous code reviewer. You investigate real code with your read-only tools before claiming anything.

Rules:
- Only report issues in changed code or code directly affected by it.
- Skip formatting, naming taste, missing tests, and anything the compiler or linter would already catch.
- Every finding must cite a file and line you actually looked at.
- EVIDENCE must quote or precisely describe the code at that location.
- If you find no issues, output nothing — do not invent problems.

When you have findings, output one block per finding and nothing else:

FINDING
FILE: path/relative/to/project.ts
LINE: <positive line number>
SEVERITY: low | medium | high | critical
ISSUE: one-line description of the problem
EVIDENCE: one-line proof from the code
END`;

const VERIFIER_SYSTEM_PROMPT = `You are an independent code-review verifier. You receive one finding from another reviewer and must decide whether it is real by opening the cited code yourself. You do not trust the finding's evidence; you check the code.

Rules:
- CONFIRM only when the code at the citation proves the issue is real.
- REJECT when the code contradicts the claim, a guard prevents it, it is intentional, or it pre-exists the reviewed changes.
- INSUFFICIENT when you cannot determine the truth from the code.
- Read the file and any related code before deciding.

Output exactly one block and nothing else:

VERDICT: CONFIRM | REJECT | INSUFFICIENT
ID: <the ID from the finding, copied exactly>
REASON: one-line justification grounded in the code`;

export interface ReviewAgentRegistration {
	registered: string[];
	/** Names skipped because a user/project definition already exists. */
	skipped: string[];
}

/**
 * Register the built-in review agents with the loader. Existing
 * definitions (user or project) take precedence and are skipped. Safe to
 * call repeatedly.
 */
export async function registerReviewAgents(
	loader: SubagentLoader,
): Promise<ReviewAgentRegistration> {
	await loader.initialize();

	const definitions: SubagentConfigWithSource[] = [
		{
			name: REVIEW_FINDER_AGENT,
			description:
				'Investigates changed code with read-only tools and emits FINDING blocks',
			systemPrompt: FINDER_SYSTEM_PROMPT,
			tools: [...REVIEW_READ_ONLY_TOOLS],
			source: {priority: 0, isBuiltIn: true},
		},
		{
			name: REVIEW_VERIFIER_AGENT,
			description:
				'Independently verifies one review finding by reading the cited code',
			systemPrompt: VERIFIER_SYSTEM_PROMPT,
			tools: [...REVIEW_READ_ONLY_TOOLS],
			source: {priority: 0, isBuiltIn: true},
		},
	];

	const registered: string[] = [];
	const skipped: string[] = [];
	for (const definition of definitions) {
		const existing = await loader.getSubagent(definition.name);
		if (existing && !existing.source.isBuiltIn) {
			skipped.push(definition.name);
			continue;
		}
		loader.unregisterExternal(definition.name);
		loader.registerExternal(definition);
		registered.push(definition.name);
	}

	return {registered, skipped};
}
