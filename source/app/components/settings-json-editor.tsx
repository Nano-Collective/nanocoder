import {readFileSync, writeFileSync} from 'fs';
import {Text} from 'ink';
import {useEffect, useState} from 'react';
import {JsonViewer} from '@/components/json-viewer';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {getClosestConfigFile} from '@/config/index';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import type {ChangeDiff} from './settings-keep-discard-prompt';
import {KeepDiscardPrompt} from './settings-keep-discard-prompt';

/**
 * Settings panel that opens a JSON config file in the <JsonViewer>.
 * Used by: Edit Config Files, Tune Model, Configure Providers, Configure MCP Servers.
 */
export function SettingsJsonEditorPanel({
	configFileName,
	title,
	initialPath,
	onBack,
	onCancel,
	onChanged,
	readOnly = false,
}: {
	/** Name of the config file (e.g. 'nanocoder-config.json') */
	configFileName: string;
	/** Display title for the viewer */
	title: string;
	/** Optional JSONPath segments to pre-navigate to (e.g. ['nanocoder', 'tune']) */
	initialPath?: string[];
	onBack: () => void;
	onCancel: () => void;
	onChanged?: (diff: ChangeDiff) => void;
	/** Read-only mode */
	readOnly?: boolean;
}) {
	const {colors} = useTheme();
	const {boxWidth, isNarrow} = useResponsiveTerminal();

	const [fileData, setFileData] = useState<unknown>(null);
	const [filePath, setFilePath] = useState<string>('');
	/** Snapshot of the data when the file was last saved */
	const [savedData, setSavedData] = useState<unknown>(null);
	const [showKeepDiscard, setShowKeepDiscard] = useState(false);
	const [pendingData, setPendingData] = useState<unknown>(null);

	// Load file on mount
	useEffect(() => {
		try {
			const path = getClosestConfigFile(configFileName);
			setFilePath(path);
			const data = JSON.parse(readFileSync(path, 'utf-8'));
			setFileData(data);
			setSavedData(JSON.parse(JSON.stringify(data)));
		} catch {
			// File doesn't exist yet — start with empty object
			const emptyData = configFileName.includes('mcp') ? {mcpServers: {}} : {};
			setFileData(emptyData);
			setSavedData(JSON.parse(JSON.stringify(emptyData)));
			setFilePath(getClosestConfigFile(configFileName));
		}
	}, [configFileName.includes, configFileName]); // eslint-disable-line react-hooks/exhaustive-deps

	/** Called by <JsonViewer> whenever the tree changes */
	const handleTreeChange = (currentData: unknown) => {
		setFileData(currentData);
	};

	const handleSave = (data: unknown) => {
		try {
			writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
			setSavedData(JSON.parse(JSON.stringify(data)));
			setFileData(data);
			onChanged?.({
				setting: title,
				oldValue: '(previous)',
				newValue: '(updated)',
				persist: () => {}, // Already persisted
			});
		} catch (_error) {
			// Save failed — keep data in memory
		}
	};

	/** Called by <JsonViewer> when the user presses q/Esc/Shift+Tab */
	const handleExit = (currentData: unknown) => {
		const isDirty =
			savedData !== null &&
			JSON.stringify(currentData) !== JSON.stringify(savedData);

		if (isDirty && !readOnly) {
			setPendingData(currentData);
			setShowKeepDiscard(true);
		} else {
			onBack();
		}
	};

	const handleKeep = () => {
		if (pendingData !== null) {
			writeFileSync(filePath, JSON.stringify(pendingData, null, 2), 'utf-8');
			setSavedData(JSON.parse(JSON.stringify(pendingData)));
			onChanged?.({
				setting: title,
				oldValue: '(previous)',
				newValue: '(updated)',
				persist: () => {}, // Already persisted
			});
		}
		setShowKeepDiscard(false);
		setPendingData(null);
		onBack();
	};

	const handleDiscard = () => {
		setShowKeepDiscard(false);
		setPendingData(null);
		onBack();
	};

	if (showKeepDiscard) {
		return (
			<KeepDiscardPrompt
				onKeep={handleKeep}
				onDiscard={handleDiscard}
				changes={[
					{
						setting: title,
						oldValue: '(previous)',
						newValue: '(modified)',
					},
				]}
			/>
		);
	}

	if (fileData === null) {
		return (
			<TitledBoxWithPreferences
				title={title}
				width={isNarrow ? '100%' : boxWidth}
				borderColor={colors.primary}
				paddingX={2}
				paddingY={1}
				flexDirection="column"
				marginBottom={1}
			>
				<Text color={colors.secondary}>Loading...</Text>
			</TitledBoxWithPreferences>
		);
	}

	return (
		<JsonViewer
			data={fileData}
			title={title}
			filePath={filePath}
			onSave={handleSave}
			onChange={handleTreeChange}
			onCancel={handleExit}
			initialPath={initialPath}
			readOnly={readOnly}
		/>
	);
}
