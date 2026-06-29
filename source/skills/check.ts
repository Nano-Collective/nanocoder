/**
 * Skill linter. Validates a bundle-form skill straight from disk and returns
 * a structured report. Two surfaces consume this:
 *
 *   - `/skills check <name>` (user-facing slash command)
 *   - the `check_skill` built-in tool (model-facing, used by the
 *     `/skills create` self-correction loop)
 *
 * The heavy lifting is delegated to the same parsers the loaders use at boot
 * (`BundleLoader.checkBundle`), so a clean check here means the bundle will
 * load. On top of the loader's hard errors, this module adds a few advisory
 * warnings for shapes that parse but won't behave as the author expects
 * (empty bundle, scoped tools with no agent, an un-edited scaffold).
 */

import {existsSync, readFileSync} from 'node:fs';
import {isAbsolute, join, relative} from 'node:path';
import {
	parseCommandFile,
	parseCommandParameterSpec,
} from '@/custom-commands/parser';
import {parseCustomToolFile} from '@/custom-tools/parser';
import {BundleLoader, type SkillLoadError} from '@/skills/bundle-loader';
import {
	type BodyIssue,
	lintCommandBody,
	lintToolBody,
} from '@/skills/lint-body';
import type {Skill} from '@/types/skills';

/** The scaffold `skill.yaml` description written by `/skills create`. */
const SCAFFOLD_DESCRIPTION = 'A brief description of what this skill does.';

export interface SkillCheckIssue {
	severity: 'error' | 'warning';
	/** Project-relative path to the offending file, when known. */
	filePath?: string;
	message: string;
}

export interface SkillCheckReport {
	name: string;
	/** Project-relative bundle path. */
	bundlePath: string;
	/** False when the bundle directory does not exist. */
	found: boolean;
	/** True when the bundle was found and has zero error-severity issues. */
	ok: boolean;
	issues: SkillCheckIssue[];
	/** Human summary of members, e.g. "2 commands, 1 agent, 3 tools". */
	memberSummary: string;
}

function toRelative(projectRoot: string, filePath: string): string {
	if (!isAbsolute(filePath)) return filePath;
	const rel = relative(projectRoot, filePath);
	return rel.startsWith('..') ? filePath : rel;
}

function loadErrorToIssue(
	projectRoot: string,
	err: SkillLoadError,
): SkillCheckIssue {
	return {
		severity: 'error',
		filePath: err.filePath ? toRelative(projectRoot, err.filePath) : undefined,
		message: err.message,
	};
}

/**
 * Lint a bundle skill under `<projectRoot>/.nanocoder/skills/<name>/`.
 */
export async function checkSkillBundle(
	projectRoot: string,
	name: string,
): Promise<SkillCheckReport> {
	const bundlePath = join(projectRoot, '.nanocoder', 'skills', name);
	const relBundlePath = toRelative(projectRoot, bundlePath);

	if (!existsSync(bundlePath)) {
		return {
			name,
			bundlePath: relBundlePath,
			found: false,
			ok: false,
			memberSummary: 'no members',
			issues: [
				{
					severity: 'error',
					message: `No skill bundle at ${relBundlePath}. Create one with "/skills create ${name}".`,
				},
			],
		};
	}

	const loader = new BundleLoader(projectRoot);
	const {skill, errors} = await loader.checkBundle(bundlePath);

	const issues: SkillCheckIssue[] = errors.map(e =>
		loadErrorToIssue(projectRoot, e),
	);

	const commandCount = skill?.commands?.length ?? 0;
	const toolCount = skill?.tools?.length ?? 0;
	const hasAgent = !!skill?.subagent;

	// Advisory checks layered on top of the loader's hard errors. These shapes
	// parse but won't behave the way an author expects.
	if (skill) {
		const noMembers = commandCount === 0 && !hasAgent && toolCount === 0;
		if (noMembers) {
			issues.push({
				severity: 'warning',
				message:
					'Bundle has no members. Add at least one .md file under commands/, agents/, or tools/.',
			});
		}

		if (skill.toolsVisibility === 'scoped' && toolCount > 0 && !hasAgent) {
			issues.push({
				severity: 'warning',
				message:
					'Tools are scoped (the default) but the bundle has no agent. Scoped tools are only visible to the bundle\'s own subagent, so these tools are unreachable. Add an agent under agents/, or set "tools_visibility: global" in skill.yaml.',
			});
		}

		if (skill.description === SCAFFOLD_DESCRIPTION) {
			issues.push({
				severity: 'warning',
				filePath: join(relBundlePath, 'skill.yaml'),
				message:
					'Description is still the scaffold placeholder. Update "description" in skill.yaml.',
			});
		}

		issues.push(...lintMemberBodies(projectRoot, skill));
	}

	const ok = !!skill && !issues.some(i => i.severity === 'error');

	return {
		name,
		bundlePath: relBundlePath,
		found: true,
		ok,
		memberSummary: formatMemberSummary(commandCount, hasAgent, toolCount),
		issues,
	};
}

