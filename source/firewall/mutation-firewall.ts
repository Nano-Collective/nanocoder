import {relative, resolve} from 'node:path';
import ignore from 'ignore';
import {getAppConfig} from '@/config/index';
import {getProjectRoot, getSafeSessionCwd} from '@/services/session-cwd';
import type {
	FirewallConfig,
	FirewallEvaluationResult,
	FirewallViolation,
} from '@/types/firewall';
import {FIREWALL_DEFAULTS, resolveFirewallConfig} from '@/types/firewall';
import {logWarning} from '@/utils/message-queue';
import {
	detectAnyTypeInjections,
	detectDeletedTestBlocks,
	detectExportSignatureModifications,
} from './ast-checker';

function resolveInitialConfig(): FirewallConfig {
	try {
		return resolveFirewallConfig(getAppConfig().firewall);
	} catch {
		// AppConfig may not be loaded yet
	}
	return {...FIREWALL_DEFAULTS};
}

let sessionConfig: FirewallConfig | null = null;

/**
 * Gets the current active firewall configuration.
 */
export function getFirewallConfig(): FirewallConfig {
	if (sessionConfig === null) {
		sessionConfig = resolveInitialConfig();
	}
	return {...sessionConfig};
}

/**
 * Updates the active firewall configuration for the current session.
 */
export function setFirewallConfig(
	config: Partial<FirewallConfig>,
): FirewallConfig {
	const current = getFirewallConfig();
	const nextMode = config.mode ?? current.mode;
	const nextEnabled =
		config.enabled !== undefined
			? config.enabled
			: config.mode !== undefined
				? config.mode !== 'disabled'
				: current.enabled;

	sessionConfig = {
		...current,
		...config,
		enabled: nextEnabled,
		mode: nextMode,
		protectedPatterns: config.protectedPatterns
			? [...config.protectedPatterns]
			: current.protectedPatterns,
	};
	return getFirewallConfig();
}

/**
 * Resets the firewall configuration to defaults or agents.config.json.
 */
export function resetFirewallConfig(): FirewallConfig {
	sessionConfig = resolveInitialConfig();
	return getFirewallConfig();
}

/**
 * Checks if a file path matches any protected patterns using gitignore-style glob semantics.
 * Handles Windows paths, absolute paths, leading './', nested paths, and negated patterns.
 *
 * A relative `filePath` is resolved the way the file tools resolve it (against
 * the session cwd, which a bash `cd` or an ACP session moves away from
 * `process.cwd()`), and patterns are matched relative to the project root,
 * like a root `.gitignore`.
 */
