import React from 'react';
import {CustomCommandLoader} from '@/custom-commands/loader';
import {CustomCommandExecutor} from '@/custom-commands/executor';
import type {Message} from './core';
import type {UpdateInfo} from './utils';
import type {CustomCommand} from './commands';

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
	onShowStatus: () => void;
	onHandleChatMessage: (message: string) => Promise<void>;
	onHandlePlanningMessage?: (message: string) => Promise<void>;
	planningEnabled?: boolean;
	onAddToChatQueue: (component: React.ReactNode) => void;
	componentKeyCounter: number;
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
