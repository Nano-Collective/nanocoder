import {CustomCommandExecutor} from '@/custom-commands/executor';
import {CustomCommandLoader} from '@/custom-commands/loader';
import React from 'react';
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
	onEnterThemeSelectionMode: () => void;
	onEnterModelDatabaseMode: () => void;
	onEnterConfigWizardMode: () => void;
	onEnterCheckpointLoadMode: (
		checkpoints: CheckpointListItem[],
		currentMessageCount: number,
	) => void;
	onShowStatus: () => void;
	onHandleChatMessage: (message: string) => Promise<void>;
	onAddToChatQueue: (component: React.ReactNode) => void;
	onCommandComplete?: () => void;
	getNextComponentKey: () => number;
	setMessages: (messages: Message[]) => void;
	messages: Message[];
	setIsBashExecuting: (executing: boolean) => void;
	setCurrentBashCommand: (command: string) => void;
	provider: string;
	model: string;
	theme: string;
	updateInfo: UpdateInfo | null;
	getMessageTokens: (message: Message) => number;
}
