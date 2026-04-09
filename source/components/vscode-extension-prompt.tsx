import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import React, {useEffect, useState} from 'react';
import {defaultTheme, getThemeColors} from '@/config/themes';
import {TIMEOUT_VSCODE_EXTENSION_SKIP_MS} from '@/constants';
import {
	getExtensionStatus,
	installExtension,
	isVSCodeCliAvailable,
	type VSCodeStatus,
} from '@/vscode/extension-installer';

interface VSCodeExtensionPromptProps {
	onComplete: () => void;
	onSkip: () => void;
}

type PromptState =
	| 'checking'
	| 'prompt'
	| 'installing'
	| 'success'
	| 'error'
	| 'no-cli';

enum InstallOption {
	Yes = 'yes',
	No = 'no',
	Select = 'select',
}

/**
 * Ink component that prompts the user to install the VS Code extension
 * when running with --vscode flag and the extension isn't installed
 */
export function VSCodeExtensionPrompt({
	onComplete,
	onSkip,
}: VSCodeExtensionPromptProps) {
	const [state, setState] = useState<PromptState>('checking');
	const [statuses, setStatuses] = useState<VSCodeStatus[]>([]);
	const [message, setMessage] = useState('');
	const [selectedClis, setSelectedClis] = useState<string[]>([]);
	const [isSelecting, setIsSelecting] = useState(false);
	const colors = getThemeColors(defaultTheme);

	// Check status on mount
	useEffect(() => {
		async function check() {
			const available = await isVSCodeCliAvailable();
			if (!available) {
				setState('no-cli');
				return;
			}

			const currentStatuses = await getExtensionStatus();
			setStatuses(currentStatuses);

			const missing = currentStatuses.filter(s => !s.extensionInstalled);
			if (missing.length === 0) {
				onComplete();
			} else {
				setSelectedClis(missing.map(s => s.cli));
				setState('prompt');
			}
		}

		if (state === 'checking') {
			void check();
		}
	}, [state, onComplete]);

	const handleInstall = React.useCallback(
		async (clis?: string[]) => {
			setState('installing');
			const result = await installExtension(clis);

			setMessage(result.message);
			if (result.success) {
				setState('success');
			} else {
				setState('error');
				// Auto-continue after showing error
				setTimeout(onSkip, TIMEOUT_VSCODE_EXTENSION_SKIP_MS);
			}
		},
		[onSkip],
	);

	// Handle Enter key press in success state
	useInput(
		(_input, key) => {
			if (state === 'success' && key.return) {
				onComplete();
			}
		},
		{isActive: state === 'success'},
	);

	// Handle no-cli case - auto-skip after showing message
	useEffect(() => {
		if (state === 'no-cli') {
			const timer = setTimeout(onSkip, TIMEOUT_VSCODE_EXTENSION_SKIP_MS);
			return () => clearTimeout(timer);
		}
	}, [state, onSkip]);

	const availableMissing = statuses.filter(s => !s.extensionInstalled);

	const items = [
		{
			label:
				availableMissing.length > 1
					? `Yes, install to all (${availableMissing.map(s => s.cli).join(', ')})`
					: `Yes, install to ${availableMissing[0]?.cli}`,
			value: InstallOption.Yes,
		},
		...(availableMissing.length > 1
			? [
					{
						label: 'Choose editors...',
						value: InstallOption.Select,
					},
				]
			: []),
		{
			label: 'No, skip for now',
			value: InstallOption.No,
		},
	];

	const handleSelect = (item: {label: string; value: InstallOption}) => {
		if (item.value === InstallOption.Yes) {
			void handleInstall(availableMissing.map(s => s.cli));
		} else if (item.value === InstallOption.Select) {
			setIsSelecting(true);
		} else {
			onSkip();
		}
	};

	const handleCliToggle = (cli: string) => {
		setSelectedClis(prev =>
			prev.includes(cli) ? prev.filter(c => c !== cli) : [...prev, cli],
		);
	};

	if (state === 'checking') {
		return (
			<Box flexDirection="column" paddingY={1}>
				<Text color={colors.primary}>Checking VS Code extension...</Text>
			</Box>
		);
	}

	if (state === 'no-cli') {
		return (
			<Box flexDirection="column" paddingY={1}>
				<Text color={colors.warning}>
					No supported VS Code flavor (Code, Cursor, VSCodium, Windsurf, Trae)
					found in PATH.
				</Text>
				<Box marginTop={1}>
					<Text color={colors.text}>To enable VS Code integration:</Text>
				</Box>
				<Box marginLeft={2} flexDirection="column" marginTop={1}>
					<Text color={colors.secondary}>
						1. Open VS Code or your preferred editor
					</Text>
					<Text color={colors.secondary}>
						2. Press Cmd+Shift+P (Mac) or Ctrl+Shift+P (Windows/Linux)
					</Text>
					<Text color={colors.secondary}>
						3. Search for "Shell Command: Install 'code' command in PATH"
					</Text>
				</Box>
				<Box marginTop={1}>
					<Text color={colors.secondary}>
						Continuing without VS Code integration...
					</Text>
				</Box>
			</Box>
		);
	}

	if (state === 'prompt') {
		if (isSelecting) {
			const selectionItems = availableMissing.map(s => ({
				label: `${selectedClis.includes(s.cli) ? '[x]' : '[ ]'} ${s.cli}`,
				value: s.cli,
			}));

			return (
				<Box flexDirection="column" paddingY={1}>
					<Text color={colors.primary} bold>
						Select Editors
					</Text>
					<Box marginTop={1}>
						<SelectInput
							items={[
								...selectionItems,
								{label: '--- Confirm ---', value: 'confirm'},
								{label: '--- Back ---', value: 'back'},
							]}
							onSelect={item => {
								if (item.value === 'confirm') {
									if (selectedClis.length > 0) {
										void handleInstall(selectedClis);
									}
								} else if (item.value === 'back') {
									setIsSelecting(false);
								} else {
									handleCliToggle(item.value);
								}
							}}
						/>
					</Box>
					<Box marginTop={1}>
						<Text>Space/Enter to toggle, select Confirm to proceed</Text>
					</Box>
				</Box>
			);
		}

		return (
			<Box flexDirection="column" paddingY={1}>
				<Text color={colors.primary} bold>
					VS Code Extension
				</Text>
				<Box marginTop={1}>
					<Text color={colors.text}>
						The VS Code extension enables live diff previews when Nanocoder
						modifies files.
					</Text>
				</Box>

				{statuses.length > 0 && (
					<Box marginTop={1} flexDirection="column">
						<Text color={colors.secondary}>Detected editors:</Text>
						{statuses.map(s => (
							<Text key={s.cli} color={s.extensionInstalled ? 'gray' : 'white'}>
								{s.extensionInstalled ? '  ✓' : '  !'} {s.cli}{' '}
								{s.extensionInstalled ? '(Installed)' : '(Missing)'}
							</Text>
						))}
					</Box>
				)}

				<Box marginTop={1}>
					<Text color={colors.text}>Install the extension now?</Text>
				</Box>
				<Box marginTop={1}>
					<SelectInput items={items} onSelect={handleSelect} />
				</Box>
			</Box>
		);
	}

	if (state === 'installing') {
		return (
			<Box flexDirection="column" paddingY={1}>
				<Text color={colors.primary}>Installing VS Code extension...</Text>
			</Box>
		);
	}

	if (state === 'success') {
		return (
			<Box flexDirection="column" paddingY={1}>
				<Text color={colors.success}>✓ {message}</Text>
				<Box marginTop={1}>
					<Text color={colors.secondary}>Press Enter to continue...</Text>
				</Box>
			</Box>
		);
	}

	if (state === 'error') {
		return (
			<Box flexDirection="column" paddingY={1}>
				<Text color={colors.error}>✗ {message}</Text>
				<Text color={colors.secondary}>
					Continuing without VS Code integration...
				</Text>
			</Box>
		);
	}

	return null;
}

/**
 * Check if we should show the extension install prompt
 * Returns true if --vscode flag is present
 * The component itself will check if it's already installed
 */
export function shouldPromptExtensionInstall(): boolean {
	return process.argv.includes('--vscode');
}
