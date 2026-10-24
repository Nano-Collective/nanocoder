import {CALIBRATION_TESTS} from '@/calibration/calibration-tests';
import type {
	CalibrationProfile,
	CalibrationTestResult,
	ModelCapabilityTier,
} from '@/types/calibration';
import type {LLMClient, Message, StreamCallbacks} from '@/types/index';

export interface CalibrationOptions {
	onProgress?: (testName: string, index: number, total: number) => void;
	timeoutMs?: number;
}

/**
 * Runs a deterministic calibration benchmark against the active LLM client.
 */
export async function runCalibration(
	client: LLMClient,
	options?: CalibrationOptions,
): Promise<CalibrationProfile> {
	const model = client.getCurrentModel();
	const providerConfig = client.getProviderConfig();
	const provider = providerConfig.name || 'default';
	const endpoint = providerConfig.config.baseURL;

	const testResults: CalibrationTestResult[] = [];

	for (let i = 0; i < CALIBRATION_TESTS.length; i++) {
		const test = CALIBRATION_TESTS[i];
		options?.onProgress?.(test.name, i + 1, CALIBRATION_TESTS.length);

		const messages: Message[] = [
			{
				role: 'user',
				content: test.prompt,
			},
		];

		let responseText = '';
		const startTime = Date.now();

		const callbacks: StreamCallbacks = {
			onToken: (token: string) => {
				responseText += token;
			},
			onFinish: () => {},
		};

		try {
			await client.chat(messages, {}, callbacks);
		} catch (error: unknown) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			testResults.push({
				id: test.id,
				name: test.name,
				description: test.description,
				passed: false,
				score: 0,
				latencyMs: Date.now() - startTime,
				details: `Inference error: ${errorMsg}`,
				rawResponse: '',
			});
			continue;
		}

		const latencyMs = Date.now() - startTime;
		const validation = test.validate(responseText);

		testResults.push({
			id: test.id,
			name: test.name,
			description: test.description,
			passed: validation.passed,
			score: validation.score,
			latencyMs,
			details: validation.details,
			rawResponse: responseText,
		});
	}

	const totalScore = testResults.reduce((sum, res) => sum + res.score, 0);
	const overallScore =
		testResults.length > 0 ? Math.round(totalScore / testResults.length) : 0;

	let tier: ModelCapabilityTier;
	let recommendedProfile: 'full' | 'minimal' | 'nano';
	let recommendedToolMode: 'native' | 'xml' | 'json';
	let recommendedAggressiveCompact: boolean;

	if (overallScore >= 80) {
		tier = 'tier-1';
		recommendedProfile = 'full';
		recommendedToolMode = 'native';
		recommendedAggressiveCompact = false;
	} else if (overallScore >= 50) {
		tier = 'tier-2';
		recommendedProfile = 'minimal';
		recommendedToolMode = 'xml';
		recommendedAggressiveCompact = true;
	} else {
		tier = 'tier-3';
		recommendedProfile = 'nano';
		recommendedToolMode = 'xml';
		recommendedAggressiveCompact = true;
	}

	return {
		provider,
		model,
		endpoint,
		timestamp: Date.now(),
		overallScore,
		tier,
		recommendedProfile,
		recommendedToolMode,
		recommendedAggressiveCompact,
		testResults,
	};
}
