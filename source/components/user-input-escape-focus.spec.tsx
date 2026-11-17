import '../test-utils/isolated-config-dir';
import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import stripAnsi from 'strip-ansi';
import {themes} from '../config/themes';
import {ThemeContext} from '../hooks/useTheme';
import {TitleShapeContext} from '../hooks/useTitleShape';
import {UIStateProvider} from '../hooks/useUIState';
import UserInput from './user-input';

console.log('\nuser-input-escape-focus.spec.tsx');

// Ink's App clears the active focus id on every Escape, and the composer's
// TextInput only accepts keys while it holds focus. These specs deliberately
// do NOT pass forceFocus: they exercise the real useFocus path, so an Escape
// branch that forgets to reclaim focus leaves typing dead, as it did in 1.32.

const TestWrapper = ({children}: {children: React.ReactNode}) => (
	<ThemeContext.Provider
		value={{
			currentTheme: 'tokyo-night' as const,
			colors: themes['tokyo-night'].colors,
			setCurrentTheme: () => {},
		}}
	>
		<TitleShapeContext.Provider
			value={{currentTitleShape: 'pill', setCurrentTitleShape: () => {}}}
		>
			<UIStateProvider>{children}</UIStateProvider>
		</TitleShapeContext.Provider>
	</ThemeContext.Provider>
);

const ESC = '\u001B';
const wait = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms));

const waitForFrame = async (
	lastFrame: () => string | undefined,
	predicate: (frame: string) => boolean,
	timeoutMs = 3000,
) => {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		if (predicate(stripAnsi(lastFrame() ?? ''))) return;
		await wait();
	}
	throw new Error(
		`Timed out; last frame:\n${stripAnsi(lastFrame() ?? '')}`,
	);
};

// Send keys one at a time with a gap, like a human: Ink's parser holds a lone
// ESC briefly to see whether it starts a sequence, and a following byte in the
// same chunk would be read as Alt+<key>.
const press = async (stdin: {write: (s: string) => void}, keys: string[]) => {
	for (const key of keys) {
		stdin.write(key);
		await wait(80);
	}
};

const renderInput = (props: Partial<React.ComponentProps<typeof UserInput>>) =>
	render(
		<TestWrapper>
			<UserInput {...props} />
		</TestWrapper>,
	);

const typed = (frame: string, text: string) =>
	frame.split('\n').some(line => line.includes(text));

test('typing still works after Esc on an empty prompt', async t => {
	const {stdin, lastFrame, unmount} = renderInput({});
	await waitForFrame(lastFrame, f => f.includes('Ask anything'));
	await wait(100);
	await press(stdin, [ESC, 'a', 'b', 'c']);
	await waitForFrame(lastFrame, f => typed(f, 'abc'));
	t.pass();
	unmount();
});

test('typing still works after Esc dismisses the suggested command', async t => {
	let dismissed = 0;
	const {stdin, lastFrame, unmount} = renderInput({
		suggestedCommand: '/commit',
		onDismissSuggestion: () => {
			dismissed++;
		},
	});
	await waitForFrame(lastFrame, f => f.includes('Try /commit'));
	await wait(100);
	await press(stdin, [ESC, 'a', 'b', 'c']);
	await waitForFrame(lastFrame, f => typed(f, 'abc'));
	t.is(dismissed, 1);
	unmount();
});

test('typing still works after Esc closes the shortcuts legend', async t => {
	const {stdin, lastFrame, unmount} = renderInput({});
	await waitForFrame(lastFrame, f => f.includes('Ask anything'));
	await wait(100);
	await press(stdin, ['?']);
	await waitForFrame(lastFrame, f => f.includes('Keyboard Shortcuts'));
	await press(stdin, [ESC]);
	await waitForFrame(lastFrame, f => !f.includes('Keyboard Shortcuts'));
	await press(stdin, ['a', 'b', 'c']);
	await waitForFrame(lastFrame, f => typed(f, 'abc'));
	t.pass();
	unmount();
});

test('typing still works after Esc closes the command completion menu', async t => {
	const {stdin, lastFrame, unmount} = renderInput({
		customCommands: ['zzalpha', 'zzbeta'],
	});
	await waitForFrame(lastFrame, f => f.includes('Ask anything'));
	await wait(100);
	await press(stdin, ['/', 'z', 'z']);
	await waitForFrame(lastFrame, f => f.includes('zzalpha'));
	await press(stdin, [ESC]);
	await waitForFrame(lastFrame, f => !f.includes('Available commands'));
	await press(stdin, ['a', 'b', 'c']);
	await waitForFrame(lastFrame, f => typed(f, '/zzabc'));
	t.pass();
	unmount();
});

test('typing still works after a single Esc arms the clear hint', async t => {
	const {stdin, lastFrame, unmount} = renderInput({});
	await waitForFrame(lastFrame, f => f.includes('Ask anything'));
	await wait(100);
	await press(stdin, ['h', 'i']);
	await waitForFrame(lastFrame, f => typed(f, 'hi'));
	await press(stdin, [ESC]);
	await waitForFrame(lastFrame, f => f.includes('Press escape again to clear'));
	await press(stdin, ['a', 'b', 'c']);
	await waitForFrame(lastFrame, f => typed(f, 'hiabc'));
	t.pass();
	unmount();
});
