import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {themes} from '../config/themes';
import {ThemeContext} from '../hooks/useTheme';
import {TitleShapeContext} from '../hooks/useTitleShape';
import {voiceCommand} from './voice';

const MockProviders = ({children}: {children: React.ReactNode}) => {
	const mockTheme = {
		currentTheme: 'tokyo-night' as const,
		colors: themes['tokyo-night'].colors,
		setCurrentTheme: () => {},
	};

	const mockTitleShape = {
		currentTitleShape: 'pill' as const,
		setCurrentTitleShape: () => {},
	};

	return (
		<ThemeContext.Provider value={mockTheme}>
			<TitleShapeContext.Provider value={mockTitleShape}>
				{children}
			</TitleShapeContext.Provider>
		</ThemeContext.Provider>
	);
};

test('voice command has correct name and description', t => {
	t.is(voiceCommand.name, 'voice');
	t.truthy(voiceCommand.description);
});

test('voice command has a handler function', t => {
	t.is(typeof voiceCommand.handler, 'function');
});

test('voice command toggles state and renders InfoMessage', async t => {
	const result = await voiceCommand.handler([], [], {} as any);
	if (!React.isValidElement(result)) {
		t.fail('Expected React element');
		return;
	}

	const {lastFrame} = render(<MockProviders>{result}</MockProviders>);
	const output = lastFrame();
	
	t.truthy(output);
	t.regex(output!, /Voice mode (enabled|disabled)/);
	t.regex(output!, /audio not yet wired — scaffolding only/);
});
