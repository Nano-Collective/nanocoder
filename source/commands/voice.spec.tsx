import test from 'ava';
import { render } from 'ink-testing-library';
import React from 'react';
import { getVoicePreference, updateVoicePreference } from '@/config/preferences';
import { themes } from '../config/themes';
import { ThemeContext } from '../hooks/useTheme';
import { TitleShapeContext } from '../hooks/useTitleShape';
import { voiceCommand } from './voice';

const MockProviders = ({ children }: { children: React.ReactNode }) => {
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
	const initialPref = getVoicePreference();
	try {
		const result = await voiceCommand.handler([], [], {} as any);
		t.true(React.isValidElement(result));

		const { lastFrame } = render(<MockProviders>{result}</MockProviders>);
		const output = lastFrame();

		t.truthy(output);
		t.regex(output!, /Voice mode (enabled|disabled)/);
	} finally {
		updateVoicePreference(initialPref);
	}
});

test('voice command handles stt subcommand', async t => {
	const initialPref = getVoicePreference();
	try {
		const result = await voiceCommand.handler(['stt', 'cloud'], [], {} as any);
		t.true(React.isValidElement(result));

		const { lastFrame } = render(<MockProviders>{result}</MockProviders>);
		const output = lastFrame();
		t.truthy(output);
		t.regex(output!, /Voice STT backend set to: cloud/);

		const updatedPref = getVoicePreference();
		t.is(updatedPref.sttBackend, 'cloud');
	} finally {
		updateVoicePreference(initialPref);
	}
});

test('voice command handles tts subcommand', async t => {
	const initialPref = getVoicePreference();
	try {
		const result = await voiceCommand.handler(['tts', 'cloud'], [], {} as any);
		t.true(React.isValidElement(result));

		const { lastFrame } = render(<MockProviders>{result}</MockProviders>);
		const output = lastFrame();
		t.truthy(output);
		t.regex(output!, /Voice TTS backend set to: cloud/);

		const updatedPref = getVoicePreference();
		t.is(updatedPref.ttsBackend, 'cloud');
	} finally {
		updateVoicePreference(initialPref);
	}
});

test('voice command handles status subcommand', async t => {
	const initialPref = getVoicePreference();
	try {
		const result = await voiceCommand.handler(['status'], [], {} as any);
		t.true(React.isValidElement(result));

		const { lastFrame } = render(<MockProviders>{result}</MockProviders>);
		const output = lastFrame();
		t.truthy(output);
		t.regex(output!, /Voice Mode:/);
		t.regex(output!, /STT Backend:/);
		t.regex(output!, /TTS Backend:/);
	} finally {
		updateVoicePreference(initialPref);
	}
});
