import {Box, Text, useInput} from 'ink';
import {useState} from 'react';
import TextInput from '@/components/text-input';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {updateConfigNestedValue} from '@/config/config-writer';
import {getAppConfig} from '@/config/index';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';

/**
 * Web Search settings: set/replace the Brave Search API key that web_search
 * reads from nanocoder.nanocoderTools.webSearch.apiKey. Saves persist directly
 * and atomically (no keep/discard prompt).
 */
export function SettingsWebSearchPanel({
	onBack,
	onCancel,
}: {
	onBack: () => void;
	onCancel: () => void;
}) {
	const {colors} = useTheme();
	const {boxWidth, isNarrow} = useResponsiveTerminal();

	const [hasApiKey, setHasApiKey] = useState(() =>
		Boolean(getAppConfig().nanocoderTools?.webSearch?.apiKey),
	);
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
			return;
		}
		if (key.shift && key.tab && !editMode) {
			onBack();
			return;
		}
		if (key.return && !editMode && !saved) {
			setEditMode(true);
		}
	});

	const handleSave = (value: string) => {
		const trimmed = value.trim();
		if (trimmed) {
			// Preserve any other webSearch fields; only replace the key.
			updateConfigNestedValue('nanocoderTools', 'webSearch', {
				...getAppConfig().nanocoderTools?.webSearch,
				apiKey: trimmed,
			});
			setHasApiKey(true);
			setSaved(true);
		} else {
			setEditMode(false);
			setInputValue('');
		}
	};

	const width = isNarrow ? '100%' : boxWidth;
	const title = isNarrow ? 'Web Search' : 'Settings · Web Search';

	return (
		<TitledBoxWithPreferences
			title={title}
			width={width}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			{saved ? (
				<Text color={colors.success}>✓ API key saved. Esc to exit.</Text>
			) : editMode ? (
				<Box flexDirection="column">
					<Text color={colors.secondary}>
						Enter your Brave Search API key. Leave empty to cancel.
					</Text>
					<Box marginY={1} borderStyle="round" borderColor={colors.secondary}>
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
					<Text color={colors.secondary}>
						Web search uses the Brave Search API.
					</Text>
					<Box marginTop={1}>
						<Text color={hasApiKey ? colors.success : colors.text}>
							{hasApiKey
								? '✓ API key is configured'
								: 'No API key configured — web search is unavailable'}
						</Text>
					</Box>
					<Box marginTop={1}>
						<Text color={colors.secondary}>
							Enter to {hasApiKey ? 'change' : 'add'} · Shift+Tab back · Esc
							exit
						</Text>
					</Box>
				</Box>
			)}
		</TitledBoxWithPreferences>
	);
}
