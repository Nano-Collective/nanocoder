import test from 'ava';
import {clearCommand} from './clear';
import React from 'react';
import {render} from 'ink-testing-library';
import {themes} from '../config/themes';
import {ThemeContext} from '../hooks/useTheme';

// Mock ThemeProvider for testing
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

test('clearCommand has correct name and description', t => {
	t.is(clearCommand.name, 'clear');
	t.is(clearCommand.description, 'Clear the chat history, model context, and tasks');
});

test('clearCommand handler returns React element', async t => {
	const result = await clearCommand.handler([]);
	t.truthy(React.isValidElement(result));
});

test('clearCommand renders Clear component', async t => {
	const result = await clearCommand.handler([]);

	// Render the result to execute the Clear component
	if (React.isValidElement(result)) {
		const {lastFrame} = render(
			<MockThemeProvider>{result}</MockThemeProvider>,
		);
		const output = lastFrame();

		// Verify the output contains the expected message
		t.truthy(output);
		t.regex(output!, /Chat and tasks cleared/);
	}
});
