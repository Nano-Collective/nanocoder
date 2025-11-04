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
	onEnterRecommendationsMode: () => void;
	onEnterConfigWizardMode: () => void;
	onEnterSessionSelectionMode: () => void;
	onShowStatus: () => void;
	onHandleChatMessage: (message: string) => Promise<void>;
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
	sessionManager: any; // SessionManager from useAppState
	convertSessionMessageToAppFormat: (sessionMessage: {
	  role: 'user' | 'assistant' | 'system' | 'tool';
	  content: string;
	  timestamp: number;
	  tool_calls?: Array<{
	    id: string;
	    function: {
	      name: string;
	      arguments: Record<string, unknown>;
	    };
	  }>;
	  tool_call_id?: string;
	  name?: string;
	}) => Message; // Function from useAppState
convertMessageToSessionFormat: (message: Message) => {
	  role: 'user' | 'assistant' | 'system' | 'tool';
	  content: string;
	  timestamp: number;
	  tool_calls?: Array<{
	    id: string;
	    function: {
	      name: string;
	      arguments: Record<string, unknown>;
	    };
	  }>;
	  tool_call_id?: string;
	  name?: string;
	}; // Function from useAppState
setCurrentProvider: (provider: string) => void;
setCurrentModel: (model: string) => void;
setCurrentSession: (session: any) => void; // Session type from useAppState
}
