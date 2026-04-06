import React from 'react';
import {ModelDatabaseDisplay} from '@/commands/model-database';
import CheckpointSelector from '@/components/checkpoint-selector';
import ModelSelector from '@/components/model-selector';
import ProviderSelector from '@/components/provider-selector';
import SessionSelector from '@/components/session-selector';
import type {ActiveMode} from '@/hooks/useAppState';
import type {CheckpointListItem, LLMClient, TuneConfig} from '@/types';
import {McpWizard} from '@/wizards/mcp-wizard';
import {ProviderWizard} from '@/wizards/provider-wizard';
import {SettingsSelector} from './settings-selector';
import {TuneSelector} from './tune-selector';

export interface ModalSelectorsProps {
	activeMode: ActiveMode;
	isSettingsMode: boolean;
	showAllSessions: boolean;

	// Current values
	client: LLMClient | null;
	currentModel: string;
	currentProvider: string;
	checkpointLoadData: {
		checkpoints: CheckpointListItem[];
		currentMessageCount: number;
	} | null;

	// Handlers - Model Selection
	onModelSelect: (model: string) => Promise<void>;
	onModelSelectionCancel: () => void;

	// Handlers - Provider Selection
	onProviderSelect: (provider: string) => Promise<void>;
	onProviderSelectionCancel: () => void;

	// Handlers - Model Database
	onModelDatabaseCancel: () => void;

	// Handlers - Config Wizard
	onConfigWizardComplete: (configPath: string) => Promise<void>;
	onConfigWizardCancel: () => void;

	// Handlers - MCP Wizard
	onMcpWizardComplete: (configPath: string) => Promise<void>;
	onMcpWizardCancel: () => void;

	// Handlers - Checkpoint
	onCheckpointSelect: (name: string, backup: boolean) => Promise<void>;
	onCheckpointCancel: () => void;

	// Handlers - Session resume
	onSessionSelect: (sessionId: string) => void;
	onSessionCancel: () => void;

	// Handlers - Settings
	onSettingsCancel: () => void;

	// Handlers - Model Mode
	tuneConfig: TuneConfig;
	onTuneSelect: (config: TuneConfig) => Promise<void>;
	onTuneCancel: () => void;
}

/**
 * Renders the appropriate modal selector based on current application mode
 * Returns null if no modal is active
 */
export function ModalSelectors({
	activeMode,
	isSettingsMode,
	showAllSessions,
	client,
	currentModel,
	currentProvider,
	checkpointLoadData,
	onModelSelect,
	onModelSelectionCancel,
	onProviderSelect,
	onProviderSelectionCancel,
	onModelDatabaseCancel,
	onConfigWizardComplete,
	onConfigWizardCancel,
	onMcpWizardComplete,
	onMcpWizardCancel,
	onCheckpointSelect,
	onCheckpointCancel,
	onSessionSelect,
	onSessionCancel,
	onSettingsCancel,
	tuneConfig,
	onTuneSelect,
	onTuneCancel,
}: ModalSelectorsProps): React.ReactElement | null {
	if (activeMode === 'model') {
		return (
			<ModelSelector
				client={client}
				currentModel={currentModel}
				onModelSelect={model => void onModelSelect(model)}
				onCancel={onModelSelectionCancel}
			/>
		);
	}

	if (activeMode === 'provider') {
		return (
			<ProviderSelector
				currentProvider={currentProvider}
				onProviderSelect={provider => void onProviderSelect(provider)}
				onCancel={onProviderSelectionCancel}
			/>
		);
	}

	if (activeMode === 'tune') {
		return (
			<TuneSelector
				currentConfig={tuneConfig}
				onSelect={config => void onTuneSelect(config)}
				onCancel={onTuneCancel}
			/>
		);
	}

	if (isSettingsMode) {
		return <SettingsSelector onCancel={onSettingsCancel} />;
	}

	if (activeMode === 'modelDatabase') {
		return <ModelDatabaseDisplay onCancel={onModelDatabaseCancel} />;
	}

	if (activeMode === 'configWizard') {
		return (
			<ProviderWizard
				projectDir={process.cwd()}
				onComplete={configPath => void onConfigWizardComplete(configPath)}
				onCancel={onConfigWizardCancel}
			/>
		);
	}

	if (activeMode === 'mcpWizard') {
		return (
			<McpWizard
				projectDir={process.cwd()}
				onComplete={configPath => void onMcpWizardComplete(configPath)}
				onCancel={onMcpWizardCancel}
			/>
		);
	}

	if (activeMode === 'checkpointLoad' && checkpointLoadData) {
		return (
			<CheckpointSelector
				checkpoints={checkpointLoadData.checkpoints}
				currentMessageCount={checkpointLoadData.currentMessageCount}
				onSelect={(name, backup) => void onCheckpointSelect(name, backup)}
				onCancel={onCheckpointCancel}
			/>
		);
	}

	if (activeMode === 'sessionSelector') {
		return (
			<SessionSelector
				onSelect={meta =>
					meta ? void onSessionSelect(meta.id) : onSessionCancel()
				}
				onCancel={onSessionCancel}
				showAll={showAllSessions}
			/>
		);
	}

	return null;
}
