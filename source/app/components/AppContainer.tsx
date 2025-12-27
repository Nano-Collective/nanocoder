import Status from '@/components/status';
import WelcomeMessage from '@/components/welcome-message';
import type {LSPConnectionStatus, MCPConnectionStatus} from '@/types/core';
import type {ThemePreset} from '@/types/ui';
import type {UpdateInfo} from '@/types/utils';
import {getLogger} from '@/utils/logging';
import React from 'react';

export interface AppContainerProps {
	shouldShowWelcome: boolean;
	currentProvider: string;
	currentModel: string;
	currentTheme: ThemePreset;
	updateInfo: UpdateInfo | null;
	mcpServersStatus: MCPConnectionStatus[] | undefined;
	lspServersStatus: LSPConnectionStatus[];
	preferencesLoaded: boolean;
	customCommandsCount: number;
}

/**
 * Creates static components for the app container (welcome message + status)
 * These are memoized to prevent unnecessary re-renders
 */
export function createStaticComponents({
	shouldShowWelcome,
	currentProvider,
	currentModel,
	currentTheme,
	updateInfo,
	mcpServersStatus,
	lspServersStatus,
	preferencesLoaded,
	customCommandsCount,
}: AppContainerProps): React.ReactNode[] {
	const logger = getLogger();
	const components: React.ReactNode[] = [];

	if (shouldShowWelcome) {
		components.push(<WelcomeMessage key="welcome" />);
		logger.debug('Static component created', {
			componentType: 'WelcomeMessage',
			key: 'welcome',
		});
	}

	components.push(
		<Status
			key="status"
			provider={currentProvider}
			model={currentModel}
			theme={currentTheme}
			updateInfo={updateInfo}
			mcpServersStatus={mcpServersStatus}
			lspServersStatus={lspServersStatus}
			preferencesLoaded={preferencesLoaded}
			customCommandsCount={customCommandsCount}
		/>,
	);
	logger.debug('Static component created', {
		componentType: 'Status',
		key: 'status',
	});

	logger.debug('createStaticComponents complete', {
		totalComponents: components.length,
		keys: components.map(c =>
			React.isValidElement(c) ? c.key : 'non-element',
		),
	});

	return components;
}
