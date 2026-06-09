import {spawnSync} from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import {dirname, join} from 'node:path';
import {Box, Text, useFocus, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import Spinner from 'ink-spinner';
import React, {useEffect, useState} from 'react';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {getColors} from '@/config/index';
import {getConfigPath} from '@/config/paths';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {formatError} from '@/utils/error-formatter';
import {logError, logInfo} from '@/utils/message-queue';
import {type ConfigLocation, LocationStep} from './steps/location-step';

export type BaseWizardStep =
	| 'location'
	| 'configure'
	| 'summary'
	| 'confirm-delete'
	| 'editing'
	| 'saving'
	| 'complete';

export interface ConfigureStepArgs<T> {
	items: T;
	onComplete: (items: T) => void;
	onBack: () => void;
	onDelete: () => void;
	configExists: boolean;
}

export interface BaseConfigWizardProps<T> {
	/** Title rendered in the wizard's outer box. */
	title: string;
	/** Focus ID passed to ink's `useFocus`. Must be unique per wizard. */
	focusId: string;
	/** File name appended to the chosen base directory (project or global). */
	configFileName: string;
	/** Initial items value before any config is loaded from disk. */
	initialItems: T;
	/**
	 * Parse an on-disk config file into the wizard's items shape. Receives the
	 * raw file contents (as JSON-decoded `unknown`) so each wizard can pluck
	 * its slice from a larger config object.
	 */
	parseConfig: (raw: unknown) => T;
	/** Build the JSON object to write to disk from the current items. */
	buildConfig: (items: T) => unknown;
	/** Whether the items value carries any actual entries to save. */
	hasItems: (items: T) => boolean;
	/** Render the wizard-specific configure step. */
	renderConfigureStep: (args: ConfigureStepArgs<T>) => React.ReactNode;
	/** Render the items list shown in the summary step. */
	renderSummaryItems: (items: T) => React.ReactNode;
	/** Optional extra content to render in the complete step (after the header). */
	renderCompleteExtras?: (items: T) => React.ReactNode;
	projectDir: string;
	onComplete: (configPath: string) => void;
	onCancel?: () => void;
}

function detectEditor(): string {
	return (
		process.env.EDITOR ||
		process.env.VISUAL ||
		(process.platform === 'win32' ? 'notepad' : 'nano')
	);
}

export function BaseConfigWizard<T>({
	title,
	focusId,
	configFileName,
	initialItems,
	parseConfig,
	buildConfig,
	hasItems,
	renderConfigureStep,
	renderSummaryItems,
	renderCompleteExtras,
	projectDir,
	onComplete,
	onCancel,
}: BaseConfigWizardProps<T>) {
	const colors = getColors();
	const [step, setStep] = useState<BaseWizardStep>('location');
	const [configPath, setConfigPath] = useState('');
	const [items, setItems] = useState<T>(initialItems);
	const [error, setError] = useState<string | null>(null);
	const {boxWidth, isNarrow} = useResponsiveTerminal();

	useFocus({autoFocus: true, id: focusId});

	useEffect(() => {
		if (!configPath) return;

		void Promise.resolve().then(() => {
			try {
				if (existsSync(configPath)) {
					try {
						const content = readFileSync(configPath, 'utf-8');
						const raw = JSON.parse(content) as unknown;
						setItems(parseConfig(raw));
					} catch (err) {
						logError('Failed to load configuration', true, {
							context: {configPath},
							error: formatError(err),
						});
					}
				}
			} catch (err) {
				logError('Failed to load existing configuration', true, {
					context: {configPath},
					error: formatError(err),
				});
			}
		});
	}, [configPath, parseConfig]);

	const writeConfigToDisk = (data: T): void => {
		if (!hasItems(data)) return;
		const config = buildConfig(data);
		const configDir = dirname(configPath);
		if (!existsSync(configDir)) {
			mkdirSync(configDir, {recursive: true});
		}
		writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
	};

	const handleLocationComplete = (location: ConfigLocation) => {
		const baseDir = location === 'project' ? process.cwd() : getConfigPath();
		setConfigPath(join(baseDir, configFileName));
		setStep('configure');
	};

	const handleConfigureComplete = (newItems: T) => {
		setItems(newItems);
		setStep('summary');
	};

	const handleSave = () => {
		setStep('saving');
		setError(null);
		try {
			writeConfigToDisk(items);
			setStep('complete');
		} catch (err) {
			setError(
				err instanceof Error ? err.message : 'Failed to save configuration',
			);
			setStep('summary');
		}
	};

	const handleDeleteConfig = () => setStep('confirm-delete');

	const handleConfirmDelete = () => {
		try {
			if (existsSync(configPath)) {
				unlinkSync(configPath);
				logInfo(`Deleted configuration file: ${configPath}`);
			}
			onComplete(configPath);
		} catch (err) {
			setError(
				err instanceof Error ? err.message : 'Failed to delete configuration',
			);
			setStep('configure');
		}
	};

	const openInEditor = () => {
		try {
			writeConfigToDisk(items);

			const editor = detectEditor();

			process.stdout.write('\x1B[?25h');
			process.stdin.setRawMode?.(false);

			const result = spawnSync(editor, [configPath], {stdio: 'inherit'});

			process.stdin.setRawMode?.(true);
			process.stdout.write('\x1B[?25l');

			if (result.status === 0) {
				if (existsSync(configPath)) {
					try {
						const editedContent = readFileSync(configPath, 'utf-8');
						const editedRaw = JSON.parse(editedContent) as unknown;
						setItems(parseConfig(editedRaw));
					} catch (parseErr) {
						setError(
							parseErr instanceof Error
								? `Invalid JSON: ${parseErr.message}`
								: 'Failed to parse edited configuration',
						);
						setStep('summary');
						return;
					}
				}
				setStep('summary');
				setError(null);
			} else {
				setError('Editor exited with an error. Changes may not be saved.');
				setStep('summary');
			}
		} catch (err) {
			process.stdin.setRawMode?.(true);
			process.stdout.write('\x1B[?25l');
			setError(
				err instanceof Error
					? `Failed to open editor: ${err.message}`
					: 'Failed to open editor',
			);
			setStep('summary');
		}
	};

	useInput((input, key) => {
		if (step === 'complete' && key.return) {
			onComplete(configPath);
			return;
		}

		if (key.escape) {
			onCancel?.();
			return;
		}

		if (
			key.ctrl &&
			input === 'e' &&
			configPath &&
			(step === 'configure' || step === 'summary')
		) {
			openInEditor();
		}
	});

	const renderStep = () => {
		switch (step) {
			case 'location': {
				return (
					<LocationStep
						projectDir={projectDir}
						onComplete={handleLocationComplete}
						onBack={onCancel}
						configFileName={configFileName}
					/>
				);
			}
			case 'configure': {
				return renderConfigureStep({
					items,
					onComplete: handleConfigureComplete,
					onBack: () => setStep('location'),
					onDelete: handleDeleteConfig,
					configExists: existsSync(configPath),
				});
			}
			case 'summary': {
				return (
					<Box flexDirection="column">
						<Box marginBottom={1}>
							<Text bold color={colors.primary}>
								Configuration Summary
							</Text>
						</Box>
						<Box marginBottom={1} flexDirection="column">
							<Text color={colors.secondary}>Config file:</Text>
							<Text color={colors.success}>{configPath}</Text>
						</Box>
						{renderSummaryItems(items)}
						<Box marginTop={1} flexDirection="column">
							<Text color={colors.secondary}>• Enter: Save configuration</Text>
							<Text color={colors.secondary}>• Shift+Tab: Go back</Text>
							<Text color={colors.secondary}>• Esc: Cancel</Text>
						</Box>
					</Box>
				);
			}
			case 'confirm-delete': {
				const deleteOptions = [
					{label: 'Yes, delete the file', value: 'yes'},
					{label: 'No, go back', value: 'no'},
				];
				return (
					<Box flexDirection="column">
						<Box marginBottom={1}>
							<Text bold color={colors.error}>
								Delete Configuration?
							</Text>
						</Box>
						<Box marginBottom={1}>
							<Text>
								Are you sure you want to delete{' '}
								<Text color={colors.warning}>{configPath}</Text>?
							</Text>
						</Box>
						<Box marginBottom={1}>
							<Text>This action cannot be undone.</Text>
						</Box>
						<SelectInput
							items={deleteOptions}
							onSelect={(item: {value: string}) => {
								if (item.value === 'yes') {
									handleConfirmDelete();
								} else {
									setStep('configure');
								}
							}}
						/>
					</Box>
				);
			}
			case 'saving': {
				return (
					<Box flexDirection="column">
						<Box>
							<Text color={colors.success}>
								<Spinner type="dots" /> Saving configuration...
							</Text>
						</Box>
					</Box>
				);
			}
			case 'complete': {
				return (
					<Box flexDirection="column">
						<Box marginBottom={1}>
							<Text color={colors.success} bold>
								✓ Configuration saved!
							</Text>
						</Box>
						<Box marginBottom={1}>
							<Text>Saved to: {configPath}</Text>
						</Box>
						{renderCompleteExtras?.(items)}
						<Box>
							<Text color={colors.secondary}>Press Enter to continue</Text>
						</Box>
					</Box>
				);
			}
			default: {
				return null;
			}
		}
	};

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
			{error && (
				<Box marginBottom={1}>
					<Text color={colors.error}>Error: {error}</Text>
				</Box>
			)}

			{renderStep()}

			{(step === 'location' || step === 'configure' || step === 'summary') &&
				(isNarrow ? (
					<Box marginTop={1} flexDirection="column">
						<Text color={colors.secondary}>Esc: Exit wizard</Text>
						<Text color={colors.secondary}>Shift+Tab: Go back</Text>
						{configPath && (
							<Text color={colors.secondary}>Ctrl+E: Edit manually</Text>
						)}
					</Box>
				) : (
					<Box marginTop={1}>
						<Text color={colors.secondary}>
							Esc: Exit wizard | Shift+Tab: Go back
							{configPath && ' | Ctrl+E: Edit manually'}
						</Text>
					</Box>
				))}

			{step === 'summary' && (
				<SummaryStepActions
					onSave={handleSave}
					onAddItems={() => setStep('configure')}
					onCancel={() => onCancel?.()}
				/>
			)}
		</TitledBoxWithPreferences>
	);
}

interface SummaryStepActionsProps {
	onSave: () => void;
	onAddItems: () => void;
	onCancel: () => void;
}

function SummaryStepActions({
	onSave,
	onAddItems,
	onCancel,
}: SummaryStepActionsProps) {
	useInput((_input, key) => {
		if (key.shift && key.tab) {
			onAddItems();
		} else if (key.return) {
			onSave();
		} else if (key.escape) {
			onCancel();
		}
	});

	return null;
}
