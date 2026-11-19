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

test('voice command handles ptt and hands-free subcommands and enables voice', async t => {
	const initialPref = getVoicePreference();
	try {
		// Ensure initial state is disabled
		updateVoicePreference({ ...initialPref, enabled: false, activationMode: 'hands-free' });

		const pttResult = await voiceCommand.handler(['ptt'], [], {} as any);
		t.true(React.isValidElement(pttResult));
		let pref = getVoicePreference();
		t.true(pref.enabled, '/voice ptt must set enabled to true');
		t.is(pref.activationMode, 'push-to-talk');

		// Now disable and test hands-free
		updateVoicePreference({ ...pref, enabled: false });
		const hfResult = await voiceCommand.handler(['hands-free'], [], {} as any);
		t.true(React.isValidElement(hfResult));
		pref = getVoicePreference();
		t.true(pref.enabled, '/voice hands-free must set enabled to true');
		t.is(pref.activationMode, 'hands-free');
	} finally {
		updateVoicePreference(initialPref);
	}
});

test('voice command handles mode subcommand with valid and invalid arguments', async t => {
	const initialPref = getVoicePreference();
	try {
		updateVoicePreference({ ...initialPref, enabled: false, activationMode: 'push-to-talk' });

		// Valid mode: hands-free
		const validResult = await voiceCommand.handler(['mode', 'hands-free'], [], {} as any);
		t.true(React.isValidElement(validResult));
		let pref = getVoicePreference();
		t.true(pref.enabled);
		t.is(pref.activationMode, 'hands-free');

		// Invalid mode: foobar
		const invalidResult = await voiceCommand.handler(['mode', 'foobar'], [], {} as any);
		t.true(React.isValidElement(invalidResult));
		const { lastFrame } = render(<MockProviders>{invalidResult}</MockProviders>);
		const output = lastFrame();
		t.regex(output!, /Invalid voice mode 'foobar'/);

		// Config must NOT have silently changed
		pref = getVoicePreference();
		t.is(pref.activationMode, 'hands-free', 'Invalid mode should not mutate activationMode');
	} finally {
		updateVoicePreference(initialPref);
	}
});

test('voice command rejects unknown top-level subcommands with an error', async t => {
	const initialPref = getVoicePreference();
	try {
		const result = await voiceCommand.handler(['unknown_arg'], [], {} as any);
		t.true(React.isValidElement(result));

		const { lastFrame } = render(<MockProviders>{result}</MockProviders>);
		const output = lastFrame();
		t.regex(output!, /Unknown voice command 'unknown_arg'/);
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
