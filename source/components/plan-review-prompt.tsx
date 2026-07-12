/**
 * PlanReviewPrompt — post-plan-generation action bar (Issue #96)
 *
 * Rendered after the AI finishes generating a plan in Plan Mode. Uses the same
 * up/down/Enter SelectInput pattern as the rest of the app (tool confirmation,
 * selectors) so it stays readable on narrow terminals instead of wrapping a row
 * of hotkey labels. The highlighted action's description is shown below the
 * list; Escape dismisses.
 *
 *   Proceed  — switch to normal mode and execute the plan
 *   Modify   — stay in plan mode, let the user refine their request
 *   Ask more — ask additional clarifying questions
 *   [Esc]    — dismiss the prompt, do nothing
 */
import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import {useState} from 'react';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';

export interface PlanReviewPromptProps {
	/** Switch to normal mode and execute the plan. */
	onProceed: () => void;
	/** Stay in plan mode so the user can refine the prompt. */
	onModify: () => void;
	/** Ask additional clarifying questions. */
	onAskMore: () => void;
	/** Dismiss the prompt without any action. */
	onDismiss: () => void;
}

type PlanAction = 'proceed' | 'modify' | 'askMore';

interface PlanOption {
	label: string;
	value: PlanAction;
	description: string;
}

const OPTIONS: PlanOption[] = [
	{
		label: 'Proceed',
		value: 'proceed',
		description: 'Switch to normal mode and execute the plan',
	},
	{
		label: 'Modify',
		value: 'modify',
		description: 'Refine your request and re-plan',
	},
	{
		label: 'Ask more',
		value: 'askMore',
		description: 'Answer additional clarifying questions',
	},
];

export default function PlanReviewPrompt({
	onProceed,
	onModify,
	onAskMore,
	onDismiss,
}: PlanReviewPromptProps) {
	const {colors} = useTheme();
	const boxWidth = useTerminalWidth();
	const [highlighted, setHighlighted] = useState<PlanAction>('proceed');

	// SelectInput owns up/down/Enter. We only handle Escape (dismiss).
	useInput((_input, key) => {
		if (key.escape) {
			onDismiss();
		}
	});

	const handleSelect = (item: {value: PlanAction}) => {
		if (item.value === 'proceed') {
			onProceed();
		} else if (item.value === 'modify') {
			onModify();
		} else {
			onAskMore();
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

			<SelectInput
				items={OPTIONS}
				onSelect={handleSelect}
				onHighlight={item => setHighlighted(item.value)}
			/>

			<Box marginTop={1}>
				<Text color={colors.secondary} italic wrap="wrap">
					{activeDescription}
				</Text>
			</Box>

			<Box marginTop={1}>
				<Text color={colors.secondary}>
					↑/↓ to move · Enter to select · Esc to dismiss
				</Text>
			</Box>
		</Box>
	);
}
