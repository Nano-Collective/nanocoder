import React from 'react';
import {CustomCommandExecutor} from '@/custom-commands/executor';
import {CustomCommandLoader} from '@/custom-commands/loader';
import type {CheckpointListItem} from './checkpoint';
import type {CustomCommand} from './commands';
import type {Message} from './core';
import type {UpdateInfo} from './utils';

export interface MessageSubmissionOptions {
	customCommandCache: Map<string, CustomCommand>;
	customCommandLoader: CustomCommandLoader | null;
	customCommandExecutor: CustomCommandExecutor | null;
	onClearMessages: () => Promise<void>;
	onEnterModelSelectionMode: () => void;
	onEnterProviderSelectionMode: () => void;
	onEnterModelDatabaseMode: () => void;
	onEnterConfigWizardMode: () => void;
	onEnterSettingsMode: () => void;
	onEnterMcpWizardMode: () => void;
	onEnterExplorerMode: () => void;
	onEnterCheckpointLoadMode: (
		checkpoints: CheckpointListItem[],
		currentMessageCount: number,
	) => void;
	onShowStatus: () => void;
	onHandleChatMessage: (message: string) => Promise<void>;
	onAddToChatQueue: (component: React.ReactNode) => void;
	setLiveComponent: (component: React.ReactNode) => void;
	setIsToolExecuting: (value: boolean) => void;
	onCommandComplete?: () => void;
	getNextComponentKey: () => number;
	setMessages: (messages: Message[]) => void;
	messages: Message[];
	provider: string;
	model: string;
	theme: string;
	updateInfo: UpdateInfo | null;
	getMessageTokens: (message: Message) => number;
}
