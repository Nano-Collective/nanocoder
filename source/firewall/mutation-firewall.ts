import {relative, resolve} from 'node:path';
import ignore from 'ignore';
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

let currentConfig: FirewallConfig = {...FIREWALL_DEFAULTS};

/**
 * Gets the current active firewall configuration.
 */
export function getFirewallConfig(): FirewallConfig {
	return {...currentConfig};
}

/**
 * Updates the active firewall configuration.
 */
export function setFirewallConfig(
	config: Partial<FirewallConfig>,
): FirewallConfig {
	const nextMode = config.mode ?? currentConfig.mode;
	const nextEnabled =
		config.enabled !== undefined
			? config.enabled
			: config.mode !== undefined
				? config.mode !== 'disabled'
				: currentConfig.enabled;

	currentConfig = {
		...currentConfig,
		...config,
		enabled: nextEnabled,
		mode: nextMode,
		protectedPatterns: config.protectedPatterns
			? [...config.protectedPatterns]
			: currentConfig.protectedPatterns,
	};
	return getFirewallConfig();
}

/**
 * Resets the firewall configuration to defaults.
 */
export function resetFirewallConfig(): FirewallConfig {
	currentConfig = {...FIREWALL_DEFAULTS};
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
		...currentConfig,
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
