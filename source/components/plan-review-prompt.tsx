/**
 * PlanReviewPrompt — post-plan-generation action bar (Issue #96)
 *
 * Rendered after the AI finishes generating a plan in Plan Mode.
 * Gives the user three clear actions:
 *   [p] Proceed   — switch to normal mode and execute the plan
 *   [m] Modify    — stay in plan mode, let the user refine their request
 *   [a] Ask More  — ask additional clarifying questions
 *   [Esc] Dismiss — close the prompt, do nothing
 */
import {Box, Text, useInput} from 'ink';
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

export default function PlanReviewPrompt({
	onProceed,
	onModify,
	onAskMore,
	onDismiss,
}: PlanReviewPromptProps) {
	const {colors} = useTheme();
	const boxWidth = useTerminalWidth();

	useInput((input, key) => {
		if (input === 'p' || input === 'P') {
			onProceed();
		} else if (input === 'm' || input === 'M') {
			onModify();
		} else if (input === 'a' || input === 'A') {
			onAskMore();
		} else if (key.escape) {
			onDismiss();
		}
	});

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
			<Box flexDirection="column" marginLeft={1}>
				<Box marginBottom={0}>
					<Text color={colors.primary} bold>
						{'[p]'}{' '}
					</Text>
					<Text color={colors.text} bold>
						Proceed
					</Text>
					<Text color={colors.secondary}>
						{' — switch to normal mode and execute the plan'}
					</Text>
				</Box>
				<Box marginBottom={0}>
					<Text color={colors.primary} bold>
						{'[m]'}{' '}
					</Text>
					<Text color={colors.text} bold>
						Modify
					</Text>
					<Text color={colors.secondary}>
						{' — refine your request and re-plan'}
					</Text>
				</Box>
				<Box marginBottom={0}>
					<Text color={colors.primary} bold>
						{'[a]'}{' '}
					</Text>
					<Text color={colors.text} bold>
						Ask more
					</Text>
					<Text color={colors.secondary}>
						{' — ask additional clarifying questions'}
					</Text>
				</Box>
				<Box>
					<Text color={colors.secondary}>{'[Esc] Dismiss'}</Text>
				</Box>
			</Box>
		</Box>
	);
}
