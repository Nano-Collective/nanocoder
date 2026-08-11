import React from 'react';
import {ModelDatabaseDisplay} from '@/commands/model-database';
import CheckpointSelector from '@/components/checkpoint-selector';
import ModelSelector from '@/components/model-selector';
import SessionSelector from '@/components/session-selector';
import type {ActiveMode} from '@/hooks/useAppState';
import type {CheckpointListItem, TuneConfig} from '@/types';
import {ProviderWizard} from '@/wizards/provider-wizard';
import {SettingsSelector, type SettingsTabId} from './settings-tabs';
import {TuneSelector} from './tune-selector';

export interface ModalSelectorsProps {
	onLaunchTune?: () => void;
	onLaunchIde?: () => void;
	onMcpChanged?: () => void | Promise<void>;
	onProvidersChanged?: (configPath: string) => void | Promise<void>;
	activeMode: ActiveMode;
	isSettingsMode: boolean;
	settingsTab?: SettingsTabId;
	showAllSessions: boolean;

	// Current values
	currentModel: string;
	currentProvider: string;
	checkpointLoadData: {
		checkpoints: CheckpointListItem[];
		currentMessageCount: number;
	} | null;

	// Handlers - Model Selection
	onModelSelect: (provider: string, model: string) => Promise<unknown>;
	onModelSelectionCancel: () => void;

	// Handlers - Model Database
	onModelDatabaseCancel: () => void;

	// Handlers - Config Wizard
	onConfigWizardComplete: (configPath: string) => Promise<void>;
	onConfigWizardCancel: () => void;

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
	currentModel,
	currentProvider,
	checkpointLoadData,
	onModelSelect,
	onModelSelectionCancel,
	onModelDatabaseCancel,
	onConfigWizardComplete,
	onConfigWizardCancel,
	onCheckpointSelect,
	onCheckpointCancel,
	onSessionSelect,
	onSessionCancel,
	onSettingsCancel,
	onLaunchTune,
	onLaunchIde,
	onMcpChanged,
	onProvidersChanged,
	settingsTab,
	tuneConfig,
	onTuneSelect,
	onTuneCancel,
}: ModalSelectorsProps): React.ReactElement | null {
	if (activeMode === 'model') {
		return (
			<ModelSelector
				currentProvider={currentProvider}
				currentModel={currentModel}
				onModelSelect={(provider, model) => void onModelSelect(provider, model)}
				onCancel={onModelSelectionCancel}
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
		return (
			<SettingsSelector
				onCancel={onSettingsCancel}
				onLaunchTune={onLaunchTune}
				onLaunchIde={onLaunchIde}
				onMcpChanged={onMcpChanged}
				onProvidersChanged={onProvidersChanged}
				initialTab={settingsTab}
			/>
		);
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
