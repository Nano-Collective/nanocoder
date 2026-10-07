import type {ToolMode, ToolProfile} from './config';

export type CalibrationTestId =
	| 'json_schema'
	| 'instruction_following'
	| 'tool_syntax_matching';

export type ModelCapabilityTier = 'tier-1' | 'tier-2' | 'tier-3';

export interface CalibrationTestResult {
	id: CalibrationTestId;
	name: string;
	description: string;
	passed: boolean;
	score: number; // 0 to 100
	latencyMs: number;
	details?: string;
	rawResponse?: string;
}

export interface CalibrationProfile {
	provider: string;
	model: string;
	endpoint?: string;
	timestamp: number;
	overallScore: number; // 0 to 100
	tier: ModelCapabilityTier;
	recommendedProfile: Exclude<ToolProfile, 'auto'>;
	recommendedToolMode: ToolMode;
	recommendedAggressiveCompact: boolean;
	testResults: CalibrationTestResult[];
}

export interface CalibrationTestDefinition {
	id: CalibrationTestId;
	name: string;
	description: string;
	prompt: string;
	validate: (response: string) => {
		passed: boolean;
		score: number;
		details?: string;
	};
}
