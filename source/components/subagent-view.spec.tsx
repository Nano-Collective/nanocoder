import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import stripAnsi from 'strip-ansi';
import {themes} from '../config/themes';
import {ThemeContext} from '../hooks/useTheme';
import {TitleShapeContext} from '../hooks/useTitleShape';
import {UIStateProvider} from '../hooks/useUIState';
import {
	cleanupSubagentSession,
	initSubagentSession,
} from '../services/subagent-session-store';
import {SubagentView} from './subagent-view';

const themeValue = {
	currentTheme: 'tokyo-night' as const,
	colors: themes['tokyo-night'].colors,
	setCurrentTheme: () => {},
};

const titleShapeValue = {
	currentTitleShape: 'pill' as const,
	setCurrentTitleShape: () => {},
	commitTitleShape: () => {},
};

const wrap = (element: React.ReactElement) => (
	<TitleShapeContext.Provider value={titleShapeValue}>
		<ThemeContext.Provider value={themeValue}>
			<UIStateProvider>{element}</UIStateProvider>
		</ThemeContext.Provider>
	</TitleShapeContext.Provider>
);

const tick = () => new Promise(resolve => setTimeout(resolve, 10));

const allOutput = (frames: string[]) => stripAnsi(frames.join('\n'));

test.afterEach(() => {
	cleanupSubagentSession('agent-a');
	cleanupSubagentSession('agent-b');
});

test.serial('renders the attached agent transcript and header', async t => {
	initSubagentSession('agent-a', 'explorer', [
		{role: 'system', content: 'system prompt'},
		{role: 'user', content: 'find the auth flow'},
	]);

	const {frames, lastFrame, unmount} = render(
		wrap(
			<SubagentView
				agentId="agent-a"
				onDetach={() => {}}
				reasoningExpanded={false}
			/>,
		),
	);
	await tick();

	t.regex(stripAnsi(lastFrame() ?? ''), /explorer/);
	t.regex(allOutput(frames), /find the auth flow/);
	unmount();
});

// Regression: the transcript renders through <Static>, which only ever
// appends past its internal item index. Without remounting it per agent
// (clearKey), cycling from a longer session to another agent printed
// nothing — Ctrl+S appeared to not cycle between parallel subagents.
test.serial(
	'cycling to another agent renders that agent transcript',
	async t => {
		initSubagentSession('agent-a', 'explorer', [
			{role: 'system', content: 'system prompt'},
			{role: 'user', content: 'agent A task one'},
			{role: 'assistant', content: 'agent A reply one'},
			{role: 'assistant', content: 'agent A reply two'},
		]);
		initSubagentSession('agent-b', 'reviewer', [
			{role: 'system', content: 'system prompt'},
			{role: 'user', content: 'agent B task'},
		]);

		const {frames, lastFrame, rerender, unmount} = render(
			wrap(
				<SubagentView
					agentId="agent-a"
					onDetach={() => {}}
					reasoningExpanded={false}
				/>,
			),
		);
		await tick();
		t.regex(allOutput(frames), /agent A task one/);
		t.notRegex(allOutput(frames), /agent B task/);

		rerender(
			wrap(
				<SubagentView
					agentId="agent-b"
					onDetach={() => {}}
					reasoningExpanded={false}
				/>,
			),
		);
		await tick();

		t.regex(stripAnsi(lastFrame() ?? ''), /reviewer/);
		t.regex(allOutput(frames), /agent B task/);
		unmount();
	},
);

test.serial('detaches when the session no longer exists', async t => {
	let detached = false;

	const {unmount} = render(
		wrap(
			<SubagentView
				agentId="agent-gone"
				onDetach={() => {
					detached = true;
				}}
				reasoningExpanded={false}
			/>,
		),
	);
	await tick();

	t.true(detached);
	unmount();
});
