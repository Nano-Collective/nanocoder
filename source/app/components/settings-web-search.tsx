import {Box, Text, useInput} from 'ink';
import {useState} from 'react';
import TextInput from '@/components/text-input';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {updateConfigNestedValue} from '@/config/config-writer';
import {getAppConfig} from '@/config/index';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';

interface SettingsWebSearchPanelProps {
	onBack: () => void;
	onCancel: () => void;
}

export function SettingsWebSearchPanel({
	onBack,
	onCancel,
}: SettingsWebSearchPanelProps) {
	const {colors} = useTheme();
	const {boxWidth, isNarrow} = useResponsiveTerminal();

	const currentApiKey = getAppConfig().nanocoderTools?.webSearch?.apiKey ?? '';
	const hasApiKey = Boolean(currentApiKey);
	const [editMode, setEditMode] = useState(false);
	const [inputValue, setInputValue] = useState('');
	const [saved, setSaved] = useState(false);

	useInput((_, key) => {
		if (key.escape) {
			if (editMode) {
				setEditMode(false);
				setInputValue('');
			} else {
				onCancel();
			}
		}
		if (key.shift && key.tab && !editMode) {
			onBack();
		}
	});

	const handleSave = (value: string) => {
		const trimmed = value.trim();
		if (trimmed) {
			updateConfigNestedValue('nanocoderTools', 'webSearch', {
				apiKey: trimmed,
			});
			setSaved(true);
			setTimeout(() => {
				setEditMode(false);
				setInputValue('');
				setSaved(false);
			}, 1500);
		} else {
			setEditMode(false);
			setInputValue('');
		}
	};

	const title = isNarrow ? 'Web Search' : 'Settings · Web Search';

	if (isNarrow) {
		return (
			<TitledBoxWithPreferences
				title={title}
				width="100%"
				borderColor={colors.primary}
				paddingX={2}
				paddingY={1}
				flexDirection="column"
				marginBottom={1}
			>
				{saved ? (
					<Text color={colors.success}>✓ API key saved!</Text>
				) : editMode ? (
					<Box flexDirection="column">
						<Text color={colors.secondary}>Enter Brave Search API key:</Text>
						<Box
							marginBottom={1}
							borderStyle="round"
							borderColor={colors.secondary}
						>
							<TextInput
								value={inputValue}
								onChange={setInputValue}
								onSubmit={handleSave}
								mask="*"
							/>
						</Box>
						<Text color={colors.secondary}>Enter to save · Esc to cancel</Text>
					</Box>
				) : (
					<Box flexDirection="column">
						<Text color={colors.text}>
							{hasApiKey ? '✓ API key is configured' : 'No API key configured'}
						</Text>
						<Text color={colors.secondary}>
							{hasApiKey
								? 'Press Enter to change'
								: 'Press Enter to add (Brave Search)'}
						</Text>
						<Box marginBottom={1}></Box>
						<Text color={colors.secondary}>Enter/Shift+Tab/Esc</Text>
					</Box>
				)}
			</TitledBoxWithPreferences>
		);
	}

	return (
		<TitledBoxWithPreferences
			title={title}
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			{saved ? (
				<Box marginBottom={1}>
					<Text color={colors.success}>✓ API key saved!</Text>
				</Box>
			) : editMode ? (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={colors.secondary}>
							Enter your Brave Search API key. Leave empty to cancel.
						</Text>
					</Box>
					<Box
						marginBottom={1}
						borderStyle="round"
						borderColor={colors.secondary}
					>
						<TextInput
							value={inputValue}
							onChange={setInputValue}
							onSubmit={handleSave}
							mask="*"
						/>
					</Box>
					<Text color={colors.secondary}>Enter to save · Esc to cancel</Text>
				</Box>
			) : (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={colors.secondary}>
							Web search uses the Brave Search API.{' '}
							{hasApiKey
								? 'Your API key is configured.'
								: 'No API key is set — web search is unavailable.'}
						</Text>
					</Box>
					<Text color={colors.text}>
						{hasApiKey ? '✓ API key is configured' : 'No API key configured'}
					</Text>
					<Box marginTop={1}>
						<Text color={colors.secondary}>
							Press Enter to {hasApiKey ? 'change' : 'add'} API key. Shift+Tab
							to go back, Esc to exit
						</Text>
					</Box>
				</Box>
			)}
		</TitledBoxWithPreferences>
	);
}
