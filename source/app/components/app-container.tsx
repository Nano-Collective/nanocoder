import React from 'react';
import WelcomeMessage from '@/components/welcome-message';

export interface AppContainerProps {
	shouldShowWelcome: boolean;
}

/**
 * Creates static components for the app container (welcome banner only).
 *
 * The Status box was removed from startup — it rendered inside Ink's
 * <Static> which freezes after first paint, so background work (MCP, LSP,
 * update check) never showed. Users can run /status any time to see the
 * full picture. This also makes boot feel faster: welcome banner + prompt
 * appear immediately with no preamble wall.
 */
export function createStaticComponents({
	shouldShowWelcome,
}: AppContainerProps): React.ReactNode[] {
	const components: React.ReactNode[] = [];

	if (shouldShowWelcome) {
		components.push(<WelcomeMessage key="welcome" />);
	}

	return components;
}
