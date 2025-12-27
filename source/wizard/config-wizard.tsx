import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {TitledBox} from '@/components/ui/titled-box';
import {colors} from '@/config/index';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {getLogger} from '@/utils/logging';
import {logError} from '@/utils/message-queue';
import {Box, Text, useFocus, useInput} from 'ink';
import Spinner from 'ink-spinner';
import {useEffect, useRef, useState} from 'react';
import type {ProviderConfig} from '../types/config';
import {type ConfigLocation, LocationStep} from './steps/location-step';
import {McpStep} from './steps/mcp-step';
import {ProviderStep} from './steps/provider-step';
import {SummaryStep} from './steps/summary-step';
import type {McpServerConfig} from './templates/mcp-templates';
import {buildConfigObject} from './validation';

interface ConfigWizardProps {
	projectDir: string;
	onComplete: (configPath: string) => void;
	onCancel?: () => void;
}

type WizardStep =
	| 'location'
	| 'providers'
	| 'mcp'
	| 'summary'
	| 'editing'
	| 'saving'
	| 'complete';

export function ConfigWizard({
	projectDir,
	onComplete,
	onCancel,
}: ConfigWizardProps) {
	const logger = getLogger();
	const renderCountRef = useRef(0);
	renderCountRef.current += 1;

	logger.debug('ConfigWizard render', {
		renderCount: renderCountRef.current,
		projectDir,
	});

	const [step, setStep] = useState<WizardStep>('location');
	const [configPath, setConfigPath] = useState('');
	const [providers, setProviders] = useState<ProviderConfig[]>([]);
	const [mcpServers, setMcpServers] = useState<Record<string, McpServerConfig>>(
		{},
	);
	const [error, setError] = useState<string | null>(null);
	const {boxWidth, isNarrow} = useResponsiveTerminal();

	// Log step changes
	useEffect(() => {
		logger.debug('ConfigWizard step changed', {step});
	}, [step, logger]);

	// Capture focus to ensure keyboard handling works properly
	useFocus({autoFocus: true, id: 'config-wizard'});

	// Load existing config if editing
	useEffect(() => {
		if (!configPath || !existsSync(configPath)) {
			return;
		}

		// Use a microtask to defer state updates
		void Promise.resolve().then(() => {
			try {
				const configContent = readFileSync(configPath, 'utf-8');
				const config = JSON.parse(configContent) as {
					nanocoder?: {
						providers?: ProviderConfig[];
						mcpServers?: Record<string, McpServerConfig>;
					};
				};

				const newProviders = config.nanocoder?.providers || [];
				const newMcpServers = config.nanocoder?.mcpServers || {};

				setProviders(newProviders);
				setMcpServers(newMcpServers);
			} catch (err) {
				logError('Failed to load existing configuration', true, {
					context: {configPath},
					error: err instanceof Error ? err.message : String(err),
				});
			}
		});
	}, [configPath]);

	const handleLocationComplete = (_location: ConfigLocation, path: string) => {
		setConfigPath(path);
		setStep('providers');
	};

	const handleProvidersComplete = (newProviders: ProviderConfig[]) => {
		setProviders(newProviders);
		setStep('mcp');
	};

	const handleMcpComplete = (
		newMcpServers: Record<string, McpServerConfig>,
	) => {
		setMcpServers(newMcpServers);
		setStep('summary');
	};

	const handleSave = () => {
		setStep('saving');
		setError(null);

		try {
			// Build config object
			const config = buildConfigObject(providers, mcpServers);

			// Ensure directory exists
			const dir = dirname(configPath);
			if (!existsSync(dir)) {
				mkdirSync(dir, {recursive: true});
			}

			// Write config file
			writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

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

	const handleAddMcpServers = () => {
		setStep('mcp');
	};

	const handleCancel = () => {
		if (onCancel) {
			onCancel();
		}
	};

	const openInEditor = () => {
		try {
			// Save current progress to file
			const config = buildConfigObject(providers, mcpServers);

			// Ensure directory exists
			const dir = dirname(configPath);
			if (!existsSync(dir)) {
				mkdirSync(dir, {recursive: true});
			}

			// Write config file
			writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

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

			// Open editor and wait for it to close
			const result = spawnSync(editor, [configPath], {
				stdio: 'inherit', // Give editor full control of terminal
			});

			// Restore terminal state after editor closes
			process.stdin.setRawMode?.(true); // Re-enable raw mode
			process.stdout.write('\x1B[?25l'); // Hide cursor (Ink will manage it)

			if (result.status === 0) {
				// Reload the edited config
				try {
					const editedContent = readFileSync(configPath, 'utf-8');
					const editedConfig = JSON.parse(editedContent) as {
						nanocoder?: {
							providers?: ProviderConfig[];
							mcpServers?: Record<string, McpServerConfig>;
						};
					};

					// Update state with edited values
					if (editedConfig.nanocoder) {
						setProviders(editedConfig.nanocoder.providers || []);
						setMcpServers(editedConfig.nanocoder.mcpServers || {});
					}

					// Return to summary to review changes
					setStep('summary');
					setError(null);
				} catch (parseErr) {
					setError(
						parseErr instanceof Error
							? `Invalid JSON: ${parseErr.message}`
							: 'Failed to parse edited configuration',
					);
					setStep('summary');
				}
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
			onComplete(configPath);
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
			configPath &&
			(step === 'providers' || step === 'mcp' || step === 'summary')
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
					/>
				);
			}
			case 'mcp': {
				return (
					<McpStep
						existingServers={mcpServers}
						onComplete={handleMcpComplete}
						onBack={() => setStep('providers')}
					/>
				);
			}
			case 'summary': {
				return (
					<SummaryStep
						configPath={configPath}
						providers={providers}
						mcpServers={mcpServers}
						onSave={handleSave}
						onAddProviders={handleAddProviders}
						onAddMcpServers={handleAddMcpServers}
						onCancel={handleCancel}
						onBack={() => setStep('mcp')}
					/>
				);
			}
			case 'editing': {
				return (
					<Box flexDirection="column">
						<Box marginBottom={1}>
							<Text color={colors.primary}>Opening editor...</Text>
						</Box>
						<Box marginBottom={1}>
							<Text dimColor>Configuration saved to: {configPath}</Text>
						</Box>
						<Box>
							<Text color={colors.secondary}>
								Save and close your editor to return to the wizard.
							</Text>
						</Box>
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
							<Text dimColor>Saved to: {configPath}</Text>
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
		<TitledBox
			title="Configuration Wizard"
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

			{(step === 'location' ||
				step === 'providers' ||
				step === 'mcp' ||
				step === 'summary') &&
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
		</TitledBox>
	);
}