export function isProtectedPath(
	filePath: string,
	patterns: string[],
	cwd: string = getSafeSessionCwd(),
	root: string = getProjectRoot(),
): boolean {
	if (!patterns || patterns.length === 0) return false;

	// Normalize separators and strip leading ./
	const normalized = filePath.replace(/\\/g, '/');
	const clean = normalized.replace(/^\.\//, '');

	const abs = resolve(cwd, clean);
	const rel = relative(root, abs).replace(/\\/g, '/');
	// Strip leading ../ references so external or parent paths still match rules
	const targetPath = (rel.startsWith('..') ? clean : rel)
		.replace(/^(\.\.\/)+/, '')
		.replace(/^\.?\/+/, '');
	if (!targetPath) return false;

	try {
		const ig = ignore().add(patterns);
		return ig.ignores(targetPath);
	} catch {
		// Filter out invalid patterns and test against valid ones
		try {
			const ig = ignore();
			for (const p of patterns) {
				try {
					ig.add(p);
				} catch {}
			}
			return ig.ignores(targetPath);
		} catch {
			return false;
		}
	}
}

/**
 * Evaluates a proposed file mutation against negative-space firewall constraints.
 */
export function evaluateMutationEnvelope(
	filePath: string,
	originalContent: string,
	proposedContent: string,
	customConfig?: Partial<FirewallConfig>,
): FirewallEvaluationResult {
	const config: FirewallConfig = {
		...getFirewallConfig(),
		...customConfig,
	};

	if (!config.enabled || config.mode === 'disabled') {
		return {
			allowed: true,
			violations: [],
		};
	}

	const violations: FirewallViolation[] = [];

	// Rule 1: Protected Config Files
	if (
		config.protectedPatterns.length > 0 &&
		originalContent !== proposedContent
	) {
		if (isProtectedPath(filePath, config.protectedPatterns)) {
			violations.push({
				rule: 'protect_config_files',
				filePath,
				message: `Protected configuration or lockfile modification blocked.`,
				details: `Path '${filePath}' matches firewall protected patterns (${config.protectedPatterns.join(', ')}). Manual modification or explicit firewall configuration is required.`,
			});
		}
	}

	// Rule 2: Block `any` type injections
	if (config.blockAnyTypes && originalContent !== proposedContent) {
		const anyViolations = detectAnyTypeInjections(
			filePath,
			originalContent,
			proposedContent,
		);
		violations.push(...anyViolations);
	}

	// Rule 3: Protect test cases from deletion
	if (config.protectTestCases && originalContent !== proposedContent) {
		const testViolations = detectDeletedTestBlocks(
			filePath,
			originalContent,
			proposedContent,
		);
		violations.push(...testViolations);
	}

	// Rule 4: Preserve exported API signatures
	if (config.preserveExportSignatures && originalContent !== proposedContent) {
		const exportViolations = detectExportSignatureModifications(
			filePath,
			originalContent,
			proposedContent,
		);
		violations.push(...exportViolations);
	}

	return buildResult(config, filePath, violations);
}

/**
 * Evaluates a `file_op` delete, move or copy. These carry no new content, so
 * only the protected-path rule applies: deleting or moving away a protected
 * file, or moving or copying over one, is a mutation of that path.
 */
export function evaluatePathMutation(
	operation: 'delete' | 'move' | 'copy',
	paths: {source: string; destination?: string},
	customConfig?: Partial<FirewallConfig>,
): FirewallEvaluationResult {
	const config: FirewallConfig = {
		...getFirewallConfig(),
		...customConfig,
	};

	if (!config.enabled || config.mode === 'disabled') {
		return {allowed: true, violations: []};
	}

	// A copy leaves its source untouched; delete and move remove it.
	const touched: string[] = operation === 'copy' ? [] : [paths.source];
	if (operation !== 'delete' && paths.destination) {
		touched.push(paths.destination);
	}

	const violations: FirewallViolation[] = [];
	for (const path of touched) {
		if (isProtectedPath(path, config.protectedPatterns)) {
			violations.push({
				rule: 'protect_config_files',
				filePath: path,
				message: `Protected path ${operation} blocked.`,
				details: `Path '${path}' matches firewall protected patterns (${config.protectedPatterns.join(', ')}). Manual modification or explicit firewall configuration is required.`,
			});
		}
	}

	return buildResult(config, touched.join(', '), violations);
}

function buildResult(
	config: FirewallConfig,
	filePath: string,
	violations: FirewallViolation[],
): FirewallEvaluationResult {
	const lenient = config.mode === 'lenient';
	const allowed = lenient || violations.length === 0;

	let summary: string | undefined;
	if (violations.length > 0) {
		const formattedViolations = violations
			.map(
				(v, i) =>
					`${i + 1}. [${v.rule}] ${v.message} ${v.details ? `(${v.details})` : ''}`,
			)
			.join('\n');

		summary = lenient
			? `[Mutation Firewall] Warning (lenient mode, change was applied) for '${filePath}':\n${formattedViolations}`
			: `[Mutation Firewall] Blocked mutation for '${filePath}':\n${formattedViolations}`;
	}

	return {
		allowed,
		violations,
		summary,
	};
}

/**
 * Throws when the firewall blocked the mutation. Otherwise returns the text
 * a tool should append to its result: the lenient-mode warning, or '' when
 * there were no violations. In lenient mode the warning is the only way the
 * model and the user learn the change broke a rule, so it goes into the tool
 * result for the model and into the chat as a warning for the user.
 */
export function enforceFirewall(result: FirewallEvaluationResult): string {
	if (!result.allowed) {
		throw new Error(result.summary ?? 'Mutation blocked by firewall');
	}
	if (!result.summary) return '';
	logWarning(result.summary, true, {source: 'mutation-firewall'});
	return `\n\n${result.summary}`;
}