/**
 * Re-parse each tool and command member and lint its template body. The
 * loader already proved these files parse, so we read declared parameters
 * and the raw body here and run the body checks the structural parsers
 * don't. A re-parse that unexpectedly throws is swallowed - any real
 * structural problem is already reported via the loader's errors.
 */
function lintMemberBodies(
	projectRoot: string,
	skill: Skill,
): SkillCheckIssue[] {
	const issues: SkillCheckIssue[] = [];

	const attach = (filePath: string, bodyIssues: BodyIssue[]): void => {
		for (const issue of bodyIssues) {
			issues.push({
				severity: issue.severity,
				filePath: toRelative(projectRoot, filePath),
				message: issue.message,
			});
		}
	};

	for (const toolMember of skill.tools ?? []) {
		try {
			const parsed = parseCustomToolFile(toolMember.filePath);
			attach(
				toolMember.filePath,
				lintToolBody(parsed.body, Object.keys(parsed.metadata.parameters)),
			);
		} catch {
			// Structural failure already surfaced by the loader.
		}
	}

	for (const commandMember of skill.commands ?? []) {
		try {
			const parsed = parseCommandFile(commandMember.filePath);
			// A `parameters:` key that didn't parse to an array means the author
			// used a non-list shape (typically the custom-tool typed mapping),
			// which the command parser drops. Detect it from the raw frontmatter
			// so the lint can name the exact mistake instead of just "undeclared".
			const parametersMalformed =
				frontmatterHasParametersKey(commandMember.filePath) &&
				!Array.isArray(parsed.metadata.parameters);
			// Strip any `=default` so the lint compares against bare names.
			const declaredNames = (parsed.metadata.parameters ?? []).map(
				spec => parseCommandParameterSpec(spec).name,
			);
			attach(
				commandMember.filePath,
				lintCommandBody(parsed.content, declaredNames, {parametersMalformed}),
			);
		} catch {
			// Structural failure already surfaced by the loader.
		}
	}

	return issues;
}

// Matches a top-level `parameters:` key in YAML frontmatter (hardcoded to
// avoid building a RegExp from a variable).
const PARAMETERS_KEY_RE = /^[ \t]*parameters[ \t]*:/m;

/**
 * Whether the file's YAML frontmatter declares `parameters:` at the top level.
 * Used to tell "author omitted parameters" apart from "author wrote
 * parameters in a shape the parser dropped".
 */
function frontmatterHasParametersKey(filePath: string): boolean {
	let content: string;
	try {
		content = readFileSync(filePath, 'utf-8');
	} catch {
		return false;
	}
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return false;
	const frontmatter = match[1] ?? '';
	return PARAMETERS_KEY_RE.test(frontmatter);
}

function formatMemberSummary(
	commands: number,
	hasAgent: boolean,
	tools: number,
): string {
	const parts: string[] = [];
	if (commands > 0)
		parts.push(`${commands} command${commands === 1 ? '' : 's'}`);
	if (hasAgent) parts.push('1 agent');
	if (tools > 0) parts.push(`${tools} tool${tools === 1 ? '' : 's'}`);
	return parts.length === 0 ? 'no members' : parts.join(', ');
}

/**
 * Render a report as plain text. Used by the `check_skill` tool so the model
 * can read the result and self-correct.
 */
export function formatSkillCheckReport(report: SkillCheckReport): string {
	const lines: string[] = [];
	const errorCount = report.issues.filter(i => i.severity === 'error').length;
	const warningCount = report.issues.filter(
		i => i.severity === 'warning',
	).length;

	if (report.ok) {
		lines.push(
			`PASS: skill "${report.name}" is valid (${report.memberSummary}).`,
		);
	} else if (!report.found) {
		lines.push(`FAIL: skill "${report.name}" not found.`);
	} else {
		lines.push(
			`FAIL: skill "${report.name}" has ${errorCount} error${errorCount === 1 ? '' : 's'} (${report.memberSummary}).`,
		);
	}

	if (warningCount > 0) {
		lines.push(`${warningCount} warning${warningCount === 1 ? '' : 's'}.`);
	}

	for (const issue of report.issues) {
		const tag = issue.severity === 'error' ? 'error' : 'warning';
		const where = issue.filePath ? ` [${issue.filePath}]` : '';
		lines.push(`  - ${tag}${where}: ${issue.message}`);
	}

	return lines.join('\n');
}
