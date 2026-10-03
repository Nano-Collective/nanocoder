import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {themes} from '../../config/themes.js';
import {ThemeContext} from '../../hooks/useTheme.js';
import {fileOpTool} from './file-op.js';

function TestThemeProvider({children}: {children: React.ReactNode}) {
	const themeContextValue = {
		currentTheme: 'tokyo-night' as const,
		colors: themes['tokyo-night'].colors,
		setCurrentTheme: () => {},
	};

	return (
		<ThemeContext.Provider value={themeContextValue}>
			{children}
		</ThemeContext.Provider>
	);
}

test('file_op formatter renders description when provided', async t => {
	const formatter = fileOpTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = await formatter({
		operation: 'delete',
		path: 'old-file.txt',
		description: 'Remove deprecated configuration file.',
	});

	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Description:/);
	t.regex(output!, /Remove deprecated configuration file\./);
	t.regex(output!, /Operation:/);
	t.regex(output!, /delete/);
});

test('file_op formatter does not render description when omitted', async t => {
	const formatter = fileOpTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = await formatter({
		operation: 'delete',
		path: 'old-file.txt',
	});

	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);
	const output = lastFrame();
	t.truthy(output);
	t.notRegex(output!, /Description:/);
	t.regex(output!, /Operation:/);
	t.regex(output!, /delete/);
});
