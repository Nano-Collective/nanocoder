export type FirewallMode = 'strict' | 'lenient' | 'disabled';

export type FirewallRuleKind =
	| 'block_any_types'
	| 'protect_test_cases'
	| 'preserve_export_signatures'
	| 'protect_config_files';

export interface FirewallViolation {
	rule: FirewallRuleKind;
	message: string;
	filePath: string;
	details?: string;
}

export interface FirewallConfig {
	enabled: boolean;
	mode: FirewallMode;
	blockAnyTypes: boolean;
	protectTestCases: boolean;
	preserveExportSignatures: boolean;
	protectedPatterns: string[];
}

export const FIREWALL_DEFAULTS: FirewallConfig = {
	enabled: false,
	mode: 'disabled',
	blockAnyTypes: true,
	protectTestCases: true,
	preserveExportSignatures: true,
	protectedPatterns: [],
};

/**
 * The firewall settings that actually apply for a `nanocoder.firewall` block:
 * built-in defaults filled in, and `enabled`/`mode` derived from each other
 * when only one is set. Shared by the firewall itself and `nanocoder config`.
 */
export function resolveFirewallConfig(
	fw: Partial<FirewallConfig> | undefined,
): FirewallConfig {
	if (!fw) return {...FIREWALL_DEFAULTS};
	const enabled = fw.enabled ?? (fw.mode ? fw.mode !== 'disabled' : false);
	const mode = fw.mode ?? (enabled ? 'strict' : 'disabled');
	return {
		...FIREWALL_DEFAULTS,
		...fw,
		enabled,
		mode,
		protectedPatterns: fw.protectedPatterns ? [...fw.protectedPatterns] : [],
	};
}

export interface FirewallEvaluationResult {
	allowed: boolean;
	violations: FirewallViolation[];
	summary?: string;
}
