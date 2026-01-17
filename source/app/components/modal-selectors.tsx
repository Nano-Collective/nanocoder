import React from 'react';
import {ModelDatabaseDisplay} from '@/commands/model-database';
import CheckpointSelector from '@/components/checkpoint-selector';
import ModelSelector from '@/components/model-selector';
import NanocoderShapeSelector from '@/components/nanocoder-shape-selector';
import ProviderSelector from '@/components/provider-selector';
import ThemeSelector from '@/components/theme-selector';
import TitleShapeSelector from '@/components/title-shape-selector';
import type {CheckpointListItem, LLMClient} from '@/types';
import {McpWizard} from '@/wizards/mcp-wizard';
import {ProviderWizard} from '@/wizards/provider-wizard';

export interface ModalSelectorsProps {
	// State flags
	isModelSelectionMode: boolean;
	isProviderSelectionMode: boolean;
	isThemeSelectionMode: boolean;
	isModelDatabaseMode: boolean;
	isConfigWizardMode: boolean;
	isMcpWizardMode: boolean;
	isCheckpointLoadMode: boolean;
	isTitleShapeSelectionMode: boolean;
	isNanocoderShapeSelectionMode: boolean;

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

	// Handlers - Theme Selection
	onThemeSelect: (theme: import('@/types/ui').ThemePreset) => void;
	onThemeSelectionCancel: () => void;

	// Handlers - Title Shape Selection
	onTitleShapeSelect: (shape: import('@/types/ui').TitleShape) => void;
	onTitleShapeSelectionCancel: () => void;

	// Handlers - Nanocoder Shape Selection
	onNanocoderShapeSelect: (shape: import('@/types/ui').NanocoderShape) => void;
	onNanocoderShapeSelectionCancel: () => void;

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
}

/**
 * Renders the appropriate modal selector based on current application mode
 * Returns null if no modal is active
 */
export function ModalSelectors({
	isModelSelectionMode,
	isProviderSelectionMode,
	isThemeSelectionMode,
	isModelDatabaseMode,
	isConfigWizardMode,
	isMcpWizardMode,
	isCheckpointLoadMode,
	isTitleShapeSelectionMode,
	isNanocoderShapeSelectionMode,
	client,
	currentModel,
	currentProvider,
	checkpointLoadData,
	onModelSelect,
	onModelSelectionCancel,
	onProviderSelect,
	onProviderSelectionCancel,
	onThemeSelect,
	onThemeSelectionCancel,
	onModelDatabaseCancel,
	onConfigWizardComplete,
	onConfigWizardCancel,
	onMcpWizardComplete,
	onMcpWizardCancel,
	onCheckpointSelect,
	onCheckpointCancel,
	onTitleShapeSelect,
	onTitleShapeSelectionCancel,
	onNanocoderShapeSelect,
	onNanocoderShapeSelectionCancel,
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

	if (isThemeSelectionMode) {
		return (
			<ThemeSelector
				onThemeSelect={onThemeSelect}
				onCancel={onThemeSelectionCancel}
			/>
		);
	}

	if (isTitleShapeSelectionMode) {
		return (
			<TitleShapeSelector
				onComplete={onTitleShapeSelect}
				onCancel={onTitleShapeSelectionCancel}
			/>
		);
	}

	if (isNanocoderShapeSelectionMode) {
		return (
			<NanocoderShapeSelector
				onComplete={onNanocoderShapeSelect}
				onCancel={onNanocoderShapeSelectionCancel}
			/>
		);
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
