import React from 'react';
import {ModelDatabaseDisplay} from '@/commands/model-database';
import CheckpointSelector from '@/components/checkpoint-selector';
import ModelSelector from '@/components/model-selector';
import ProviderSelector from '@/components/provider-selector';
import type {CheckpointListItem, LLMClient} from '@/types';
import {McpWizard} from '@/wizards/mcp-wizard';
import {ProviderWizard} from '@/wizards/provider-wizard';
import {SettingsSelector} from './settings-selector';

export interface ModalSelectorsProps {
	// State flags
	isModelSelectionMode: boolean;
	isProviderSelectionMode: boolean;
	isModelDatabaseMode: boolean;
	isConfigWizardMode: boolean;
	isMcpWizardMode: boolean;
	isCheckpointLoadMode: boolean;
	isSettingsMode: boolean;

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

	// Handlers - Settings
	onSettingsCancel: () => void;
}

/**
 * Renders the appropriate modal selector based on current application mode
 * Returns null if no modal is active
 */
export function ModalSelectors({
	isModelSelectionMode,
	isProviderSelectionMode,
	isModelDatabaseMode,
	isConfigWizardMode,
	isMcpWizardMode,
	isCheckpointLoadMode,
	isSettingsMode,
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
	onSettingsCancel,
}: ModalSelectorsProps): React.ReactElement | null {
	if (isModelSelectionMode) {
		return (
			<ModelSelector
				client={client}
				currentModel={currentModel}
				onModelSelect={model => void onModelSelect(model)}
				onCancel={onModelSelectionCancel}
			/>
		);
	}

	if (isProviderSelectionMode) {
		return (
			<ProviderSelector
				currentProvider={currentProvider}
				onProviderSelect={provider => void onProviderSelect(provider)}
				onCancel={onProviderSelectionCancel}
			/>
		);
	}

	if (isSettingsMode) {
		return <SettingsSelector onCancel={onSettingsCancel} />;
	}

	if (isModelDatabaseMode) {
		return <ModelDatabaseDisplay onCancel={onModelDatabaseCancel} />;
	}

	if (isConfigWizardMode) {
		return (
			<ProviderWizard
				projectDir={process.cwd()}
				onComplete={configPath => void onConfigWizardComplete(configPath)}
				onCancel={onConfigWizardCancel}
			/>
		);
	}

	if (isMcpWizardMode) {
		return (
			<McpWizard
				projectDir={process.cwd()}
				onComplete={configPath => void onMcpWizardComplete(configPath)}
				onCancel={onMcpWizardCancel}
			/>
		);
	}

	if (isCheckpointLoadMode && checkpointLoadData) {
		return (
			<CheckpointSelector
				checkpoints={checkpointLoadData.checkpoints}
				currentMessageCount={checkpointLoadData.currentMessageCount}
				onSelect={(name, backup) => void onCheckpointSelect(name, backup)}
				onCancel={onCheckpointCancel}
			/>
		);
	}

	return null;
}
