import {Box, Text} from 'ink';
import React from 'react';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {generateKey} from '@/session/key-generator';
import type {Command} from '@/types/index';
import type {AgentPhase, ModelResidencyState, VramStrategy} from '@/types/vram';
import {errorMsg, successMsg} from '@/utils/message-factory';
import {getVramAllocator} from '@/vram/vram-allocator';

export interface VramStatusViewProps {
	phase: AgentPhase;
	strategy: VramStrategy;
	unloadOnExecution: boolean;
	models: ModelResidencyState[];
}

export function VramStatusView({
	phase,
	strategy,
	unloadOnExecution,
	models,
}: VramStatusViewProps) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();

	const phaseColor =
		phase === 'generation'
			? colors.primary
			: phase === 'execution'
				? colors.warning
				: phase === 'retrieval'
					? colors.secondary
					: colors.text;

	return (
		<TitledBoxWithPreferences
			title="/vram · GPU memory & model residency orchestrator"
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
						Current Agent Phase:{' '}
					</Text>
					<Text bold color={phaseColor}>
						{phase.toUpperCase()}
					</Text>
				</Box>
				<Box marginTop={1}>
					<Text bold color={colors.text}>
						Allocation Strategy:{' '}
					</Text>
					<Text bold color={colors.primary}>
						{strategy}
					</Text>
					<Text color={colors.secondary}>
						{' '}
						(Unload on build/bash tools: {unloadOnExecution ? 'yes' : 'no'})
					</Text>
				</Box>
			</Box>

			<Box flexDirection="column" marginTop={1}>
				<Text bold color={colors.text}>
					Tracked Model Residency:
				</Text>
				{models.length === 0 ? (
					<Box marginLeft={2} marginTop={1}>
						<Text color={colors.secondary}>
							No active local models currently tracked in residency state.
						</Text>
					</Box>
				) : (
					models.map(m => (
						<Box key={m.model} marginLeft={2} marginTop={1}>
							<Text color={m.isLoaded ? colors.success : colors.secondary} bold>
								{m.isLoaded ? '● ' : '○ '}
							</Text>
							<Text bold color={colors.text}>
								{m.model}
							</Text>
							<Text color={colors.secondary}>
								{' '}
								({m.role}) —{' '}
								{m.isLoaded ? 'VRAM Resident' : 'Evicted / Unloaded'}
							</Text>
						</Box>
					))
				)}
			</Box>

			<Box marginTop={1}>
				<Text color={colors.secondary}>
					Tip: Use &apos;/vram unload&apos; to immediately free GPU memory, or
					&apos;/vram mode &lt;aggressive|balanced|disabled&gt;&apos; to adjust
					behavior.
				</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}

export const vramCommand: Command = {
	name: 'vram',
	description:
		'Manage phase-aware GPU memory & model residency (subcommands: unload, mode)',
	handler: async (args, _messages, metadata) => {
		const allocator = getVramAllocator();
		const sub = (args[0] ?? '').toLowerCase().trim();

		if (sub === 'unload') {
			const targetModel = args[1]?.trim();
			if (targetModel) {
				await allocator.evictModel(targetModel);
				return successMsg(
					`Dispatched VRAM unload for model '${targetModel}'.`,
					'vram',
				);
			}

			const states = allocator.getResidencyStates();
			for (const s of states) {
				await allocator.evictModel(s.model, s.backendUrl);
			}
			return successMsg(
				`Dispatched VRAM unload for all ${states.length} tracked models.`,
				'vram',
			);
		}

		if (sub === 'mode') {
			const mode = (args[1] ?? '').toLowerCase().trim() as VramStrategy;
			if (mode === 'aggressive' || mode === 'balanced' || mode === 'disabled') {
				allocator.setConfig({strategy: mode});
				return successMsg(
					`VRAM allocator strategy updated to '${mode}'.`,
					'vram',
				);
			}
			return errorMsg(
				'Invalid strategy. Usage: /vram mode <aggressive|balanced|disabled>',
				'vram',
			);
		}

		if (metadata.model) {
			allocator.registerModel(metadata.model, 'coder');
		}

		return React.createElement(VramStatusView, {
			key: generateKey('vram'),
			phase: allocator.getCurrentPhase(),
			strategy: allocator.getConfig().strategy,
			unloadOnExecution: allocator.getConfig().unloadOnExecution,
			models: allocator.getResidencyStates(),
		});
	},
};
