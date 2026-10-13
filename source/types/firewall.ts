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
	enabled: true,
	mode: 'strict',
	blockAnyTypes: true,
	protectTestCases: true,
	preserveExportSignatures: true,
	protectedPatterns: [
		'package.json',
		'pnpm-lock.yaml',
		'package-lock.json',
		'yarn.lock',
		'.github/workflows/**',
		'tsconfig*.json',
		'biome.json',
	],
};

export interface FirewallEvaluationResult {
	allowed: boolean;
	violations: FirewallViolation[];
	summary?: string;
}
