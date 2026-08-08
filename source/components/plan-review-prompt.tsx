/**
 * PlanReviewPrompt — post-plan-generation action bar (Issue #96)
 *
 * Rendered after the AI finishes generating a plan in Plan Mode. Uses the same
 * up/down/Enter SelectInput pattern as the rest of the app (tool confirmation,
 * selectors) so it stays readable on narrow terminals instead of wrapping a row
 * of hotkey labels. The highlighted action's description is shown below the
 * list; Escape takes the non-executing revision path.
 *
 *   Yes   — switch to normal mode and execute the persisted plan
 *   No    — stay in plan mode and let the user request changes
 *   [Esc] — same as No; never exits Plan Mode implicitly
 */
import {pathToFileURL} from 'node:url';
import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import {useState} from 'react';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';

const OSC_8 = '\u001B]8;;';
const OSC_TERMINATOR = '\u0007';

export function createTerminalFileLink(filePath: string): string {
	const fileUrl = pathToFileURL(filePath).href;
	return `${OSC_8}${fileUrl}${OSC_TERMINATOR}Open implementation_plan.md${OSC_8}${OSC_TERMINATOR}`;
}

export interface PlanReviewPromptProps {
	/** Absolute path of the persisted implementation plan. */
	artifactPath?: string;
	/** Switch to normal mode and execute the plan. */
	onProceed: () => void;
	/** Stay in plan mode so the user can refine the prompt. */
	onModify: () => void;
}

type PlanAction = 'proceed' | 'modify';

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
];

export default function PlanReviewPrompt({
	artifactPath,
	onProceed,
	onModify,
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
			<Box marginBottom={1}>
				<Text color={colors.primary} bold>
					📋 Plan ready.{' '}
				</Text>
				<Text color={colors.secondary}>What would you like to do?</Text>
			</Box>

			{artifactPath && (
				<Box flexDirection="column" marginBottom={1}>
					<Text color={colors.secondary}>Saved plan:</Text>
					<Text wrap="wrap">{artifactPath}</Text>
					<Text color={colors.primary} underline>
						{createTerminalFileLink(artifactPath)}
					</Text>
					<Text color={colors.secondary}>Cmd/Ctrl+Click to open</Text>
				</Box>
			)}

			<SelectInput
				items={OPTIONS}
				onSelect={handleSelect}
				onHighlight={item => setHighlighted(item.value)}
			/>

			<Box marginTop={1}>
				<Text color={colors.secondary}>
					Executing exits Plan Mode; requesting changes keeps it active.
				</Text>
			</Box>

			<Box marginTop={1}>
				<Text color={colors.secondary} italic wrap="wrap">
					{activeDescription}
				</Text>
			</Box>

			<Box marginTop={1}>
				<Text color={colors.secondary}>
					↑/↓ to move · Enter to select · Esc to request changes
				</Text>
			</Box>
		</Box>
	);
}
