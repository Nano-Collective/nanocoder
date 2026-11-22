import {Box, Text, useFocus, useInput} from 'ink';
import Spinner from 'ink-spinner';
import {useEffect, useRef, useState} from 'react';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';

export interface BtwRunResult {
	answer: string;
	error?: string;
}

export interface BtwDisplayProps {
	question: string;
	interactive?: boolean;
	onClose?: () => void;
	runRequest: (
		signal: AbortSignal,
		onToken: (token: string) => void,
	) => Promise<BtwRunResult>;
}

export function BtwDisplay({
	question,
	interactive = true,
	onClose,
	runRequest,
}: BtwDisplayProps) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();
	const [answer, setAnswer] = useState('');
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const startedRef = useRef(false);

	useFocus({autoFocus: interactive, id: 'btw-display'});

	useInput(
		(input, key) => {
			if (!interactive) return;
			if (key.escape || key.return || input === 'q' || input === 'Q') {
				onClose?.();
			}
		},
		{isActive: interactive},
	);

	useEffect(() => {
		if (startedRef.current) return;
		startedRef.current = true;

		const controller = new AbortController();
		void (async () => {
			try {
				const result = await runRequest(controller.signal, token => {
					if (controller.signal.aborted) return;
					setAnswer(prev => prev + token);
				});
				if (controller.signal.aborted) return;
				if (result.answer) {
					setAnswer(result.answer);
				}
				setError(result.error ?? null);
			} catch (err) {
				if (controller.signal.aborted) return;
				setError(err instanceof Error ? err.message : String(err));
			} finally {
				if (!controller.signal.aborted) {
					setIsLoading(false);
				}
			}
		})();

		return () => {
			controller.abort();
		};
	}, [runRequest]);

	// Release capture/command state if the panel is unmounted unexpectedly
	// (for example, when another live component overwrites the slot).
	useEffect(() => {
		return () => {
			onClose?.();
		};
	}, [onClose]);

	const contentWidth = Math.max(24, boxWidth - 8);

	return (
		<TitledBoxWithPreferences
			title="/btw"
			width={boxWidth}
			borderColor={colors.info}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			<Box flexDirection="column" width={contentWidth}>
				<Text color={colors.secondary} wrap="wrap">
					{question}
				</Text>

				<Box marginTop={1} flexDirection="column">
					{error ? (
						<Text color={colors.error} wrap="wrap">
							{error}
						</Text>
					) : (
						<>
							{answer ? (
								<Text color={colors.text} wrap="wrap">
									{answer}
								</Text>
							) : null}
							{isLoading ? (
								<Box marginTop={answer ? 1 : 0}>
									<Text color={colors.primary}>
										<Spinner type="dots" />
									</Text>
									<Text color={colors.secondary}> Thinking...</Text>
								</Box>
							) : !answer ? (
								<Text color={colors.secondary}>(No response)</Text>
							) : null}
						</>
					)}
				</Box>
			</Box>

			<Box marginTop={1}>
				<Text color={colors.secondary}>
					{interactive
						? 'Esc/Enter/q close · not saved to conversation'
						: 'Not saved to conversation'}
				</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}
