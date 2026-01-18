import React from 'react';
import Status from '@/components/status';
import WelcomeMessage from '@/components/welcome-message';
import type {
	LSPConnectionStatus,
	MCPConnectionStatus,
	PlanPhase,
} from '@/types/core';
import type {ThemePreset} from '@/types/ui';
import type {UpdateInfo} from '@/types/utils';

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
	vscodeMode?: boolean;
	vscodePort?: number | null;
	vscodeRequestedPort?: number;
	planModeActive?: boolean;
	planPhase?: PlanPhase;
	planSummary?: string;
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
	vscodeMode,
	vscodePort,
	vscodeRequestedPort,
	planModeActive,
	planPhase,
	planSummary,
}: AppContainerProps): React.ReactNode[] {
	const components: React.ReactNode[] = [];

	if (shouldShowWelcome) {
		components.push(<WelcomeMessage key="welcome" />);
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
			vscodeMode={vscodeMode}
			vscodePort={vscodePort}
			vscodeRequestedPort={vscodeRequestedPort}
			planModeActive={planModeActive}
			planPhase={planPhase}
			planSummary={planSummary}
		/>,
	);

	return components;
}
