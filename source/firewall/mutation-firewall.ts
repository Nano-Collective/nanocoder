import {relative, resolve} from 'node:path';
import ignore from 'ignore';
import {getAppConfig} from '@/config/index';
import type {
	FirewallConfig,
	FirewallEvaluationResult,
	FirewallViolation,
} from '@/types/firewall';
import {FIREWALL_DEFAULTS} from '@/types/firewall';
import {
	detectAnyTypeInjections,
	detectDeletedTestBlocks,
	detectExportSignatureModifications,
} from './ast-checker';

function resolveInitialConfig(): FirewallConfig {
	try {
		const appConfig = getAppConfig();
		if (appConfig.firewall) {
			const fw = appConfig.firewall;
			const enabled = fw.enabled ?? (fw.mode ? fw.mode !== 'disabled' : false);
			const mode = fw.mode ?? (enabled ? 'strict' : 'disabled');
			return {
				...FIREWALL_DEFAULTS,
				...fw,
				enabled,
				mode,
				protectedPatterns: fw.protectedPatterns
					? [...fw.protectedPatterns]
					: [],
			};
		}
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
 */
export function isProtectedPath(filePath: string, patterns: string[]): boolean {
	if (!patterns || patterns.length === 0) return false;

	// Normalize separators and strip leading ./
	const normalized = filePath.replace(/\\/g, '/');
	const clean = normalized.replace(/^\.\//, '');

	// Resolve absolute paths relative to current working directory
	const abs = resolve(clean);
	const rel = relative(process.cwd(), abs).replace(/\\/g, '/');
	const targetPath = (rel.startsWith('..') ? clean : rel).replace(
		/^\.?\/+/,
		'',
	);
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

	const allowed = config.mode === 'lenient' || violations.length === 0;

	let summary: string | undefined;
	if (violations.length > 0) {
		const formattedViolations = violations
			.map(
				(v, i) =>
					`${i + 1}. [${v.rule}] ${v.message} ${v.details ? `(${v.details})` : ''}`,
			)
			.join('\n');

		summary = `[Mutation Firewall] Blocked mutation for '${filePath}':\n${formattedViolations}`;
	}

	return {
		allowed,
		violations,
		summary,
	};
}
