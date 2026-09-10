import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import ProcessingIndicator from './processing-indicator';
import {ThemeContext} from '../hooks/useTheme';
import {themes} from '../config/themes';

const MockThemeProvider = ({children}: {children: React.ReactNode}) => {
	const mockTheme = {
		currentTheme: 'tokyo-night' as const,
		colors: themes['tokyo-night'].colors,
		setCurrentTheme: () => {},
	};

	return (
		<ThemeContext.Provider value={mockTheme}>{children}</ThemeContext.Provider>
	);
};

test('ProcessingIndicator renders with default phrase and cancel instruction', t => {
	const {lastFrame, unmount} = render(
		<MockThemeProvider>
			<ProcessingIndicator model="gemini-3.8-flash" />
		</MockThemeProvider>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Thinking/);
	t.regex(output!, /gemini-3\.8-flash/);
	t.regex(output!, /Esc to cancel/);
	unmount();
});

test('ProcessingIndicator renders custom label if provided', t => {
	const {lastFrame, unmount} = render(
		<MockThemeProvider>
			<ProcessingIndicator label="Preparing response" model="claude-3.7-sonnet" />
		</MockThemeProvider>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Preparing response/);
	t.regex(output!, /claude-3\.7-sonnet/);
	unmount();
});
