import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'ava';
import {Text} from 'ink';
import {render} from 'ink-testing-library';
import React from 'react';
import stripAnsi from 'strip-ansi';
import {resetPreferencesCache, savePreferences} from '@/config/preferences';
import {loadBannerModules} from '@/hooks/use-banner-modules';
import {ThemeContext} from '@/hooks/useTheme';
import {TitleShapeContext} from '@/hooks/useTitleShape';
import {createStaticComponents} from './app-container';
import {ChatHistory} from './chat-history';

const theme = {
	currentTheme: 'tokyo-night' as const,
	colors: {
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
	},
	setCurrentTheme: () => {},
};

function withTestProviders(element: React.ReactElement) {
	return (
		<ThemeContext.Provider value={theme}>
			<TitleShapeContext.Provider
				value={{
					currentTitleShape: 'pill',
					setCurrentTitleShape: () => {},
					commitTitleShape: () => {},
				}}
			>
				{element}
			</TitleShapeContext.Provider>
		</ThemeContext.Provider>
	);
}

function renderChat(element: React.ReactElement) {
	return render(withTestProviders(element));
}

test('fullscreen keeps non-welcome banners visible during active conversations', t => {
	const view = renderChat(
		<ChatHistory
			startChat={true}
			staticComponents={[<Text key="status">STATUS-BANNER</Text>]}
			queuedComponents={[<Text key="prompt">USER-PROMPT</Text>]}
			liveComponent={<Text key="live">LIVE-STREAMING</Text>}
			hasConversationMessages={true}
			fullscreen={true}
		/>,
	);

	const output = view.lastFrame() ?? '';
	t.regex(output, /STATUS-BANNER/);
	t.regex(output, /USER-PROMPT/);
	t.regex(output, /LIVE-STREAMING/);
	view.unmount();
});

test.serial(
	'ChatHistory commits the loaded welcome before queued startup notices',
	async t => {
		const configDir = mkdtempSync(
			path.join(tmpdir(), 'nanocoder-static-banner-'),
		);
		const previousConfigDir = process.env.NANOCODER_CONFIG_DIR;
		const originalColumns = process.stdout.columns;
		const originalRows = process.stdout.rows;
		process.env.NANOCODER_CONFIG_DIR = configDir;
		process.stdout.columns = 100;
		process.stdout.rows = 60;

		resetPreferencesCache();
		savePreferences({nanocoderShape: 'block'});

		const queuedComponents = [
			<Text key="configuration-notice">Configuration needed</Text>,
			<Text key="second-startup-notice">Second startup notice</Text>,
		];
		const pendingProps = {
			startChat: true,
			staticComponents: [],
			welcomeModulesPending: true,
			hasConversationMessages: false,
			queuedComponents,
		};
		const inline = renderChat(
			<ChatHistory {...pendingProps} fullscreen={false} />,
		);
		const fullscreen = renderChat(
			<ChatHistory {...pendingProps} fullscreen />,
		);

		try {
			t.notRegex(
				stripAnsi(inline.frames.join('')),
				/Configuration needed/,
				'inline static output must wait for the welcome modules',
			);
			t.notRegex(
				stripAnsi(fullscreen.lastFrame() ?? ''),
				/Configuration needed/,
				'fullscreen startup notices must wait for the welcome modules',
			);

			await loadBannerModules();
			const staticComponents = createStaticComponents({
				shouldShowWelcome: true,
				currentProvider: '',
				currentModel: '',
				nonInteractiveMode: false,
				developmentMode: 'normal',
				availableRows: 60,
			});
			const readyProps = {
				...pendingProps,
				staticComponents,
				welcomeModulesPending: false,
			};

			inline.rerender(
				withTestProviders(
					<ChatHistory {...readyProps} fullscreen={false} />,
				),
			);
			fullscreen.rerender(
				withTestProviders(<ChatHistory {...readyProps} fullscreen />),
			);

			const inlineFirstCommit = inline.frames
				.map(frame => stripAnsi(frame))
				.find(frame => frame.includes('Configuration needed'));
			t.truthy(inlineFirstCommit);
			t.regex(inlineFirstCommit ?? '', /███/);
			t.regex(
				inlineFirstCommit ?? '',
				/Welcome to Nanocoder[\s\S]*Configuration needed[\s\S]*Second startup notice/,
			);
			t.is(
				(inlineFirstCommit?.match(/Configuration needed/g) ?? []).length,
				1,
			);
			t.is(
				(inlineFirstCommit?.match(/Second startup notice/g) ?? []).length,
				1,
			);

			const fullscreenOutput = stripAnsi(fullscreen.lastFrame() ?? '');
			t.regex(fullscreenOutput, /███/);
			t.regex(
				fullscreenOutput,
				/Welcome to Nanocoder[\s\S]*Configuration needed[\s\S]*Second startup notice/,
			);
			t.is((fullscreenOutput.match(/Configuration needed/g) ?? []).length, 1);
			t.is(
				(fullscreenOutput.match(/Second startup notice/g) ?? []).length,
				1,
			);
		} finally {
			inline.unmount();
			fullscreen.unmount();
			savePreferences({});
			resetPreferencesCache();
			rmSync(configDir, {recursive: true, force: true});
			if (previousConfigDir === undefined) {
				delete process.env.NANOCODER_CONFIG_DIR;
			} else {
				process.env.NANOCODER_CONFIG_DIR = previousConfigDir;
			}
			process.stdout.columns = originalColumns;
			process.stdout.rows = originalRows;
		}
	},
);
