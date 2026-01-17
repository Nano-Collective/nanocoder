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
import {useEffect, useState} from 'react';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {colors} from '@/config/index';
import {getConfigPath} from '@/config/paths';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {logError, logInfo} from '@/utils/message-queue';
import type {ProviderConfig} from '../types/config';
import {type ConfigLocation, LocationStep} from './steps/location-step';
import {ProviderStep} from './steps/provider-step';
import {buildProviderConfigObject} from './validation';

interface ProviderWizardProps {
	projectDir: string;
	onComplete: (configPath: string) => void;
	onCancel?: () => void;
}

type WizardStep =
	| 'location'
	| 'providers'
	| 'summary'
	| 'confirm-delete'
	| 'editing'
	| 'saving'
	| 'complete';

export function ProviderWizard({
	projectDir,
	onComplete,
	onCancel,
}: ProviderWizardProps) {
	const [step, setStep] = useState<WizardStep>('location');
	const [providerConfigPath, setProviderConfigPath] = useState('');
	const [providers, setProviders] = useState<ProviderConfig[]>([]);
	const [error, setError] = useState<string | null>(null);
	const {boxWidth, isNarrow} = useResponsiveTerminal();

	// Capture focus to ensure keyboard handling works properly
	useFocus({autoFocus: true, id: 'config-wizard'});

	// Load existing config if editing
	useEffect(() => {
		if (!providerConfigPath) {
			return;
		}

		// Use a microtask to defer state updates
		void Promise.resolve().then(() => {
			try {
				let loadedProviders: ProviderConfig[] = [];

				// Try to load providers from agents.config.json
				if (existsSync(providerConfigPath)) {
					try {
						const providerContent = readFileSync(providerConfigPath, 'utf-8');
						const providerConfig = JSON.parse(providerContent) as {
							nanocoder?: {
								providers?: ProviderConfig[];
							};
						};
						loadedProviders = providerConfig.nanocoder?.providers || [];
					} catch (err) {
						logError('Failed to load provider configuration', true, {
							context: {providerConfigPath},
							error: err instanceof Error ? err.message : String(err),
						});
					}
				}

				setProviders(loadedProviders);
			} catch (err) {
				logError('Failed to load existing configuration', true, {
					context: {providerConfigPath},
					error: err instanceof Error ? err.message : String(err),
				});
			}
		});
	}, [providerConfigPath]);

	const handleLocationComplete = (location: ConfigLocation) => {
		// Determine the base directory based on location
		const baseDir = location === 'project' ? process.cwd() : getConfigPath();

		setProviderConfigPath(join(baseDir, 'agents.config.json'));
		setStep('providers');
	};

	const handleProvidersComplete = (newProviders: ProviderConfig[]) => {
		setProviders(newProviders);
		setStep('summary');
	};

	const handleSave = () => {
		setStep('saving');
		setError(null);

		try {
			// Build and save provider config
			if (providers.length > 0) {
				const providerConfig = buildProviderConfigObject(providers);
				const providerDir = dirname(providerConfigPath);
				if (!existsSync(providerDir)) {
					mkdirSync(providerDir, {recursive: true});
				}
				writeFileSync(
					providerConfigPath,
					JSON.stringify(providerConfig, null, 2),
					'utf-8',
				);
			}

			setStep('complete');
			// Don't auto-complete - wait for user to press Enter
		} catch (err) {
			setError(
				err instanceof Error ? err.message : 'Failed to save configuration',
			);
			setStep('summary');
		}
	};

	const handleAddProviders = () => {
		setStep('providers');
	};

	const handleCancel = () => {
		if (onCancel) {
			onCancel();
		}
	};

	const handleDeleteConfig = () => {
		setStep('confirm-delete');
	};

	const handleConfirmDelete = () => {
		try {
			if (existsSync(providerConfigPath)) {
				unlinkSync(providerConfigPath);
				logInfo(`Deleted configuration file: ${providerConfigPath}`);
			}
			// Call onComplete to trigger reload
			onComplete(providerConfigPath);
		} catch (err) {
			setError(
				err instanceof Error ? err.message : 'Failed to delete configuration',
			);
			setStep('providers');
		}
	};

	const openInEditor = () => {
		try {
			// Save current progress
			if (providers.length > 0) {
				const providerConfig = buildProviderConfigObject(providers);
				const providerDir = dirname(providerConfigPath);
				if (!existsSync(providerDir)) {
					mkdirSync(providerDir, {recursive: true});
				}
				writeFileSync(
					providerConfigPath,
					JSON.stringify(providerConfig, null, 2),
					'utf-8',
				);
			}

			// Detect editor (respect $EDITOR or $VISUAL environment variables)
			// Fall back to nano on Unix/Mac (much friendlier than vi!)
			// On Windows, use notepad
			const editor =
				process.env.EDITOR ||
				process.env.VISUAL ||
				(process.platform === 'win32' ? 'notepad' : 'nano');

			// Show cursor and restore terminal for editor
			process.stdout.write('\x1B[?25h'); // Show cursor
			process.stdin.setRawMode?.(false); // Disable raw mode

			// Open provider config in editor
			const result = spawnSync(editor, [providerConfigPath], {
				stdio: 'inherit', // Give editor full control of terminal
			});

			// Restore terminal state after editor closes
			process.stdin.setRawMode?.(true); // Re-enable raw mode
			process.stdout.write('\x1B[?25l'); // Hide cursor (Ink will manage it)

			if (result.status === 0) {
				// Reload config to get updated values
				let loadedProviders: ProviderConfig[] = [];

				// Reload provider config
				if (existsSync(providerConfigPath)) {
					try {
						const editedContent = readFileSync(providerConfigPath, 'utf-8');
						const editedConfig = JSON.parse(editedContent) as {
							nanocoder?: {
								providers?: ProviderConfig[];
							};
						};
						loadedProviders = editedConfig.nanocoder?.providers || [];
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

				setProviders(loadedProviders);

				// Return to summary to review changes
				setStep('summary');
				setError(null);
			} else {
				setError('Editor exited with an error. Changes may not be saved.');
				setStep('summary');
			}
		} catch (err) {
			// Restore terminal state on error
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

	// Handle global keyboard shortcuts
	useInput((input, key) => {
		// In complete step, wait for Enter to finish
		if (step === 'complete' && key.return) {
			onComplete(providerConfigPath);
			return;
		}

		// Escape - cancel/exit wizard completely
		if (key.escape) {
			if (onCancel) {
				onCancel();
			}
			return;
		}

		// Ctrl+E to open editor (available after location is chosen)
		if (
			key.ctrl &&
			input === 'e' &&
			providerConfigPath &&
			(step === 'providers' || step === 'summary')
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
					/>
				);
			}
			case 'providers': {
				return (
					<ProviderStep
						existingProviders={providers}
						onComplete={handleProvidersComplete}
						onBack={() => setStep('location')}
						onDelete={handleDeleteConfig}
						configExists={existsSync(providerConfigPath)}
					/>
				);
			}
			case 'summary': {
				return (
					<Box flexDirection="column">
						<Box marginBottom={1}>
							<Text bold color={colors.primary}>
								Configuration Summary
							</Text>
						</Box>

						{/* Config location */}
						<Box marginBottom={1} flexDirection="column">
							<Text color={colors.secondary}>Config file:</Text>
							<Text color={colors.success}>{providerConfigPath}</Text>
						</Box>

						{/* Providers */}
						{providers.length > 0 ? (
							<Box marginBottom={1} flexDirection="column">
								<Text color={colors.secondary}>
									Providers ({providers.length}):
								</Text>
								{providers.map((provider, index) => (
									<Text key={index} color={colors.success}>
										• {provider.name}
									</Text>
								))}
							</Box>
						) : (
							<Box marginBottom={1}>
								<Text color={colors.warning}>No providers configured</Text>
							</Box>
						)}

						{/* Actions */}
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
								<Text color={colors.warning}>{providerConfigPath}</Text>?
							</Text>
						</Box>
						<Box marginBottom={1}>
							<Text dimColor>This action cannot be undone.</Text>
						</Box>
						<SelectInput
							items={deleteOptions}
							onSelect={(item: {value: string}) => {
								if (item.value === 'yes') {
									handleConfirmDelete();
								} else {
									setStep('providers');
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
							<Text dimColor>Saved to:</Text>
						</Box>
						<Box marginBottom={1}>
							<Text dimColor> {providerConfigPath}</Text>
						</Box>
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
			title="Provider Wizard"
			reversePowerline={true}
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

			{(step === 'location' || step === 'providers' || step === 'summary') &&
				(isNarrow ? (
					<Box marginTop={1} flexDirection="column">
						<Text color={colors.secondary}>Esc: Exit wizard</Text>
						<Text color={colors.secondary}>Shift+Tab: Go back</Text>
						{providerConfigPath && (
							<Text color={colors.secondary}>Ctrl+E: Edit manually</Text>
						)}
					</Box>
				) : (
					<Box marginTop={1}>
						<Text color={colors.secondary}>
							Esc: Exit wizard | Shift+Tab: Go back
							{providerConfigPath && ' | Ctrl+E: Edit manually'}
						</Text>
					</Box>
				))}

			{/* Handle summary step actions */}
			{step === 'summary' && (
				<SummaryStepActions
					onSave={handleSave}
					onAddProviders={handleAddProviders}
					onCancel={handleCancel}
				/>
			)}
		</TitledBoxWithPreferences>
	);
}

interface SummaryStepActionsProps {
	onSave: () => void;
	onAddProviders: () => void;
	onCancel: () => void;
}

function SummaryStepActions({
	onSave,
	onAddProviders,
	onCancel,
}: SummaryStepActionsProps) {
	useInput((_input, key) => {
		if (key.shift && key.tab) {
			onAddProviders();
		} else if (key.return) {
			onSave();
		} else if (key.escape) {
			onCancel();
		}
	});

	return null;
}
