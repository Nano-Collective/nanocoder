import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import {useState} from 'react';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';

export interface VoiceInstallPromptProps {
	missing: ('sox' | 'whisper' | 'piper')[];
	installDependencies?: (
		onProgress: (step: string, percent: number) => void,
	) => Promise<void>;
	onConfirm: () => void;
	onDecline: () => void;
}

enum OptionValue {
	Yes = 'yes',
	No = 'no',
}

export function VoiceInstallPrompt({
	missing,
	installDependencies,
	onConfirm,
	onDecline,
}: VoiceInstallPromptProps) {
	const {colors} = useTheme();
	const boxWidth = useTerminalWidth();

	const [isInstalling, setIsInstalling] = useState(false);
	const [progressStep, setProgressStep] = useState<string>('');
	const [progressPercent, setProgressPercent] = useState<number>(0);
	const [errorMessage, setErrorMessage] = useState<string | undefined>(
		undefined,
	);

	useInput((_input, key) => {
		if (errorMessage) {
			if (key.return || key.escape) {
				onDecline();
			}
			return;
		}
		if (key.escape && !isInstalling) {
			onDecline();
		}
	});

	const items = [
		{
			label: 'Yes, install now',
			value: OptionValue.Yes,
		},
		{
			label: 'No, skip for this session',
			value: OptionValue.No,
		},
	];

	const handleSelect = async (item: {value: OptionValue}) => {
		if (item.value === OptionValue.No) {
			onDecline();
			return;
		}

		if (isInstalling) return;

		setIsInstalling(true);
		setErrorMessage(undefined);
		setProgressPercent(0);
		setProgressStep('Starting installation...');

		try {
			if (installDependencies) {
				await installDependencies((step, percent) => {
					setProgressStep(step);
					setProgressPercent(percent);
				});
			}
			onConfirm();
		} catch (err) {
			setIsInstalling(false);
			setErrorMessage(err instanceof Error ? err.message : String(err));
		}
	};

	const missingList =
		missing.length > 0 ? missing.join(', ') : 'sox, whisper.cpp, piper';

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
					Voice Mode Dependencies Missing
				</Text>
			</Box>

			{errorMessage ? (
				<Box flexDirection="column">
					<Text color={colors.error}>Error: {errorMessage}</Text>
					<Box marginTop={1}>
						<Text color={colors.secondary}>
							Press Esc or Enter to continue without voice mode...
						</Text>
					</Box>
				</Box>
			) : isInstalling ? (
				<Box flexDirection="column">
					<Text color={colors.primary}>
						Installing missing voice tools ({missingList})...
					</Text>
					{progressStep !== '' && (
						<Box marginTop={1}>
							<Text color={colors.secondary} italic>
								{progressStep} ({progressPercent}%)
							</Text>
						</Box>
					)}
				</Box>
			) : (
				<Box flexDirection="column">
					<Text color={colors.text}>
						Voice mode requires {missingList} (~150 MB total). Install now?
					</Text>
					<Box marginTop={1}>
						<SelectInput items={items} onSelect={handleSelect} />
					</Box>
					<Box marginTop={1}>
						<Text color={colors.secondary}>
							Up/Down to move · Enter to select · Esc to decline for this
							session
						</Text>
					</Box>
				</Box>
			)}
		</Box>
	);
}
