/**
 * PlanReviewPrompt — post-plan-generation action bar (Issue #96)
 *
 * Rendered after the AI finishes generating a plan in Plan Mode. Uses the same
 * up/down/Enter SelectInput pattern as the rest of the app (tool confirmation,
 * selectors) so it stays readable on narrow terminals instead of wrapping a row
 * of hotkey labels. The highlighted action's description is shown below the
 * list; Escape takes the non-executing revision path.
 *
 *   Yes      — switch to normal mode and execute the persisted plan
 *   No       — stay in plan mode and let the user request changes
 *   Ask more — stay in plan mode and have the model ask clarifying questions
 *   [Esc]    — same as No; never exits Plan Mode implicitly
 */
import {basename} from 'node:path';
import {Box, Text, useInput} from 'ink';
import {useState} from 'react';
import {StyledSelectInput} from '@/components/ui/styled-select-input';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {createTerminalFileLink as createFileLink} from '@/utils/terminal-file-link';

export function createTerminalFileLink(filePath: string): string {
	return createFileLink(filePath, `Open ${basename(filePath)}`);
}

export interface PlanReviewPromptProps {
	/** Absolute path of the persisted implementation plan. */
	artifactPath?: string;
	/** Switch to normal mode and execute the plan. */
	onProceed: () => void;
	/** Stay in plan mode so the user can refine the prompt. */
	onModify: () => void;
	/** Stay in plan mode and ask additional clarifying questions. */
	onAskMore: () => void;
}

type PlanAction = 'proceed' | 'modify' | 'askMore';

interface PlanOption {
	label: string;
	value: PlanAction;
	description: string;
}

const OPTIONS: PlanOption[] = [
	{
		label: 'Yes, execute this plan',
		value: 'proceed',
		description: 'Exit Plan Mode and begin implementation',
	},
	{
		label: 'No, tell Nanocoder what to change',
		value: 'modify',
		description: 'Stay in Plan Mode and revise the plan',
	},
	{
		label: 'Ask me clarifying questions',
		value: 'askMore',
		description: 'Stay in Plan Mode and answer follow-up questions first',
	},
];

export default function PlanReviewPrompt({
	artifactPath,
	onProceed,
	onModify,
	onAskMore,
}: PlanReviewPromptProps) {
	const {colors} = useTheme();
	const boxWidth = useTerminalWidth();
	const [highlighted, setHighlighted] = useState<PlanAction>('proceed');

	// SelectInput owns up/down/Enter. Escape is the safe, non-executing path.
	useInput((_input, key) => {
		if (key.escape) {
			onModify();
		}
	});

	const handleSelect = (item: {value: PlanAction}) => {
		if (item.value === 'proceed') {
			onProceed();
		} else if (item.value === 'askMore') {
			onAskMore();
		} else {
			onModify();
		}
	};

	const activeDescription =
		OPTIONS.find(o => o.value === highlighted)?.description ?? '';

	return (
		<Box
			flexDirection="column"
			marginTop={1}
			marginBottom={1}
			padding={1}
			width={boxWidth}
			borderStyle="bold"
			borderLeft={true}
			borderRight={false}
			borderTop={false}
			borderBottom={false}
			borderLeftColor={colors.primary}
		>
			<Box marginBottom={2}>
				<Text color={colors.primary} bold>
					📋 Plan ready.{' '}
				</Text>
				<Text color={colors.secondary}>What would you like to do?</Text>
			</Box>

			{artifactPath && (
				<Box flexDirection="column" marginBottom={2}>
					<Text color={colors.secondary}>Saved plan</Text>

					{/* The link is the actionable thing, so it leads. The raw path
					    sits below it, dimmed and separated — it is the fallback for
					    terminals without OSC-8 hyperlinks, and for copy/paste. */}
					<Box marginTop={1}>
						<Text color={colors.primary} underline>
							{createTerminalFileLink(artifactPath)}
						</Text>
						<Text color={colors.secondary}> · Cmd/Ctrl+click to open</Text>
					</Box>

					<Box marginTop={1}>
						<Text color={colors.secondary} dimColor wrap="wrap">
							{artifactPath}
						</Text>
					</Box>
				</Box>
			)}

			<StyledSelectInput
				items={OPTIONS}
				onSelect={handleSelect}
				onHighlight={item => setHighlighted(item.value)}
			/>

			{/* The highlighted option's description already states whether the
			    choice leaves Plan Mode, so there is no separate summary line. */}
			<Box marginTop={1} marginBottom={1}>
				<Text color={colors.secondary} italic wrap="wrap">
					{activeDescription}
				</Text>
			</Box>

			<Box>
				<Text color={colors.secondary} dimColor>
					↑/↓ to move · Enter to select · Esc to request changes
				</Text>
			</Box>
		</Box>
	);
}
