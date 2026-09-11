import {render} from 'ink-testing-library';
import React from 'react';
import {ThemeContext} from '@/hooks/useTheme';
import {TitleShapeContext} from '@/hooks/useTitleShape';
import {UIStateProvider} from '@/hooks/useUIState';
import type {Colors, ThemePreset} from '@/types/ui';

// Default test colors that match the structure used in the app
const testColors: Colors = {
	primary: 'blue',
	secondary: 'gray',
	text: 'white',
	base: 'black',
	info: 'cyan',
	warning: 'yellow',
	error: 'red',
	success: 'green',
	tool: 'magenta',
	diffAdded: 'green',
	diffRemoved: 'red',
	diffAddedText: 'text',
	diffRemovedText: 'text',
};

// Test theme context value
const testThemeContext = {
	currentTheme: 'tokyo-night' as ThemePreset,
	colors: testColors,
	setCurrentTheme: () => {},
};

// Test title shape context value
const testTitleShapeContext = {
	currentTitleShape: 'pill' as const,
	setCurrentTitleShape: () => {},
};

/**
 * Wrapper component that provides ThemeContext and TitleShapeContext for tests
 */
function TestThemeProvider({
	children,
	withUIState,
}: {
	children: React.ReactNode;
	withUIState: boolean;
}) {
	return (
		<TitleShapeContext.Provider value={testTitleShapeContext}>
			<ThemeContext.Provider value={testThemeContext}>
				{withUIState ? <UIStateProvider>{children}</UIStateProvider> : children}
			</ThemeContext.Provider>
		</TitleShapeContext.Provider>
	);
}

/**
 * Render a component wrapped with ThemeContext and TitleShapeContext for testing.
 *
 * `withUIState` wraps the subtree in a UIStateProvider, on by default so leaf
 * components can be rendered in isolation. Pass false when the component under
 * test is supposed to provide its own — otherwise the harness supplies a
 * context the real app doesn't, and a missing provider reads as a passing test.
 */
export function renderWithTheme(
	element: React.ReactElement,
	{withUIState = true}: {withUIState?: boolean} = {},
): ReturnType<typeof render> {
	return render(
		<TestThemeProvider withUIState={withUIState}>{element}</TestThemeProvider>,
	);
}
