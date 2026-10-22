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

export interface FirewallEvaluationResult {
	allowed: boolean;
	violations: FirewallViolation[];
	summary?: string;
}
