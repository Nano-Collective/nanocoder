import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import stripAnsi from 'strip-ansi';
import {themes} from '../config/themes';
import {ThemeContext} from '../hooks/useTheme';
import {UIStateProvider} from '../hooks/useUIState';
import {setToolManagerGetter} from '../message-handler';
import {promptHistory} from '../prompt-history';
import type {ToolManager} from '../tools/tool-manager';
import UserInput from './user-input';

console.log('\nuser-input-completion.spec.tsx');

const TestWrapper = ({children}: {children: React.ReactNode}) => (
	<ThemeContext.Provider
		value={{
			currentTheme: 'tokyo-night' as const,
			colors: themes['tokyo-night'].colors,
			setCurrentTheme: () => {},
		}}
	>
		<UIStateProvider>{children}</UIStateProvider>
	</ThemeContext.Provider>
);

const wait = (ms = 200) => new Promise(resolve => setTimeout(resolve, ms));

const waitForFrame = async (
	lastFrame: () => string | undefined,
	pattern: RegExp,
	timeoutMs = 3000,
) => {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		if (pattern.test(lastFrame() ?? '')) return;
		await wait(25);
	}
	throw new Error(`Timed out waiting for ${pattern}`);
};

const DOWN = '\u001B[B';
const UP = '\u001B[A';
const TAB = '\t';

// Regression: upstream #696 made the command menu Tab-triggered, and it often
// failed to render at all (esp. in alt-screen). These cover show-on-`/` and
// Tab-to-select-the-highlighted.

test('typing / auto-shows the command suggestion menu', async t => {
	const {stdin, lastFrame, unmount} = render(
		<TestWrapper>
			<UserInput forceFocus={true} customCommands={['zzalpha', 'zzbeta']} />
		</TestWrapper>,
	);
	stdin.write('/zz');
	await waitForFrame(lastFrame, /zzalpha/);
	t.regex(stripAnsi(lastFrame() ?? ''), /zzalpha/);
	unmount();
});

test('Tab selects the highlighted suggestion when the menu is open', async t => {
	const {stdin, lastFrame, unmount} = render(
		<TestWrapper>
			<UserInput forceFocus={true} customCommands={['zzalpha', 'zzbeta']} />
		</TestWrapper>,
	);
	stdin.write('/zz');
	await waitForFrame(lastFrame, /zzbeta/);
	stdin.write(DOWN); // highlight the second suggestion (zzbeta)
	await wait();
	stdin.write(TAB); // select the highlighted one
	await waitForFrame(lastFrame, /\/zzbeta/);
	t.regex(stripAnsi(lastFrame() ?? ''), /\/zzbeta/);
	unmount();
});

// Regression (reviewer feedback on #701): auto-showing the menu on `/` must NOT
// fire when the input was RECALLED from history — otherwise the open menu
// captures the arrow keys and blocks further history navigation. A recalled
// `/command` stays quiet until the user types into it.
test('a command recalled from history does not auto-open the menu until typed', async t => {
	// Seed the most-recent history entry as a partial command that matches BOTH
	// custom commands. If the menu opened, `zzbeta` (a menu-only string, never in
	// the `/zz` input) would appear in the frame.
	promptHistory.addPrompt('/zz');

	const {stdin, lastFrame, unmount} = render(
		<TestWrapper>
			<UserInput forceFocus={true} customCommands={['zzalpha', 'zzbeta']} />
		</TestWrapper>,
	);

	stdin.write(UP); // recall `/zz` from history
	await waitForFrame(lastFrame, /\/zz/);
	await wait(300); // give any (unwanted) auto-show time to render
	t.notRegex(
		stripAnsi(lastFrame() ?? ''),
		/zzbeta/,
		'menu stays closed for a history-recalled command',
	);

	stdin.write('a'); // typing re-enables the menu -> `/zza` matches zzalpha
	await waitForFrame(lastFrame, /zzalpha/);
	t.regex(
		stripAnsi(lastFrame() ?? ''),
		/zzalpha/,
		'typing into the recalled command surfaces suggestions again',
	);

	unmount();
});

// Regression (reviewer feedback on #1172): an MCP resource shares the file
// `@`-mention completion list, and the list's displayPath ("name (server)",
// for on-screen disambiguation only) was being passed as the resourceName
// argument instead of the bare resource name. That stamped the server
// annotation twice: once from displayPath, once from the assembled prompt
// header ("=== MCP Resource: x (from server) ==="). Selecting the resource
// must produce a plain `[@<name>]` chip.
test('selecting an MCP resource mention does not double-stamp the server name', async t => {
	const fakeResource = {
		uri: 'file:///docs/api.md',
		name: 'api-docs',
		serverName: 'docs-server',
	};
	const fakeMCPClient = {
		getAllResources: () => [fakeResource],
		readResource: async () => [
			{uri: fakeResource.uri, mimeType: 'text/markdown', text: 'hello'},
		],
	};
	setToolManagerGetter(
		() =>
			({
				getMCPClient: () => fakeMCPClient,
			}) as unknown as ToolManager,
	);
	t.teardown(() => setToolManagerGetter(() => null));

	const {stdin, lastFrame, unmount} = render(
		<TestWrapper>
			<UserInput forceFocus={true} />
		</TestWrapper>,
	);

	stdin.write('@api-docs');
	await waitForFrame(lastFrame, /api-docs \(docs-server\)/); // completion list shows the disambiguated form
	// The per-keystroke autocomplete effect has no in-flight cancellation, so a
	// stale fetch for an earlier partial mention (e.g. "api-do") can still
	// resolve after the final one and briefly overwrite the completion list.
	// Give those stragglers time to settle before selecting, matching this
	// file's existing pattern for other timing-sensitive interactions.
	await wait(300);
	stdin.write(TAB);
	await waitForFrame(lastFrame, /\[@api-docs\]/);

	const frame = stripAnsi(lastFrame() ?? '');
	t.regex(frame, /\[@api-docs\]/);
	t.notRegex(
		frame,
		/\[@api-docs \(docs-server\)\]/,
		'the placeholder chip must not carry the server name a second time',
	);

	unmount();
});
