import {Box, Text} from 'ink';
import React from 'react';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {getSequenceTracker} from '@/macros/sequence-tracker';
import {generateKey} from '@/session/key-generator';
import type {Command} from '@/types/index';
import type {WorkflowPattern} from '@/types/macros';
import {successMsg} from '@/utils/message-factory';

export interface MacroWorkflowViewProps {
	patterns: WorkflowPattern[];
}

export function MacroWorkflowView({patterns}: MacroWorkflowViewProps) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();

	return (
		<TitledBoxWithPreferences
			title="/macros · discovered workflow patterns"
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			<Box marginBottom={1}>
				<Text bold color={colors.text}>
					Tracked Read-Only Workflow Patterns:
				</Text>
			</Box>

			{patterns.length === 0 ? (
				<Box marginLeft={2} marginBottom={1}>
					<Text color={colors.secondary}>
						No repeated read-only tool sequences detected yet in this session.
					</Text>
				</Box>
			) : (
				patterns.map(p => (
					<Box
						key={p.id}
						flexDirection="column"
						marginLeft={2}
						marginBottom={1}
					>
						<Box>
							<Text bold color={colors.primary}>
								[{p.id}]
							</Text>
							<Text color={colors.text}> {p.signature}</Text>
							<Text color={colors.secondary}>
								{' '}
								— {p.occurrences} {p.occurrences === 1 ? 'time' : 'times'}
							</Text>
						</Box>
					</Box>
				))
			)}

			<Box marginTop={1}>
				<Text color={colors.secondary}>
					Tip: Discovered read-only patterns represent recurring candidate
					workflows in this session.
				</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}

export const macrosCommand: Command = {
	name: 'macros',
	description:
		'Inspect repeated read-only tool sequences (/macros, /macros clear)',
	handler: async (args, _messages, _metadata) => {
		const tracker = getSequenceTracker();
		const sub = (args[0] ?? '').toLowerCase().trim();

		if (sub === 'clear') {
			tracker.clear();
			return successMsg(
				'Cleared sequence tracker history and discovered patterns.',
				'macros',
			);
		}

		const patterns = tracker.getCandidates();
		return React.createElement(MacroWorkflowView, {
			key: generateKey('macros'),
			patterns,
		});
	},
};
