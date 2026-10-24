import {Box, Text} from 'ink';
import React from 'react';
import {
	clearCalibrationProfile,
	getCalibrationProfile,
	saveCalibrationProfile,
} from '@/calibration/calibration-store';
import {runCalibration} from '@/calibration/model-calibrator';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {generateKey} from '@/session/key-generator';
import type {CalibrationProfile} from '@/types/calibration';
import type {Command} from '@/types/index';
import {errorMsg, successMsg} from '@/utils/message-factory';

export interface CalibrationViewProps {
	profile: CalibrationProfile;
}

export function CalibrationView({profile}: CalibrationViewProps) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();

	const tierColor =
		profile.tier === 'tier-1'
			? colors.success
			: profile.tier === 'tier-2'
				? colors.warning
				: colors.error;

	const tierLabel =
		profile.tier === 'tier-1'
			? 'Tier 1 (Advanced / Full)'
			: profile.tier === 'tier-2'
				? 'Tier 2 (Standard / Minimal)'
				: 'Tier 3 (Constrained / Nano)';

	return (
		<TitledBoxWithPreferences
			title="/calibrate · model capability benchmark"
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			<Box marginBottom={1} flexDirection="column">
				<Box>
					<Text bold color={colors.text}>
						Model:{' '}
					</Text>
					<Text color={colors.primary}>{profile.model}</Text>
					<Text color={colors.secondary}> ({profile.provider})</Text>
				</Box>
				<Box marginTop={1}>
					<Text bold color={colors.text}>
						Capability Rating:{' '}
					</Text>
					<Text bold color={tierColor}>
						{tierLabel} — Overall Score: {profile.overallScore}%
					</Text>
				</Box>
			</Box>

			<Box marginBottom={1} flexDirection="column">
				<Text bold color={colors.text}>
					Benchmark Tests:
				</Text>
				{profile.testResults.map(test => (
					<Box
						key={test.id}
						flexDirection="column"
						marginLeft={2}
						marginTop={1}
					>
						<Box>
							<Text color={test.passed ? colors.success : colors.error} bold>
								{test.passed ? '✓' : '✗'}{' '}
							</Text>
							<Text bold color={colors.text}>
								{test.name}
							</Text>
							<Text color={colors.secondary}>
								{' '}
								— Score: {test.score}/100 ({test.latencyMs}ms)
							</Text>
						</Box>
						{test.details && (
							<Box marginLeft={2}>
								<Text color={colors.secondary}>{test.details}</Text>
							</Box>
						)}
					</Box>
				))}
			</Box>

			<Box
				flexDirection="column"
				borderStyle="single"
				borderColor={colors.secondary}
				paddingX={1}
				paddingY={0}
				marginTop={1}
			>
				<Text bold color={colors.primary}>
					Auto-Tuned Recommendation Applied:
				</Text>
				<Text color={colors.text}>
					• Tool Profile: <Text bold>{profile.recommendedProfile}</Text>
				</Text>
				<Text color={colors.text}>
					• Tool Mode: <Text bold>{profile.recommendedToolMode}</Text>
				</Text>
				<Text color={colors.text}>
					• Aggressive Compaction:{' '}
					<Text bold>
						{profile.recommendedAggressiveCompact ? 'enabled' : 'disabled'}
					</Text>
				</Text>
			</Box>

			<Box marginTop={1}>
				<Text color={colors.secondary}>
					Profile saved to local preferences. Auto tool profiling will now use
					this calibrated profile.
				</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}

export const calibrateCommand: Command = {
	name: 'calibrate',
	description:
		'Benchmark active model capabilities and auto-tune tool profiles (use reset to clear, view to inspect)',
	progressLabel: 'Calibrating model capabilities',
	handler: async (args, _messages, metadata) => {
		const sub = (args[0] ?? '').toLowerCase().trim();
		const provider = metadata.provider;
		const model = metadata.model;

		if (sub === 'reset' || sub === '--reset') {
			clearCalibrationProfile(provider, model);
			return successMsg(
				`Cleared calibration profile for ${provider}:${model}. Reverted to heuristic auto-tuning.`,
				'calibrate',
			);
		}

		if (sub === 'view' || sub === 'status' || sub === '--view') {
			const existing = getCalibrationProfile(provider, model);
			if (!existing) {
				return errorMsg(
					`No calibration profile found for ${provider}:${model}. Run /calibrate to benchmark this model.`,
					'calibrate',
				);
			}
			return React.createElement(CalibrationView, {
				key: generateKey('calibrate'),
				profile: existing,
			});
		}

		if (!metadata.client) {
			return errorMsg(
				'No active LLM client available to run calibration.',
				'calibrate',
			);
		}

		try {
			const profile = await runCalibration(metadata.client);
			saveCalibrationProfile(profile);

			return React.createElement(CalibrationView, {
				key: generateKey('calibrate'),
				profile,
			});
		} catch (err: unknown) {
			const errorText = err instanceof Error ? err.message : String(err);
			return errorMsg(
				`Failed to complete model calibration: ${errorText}`,
				'calibrate',
			);
		}
	},
};
