import '../test-utils/isolated-config-dir';
import {readFileSync, writeFileSync} from 'node:fs';
import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import stripAnsi from 'strip-ansi';
import {getClosestConfigFile} from '../config/index';
import {themes} from '../config/themes';
import {ThemeContext} from '../hooks/useTheme';
import {TitleShapeContext} from '../hooks/useTitleShape';
import {UIStateProvider} from '../hooks/useUIState';
import {promptHistory} from '../prompt-history';
import {KEYBOARD_SHORTCUTS} from './composer/keymap';
import UserInput from './user-input';

// Characterisation of every row in the `?` legend, pinned through the real
// composer before user-input.tsx is split into hooks. Each legend row must be
// covered either by a test in this file or by a named test elsewhere; the
// coverage test at the bottom fails if a row is added, renamed or dropped
// without updating the table.

console.log(`\nuser-input.keybindings.spec.tsx – ${React.version}`);

const KEY = {
	enter: '\r',
	optEnter: '\u001b\r',
	up: '\u001b[A',
	down: '\u001b[B',
	left: '\u001b[D',
	tab: '\t',
	shiftTab: '\u001b[Z',
	escape: '\u001b',
	ctrlA: '\u0001',
	ctrlC: '\u0003',
	ctrlE: '\u0005',
	ctrlK: '\u000b',
	ctrlO: '\u000f',
	ctrlS: '\u0013',
	ctrlU: '\u0015',
	ctrlV: '\u0016',
	ctrlW: '\u0017',
	ctrlX: '\u0018',
	ctrlLeft: '\u001b[1;5D',
	ctrlRight: '\u001b[1;5C',
} as const;

const TestWrapper = ({children}: {children: React.ReactNode}) => (
	<ThemeContext.Provider
		value={{
			currentTheme: 'tokyo-night',
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

const wait = async (ms = 50) =>
	new Promise(resolve => setTimeout(resolve, ms));

const waitForCondition = async (condition: () => boolean, timeoutMs = 3000) => {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		if (condition()) return;
		await wait(25);
	}
	throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
};

const frameText = (lastFrame: () => string | undefined) =>
	stripAnsi(lastFrame() ?? '');

const waitForFrame = (lastFrame: () => string | undefined, pattern: RegExp) =>
	waitForCondition(() => pattern.test(frameText(lastFrame)));

type ComposerProps = React.ComponentProps<typeof UserInput>;

/**
 * Render the composer with a submit recorder. `press` writes one key and lets
 * it settle, so a key never lands in the same stdin batch as the next one -
 * batching is its own behaviour, pinned in user-input.spec.tsx.
 */
function renderComposer(props: ComposerProps = {}) {
	const submitted: string[] = [];
	const view = render(
		<TestWrapper>
			<UserInput
				forceFocus={true}
				onSubmit={message => {
					submitted.push(message);
				}}
				{...props}
			/>
		</TestWrapper>,
	);
	const press = async (...keys: string[]) => {
		for (const key of keys) {
			view.stdin.write(key);
			await wait();
		}
	};
	const type = async (text: string) => {
		view.stdin.write(text);
		await waitForFrame(view.lastFrame, new RegExp(escapeRegExp(text)));
		await wait();
	};
	const submit = async () => {
		const before = submitted.length;
		view.stdin.write(KEY.enter);
		await waitForCondition(() => submitted.length > before);
		return submitted.at(-1);
	};
	return {...view, submitted, press, type, submit};
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function seedPromptHistory(prompts: string[]): Promise<void> {
	writeFileSync(
		getClosestConfigFile('.nano-coder-history'),
		'---JSON_FORMAT---[]',
		'utf8',
	);
	await promptHistory.loadHistory();
	for (const prompt of prompts) promptHistory.addPrompt(prompt);
	await promptHistory.saveHistory();
}

// --- Coverage bookkeeping ---------------------------------------------------

const coverage = new Map<string, string[]>();
const LEGEND_KEYS = new Set(KEYBOARD_SHORTCUTS.map(([keybind]) => keybind));

function record(keybind: string, where: string) {
	coverage.set(keybind, [...(coverage.get(keybind) ?? []), where]);
}

/** A characterisation of one legend row, driven through the composer here. */
function binding(
	keybind: string,
	title: string,
	fn: Parameters<typeof test.serial>[1],
) {
	record(keybind, 'here');
	test.serial(`[${keybind}] ${title}`, fn);
}

/** A legend row whose behaviour is already pinned by a named test elsewhere. */
const elsewhere: Array<{keybind: string; file: string; title: string}> = [];
function coveredBy(keybind: string, file: string, title: string) {
	record(keybind, `${file}: ${title}`);
	elsewhere.push({keybind, file, title});
}

// --- Enter --------------------------------------------------------------------

binding('Enter', 'submits the typed prompt and clears the composer', async t => {
	const composer = renderComposer();
	t.teardown(composer.unmount);

	await composer.type('ship it');
	t.is(await composer.submit(), 'ship it');
	await waitForCondition(() => !/ship it/.test(frameText(composer.lastFrame)));
});

binding('Enter', 'does not submit an empty prompt', async t => {
	const composer = renderComposer();
	t.teardown(composer.unmount);

	await composer.press(KEY.enter);
	await wait(150);
	t.deepEqual(composer.submitted, []);
});

// --- New line -----------------------------------------------------------------

binding(
	'Ctrl+J / Opt+Enter',
	'Opt+Enter inserts a line break at the caret instead of submitting',
	async t => {
		const composer = renderComposer();
		t.teardown(composer.unmount);

		await composer.type('onetwo');
		await composer.press(KEY.left, KEY.left, KEY.left, KEY.optEnter);
		t.deepEqual(composer.submitted, []);
		t.is(await composer.submit(), 'one\ntwo');
	},
);
coveredBy(
	'Ctrl+J / Opt+Enter',
	'user-input.spec.tsx',
	'Ctrl+J still inserts a line break in both encodings',
);

// --- Prompt history -----------------------------------------------------------

binding(
	'↑ / ↓',
	'walks prompt history newest first and returns to the draft',
	async t => {
		await seedPromptHistory(['first prompt', 'second prompt']);
		const composer = renderComposer();
		t.teardown(composer.unmount);

		await composer.type('my draft');
		await composer.press(KEY.up);
		await waitForFrame(composer.lastFrame, /second prompt/);
		await composer.press(KEY.up);
		await waitForFrame(composer.lastFrame, /first prompt/);
		await composer.press(KEY.down);
		await waitForFrame(composer.lastFrame, /second prompt/);
		await composer.press(KEY.down);
		await waitForFrame(composer.lastFrame, /my draft/);
		t.is(await composer.submit(), 'my draft');
	},
);

binding('↑ / ↓', 'a recalled prompt submits as-is on Enter', async t => {
	await seedPromptHistory(['recall me']);
	const composer = renderComposer();
	t.teardown(composer.unmount);

	await composer.press(KEY.up);
	await waitForFrame(composer.lastFrame, /recall me/);
	t.is(await composer.submit(), 'recall me');
});

coveredBy(
	'↑ / ↓',
	'user-input.spec.tsx',
	'arrow key navigation updates the selected completion',
);

// --- Tab ----------------------------------------------------------------------

binding(
	'Tab',
	'completes a slash command with a single match',
	async t => {
		const composer = renderComposer({customCommands: ['zz-unique-cmd']});
		t.teardown(composer.unmount);

		await composer.type('/zz-uni');
		await composer.press(KEY.tab);
		await waitForFrame(composer.lastFrame, /\/zz-unique-cmd/);
		t.deepEqual(composer.submitted, []);
	},
);
coveredBy(
	'Tab',
	'user-input.spec.tsx',
	'UserInput shows a suggested command in the empty prompt and inserts it on Tab',
);

// --- Readline editing ---------------------------------------------------------

binding(
	'Ctrl+A / Ctrl+E',
	'move the caret to the start and end of the line',
	async t => {
		const composer = renderComposer();
		t.teardown(composer.unmount);

		await composer.type('bc');
		await composer.press(KEY.ctrlA, 'a', KEY.ctrlE, 'd');
		t.is(await composer.submit(), 'abcd');
	},
);

binding(
	'Ctrl+← / Ctrl+→',
	'jump the caret back and forward one word',
	async t => {
		const composer = renderComposer();
		t.teardown(composer.unmount);

		await composer.type('one two three');
		await composer.press(KEY.ctrlLeft, KEY.ctrlLeft, '>');
		// Ctrl+→ skips the rest of the word and the gap after it, landing on
		// the start of the next word (as text-input.spec.ts pins).
		await composer.press(KEY.ctrlRight, '<');
		t.is(await composer.submit(), 'one >two <three');
	},
);

binding('Ctrl+W', 'deletes the word before the caret', async t => {
	const composer = renderComposer();
	t.teardown(composer.unmount);

	await composer.type('keep drop');
	await composer.press(KEY.ctrlW);
	t.is(await composer.submit(), 'keep ');
});

binding(
	'Ctrl+U / Ctrl+K',
	'delete to the end, then to the start, of the line',
	async t => {
		const composer = renderComposer();
		t.teardown(composer.unmount);

		await composer.type('abcdef');
		await composer.press(KEY.left, KEY.left, KEY.left, KEY.ctrlK);
		await waitForCondition(
			() => !/abcdef/.test(frameText(composer.lastFrame)),
		);
		await composer.press(KEY.left, KEY.ctrlU, 'X');
		t.is(await composer.submit(), 'Xc');
	},
);

coveredBy(
	'Ctrl+Z / Ctrl+Y',
	'user-input.spec.tsx',
	'UserInput undoes the last edit with ctrl+z',
);
coveredBy(
	'Ctrl+Z / Ctrl+Y',
	'user-input.spec.tsx',
	'UserInput redoes an undone edit with ctrl+y',
);

// --- Escape -------------------------------------------------------------------

coveredBy(
	'Esc Esc',
	'user-input.spec.tsx',
	'Escape still offers to clear when the composer has text',
);
coveredBy(
	'Esc Esc',
	'user-input.spec.tsx',
	'UserInput dismisses the suggested command on Esc in an empty prompt',
);

binding(
	'Esc',
	'while busy the composer leaves Escape to the cancel handler and keeps the draft',
	async t => {
		const composer = renderComposer({isBusy: true});
		t.teardown(composer.unmount);

		await composer.type('still here');
		await composer.press(KEY.escape);
		await wait(150);
		const frame = frameText(composer.lastFrame);
		t.notRegex(frame, /Press escape again to clear/);
		t.regex(frame, /still here/);
	},
);
coveredBy(
	'Esc',
	'../app/sections/interactive-app.spec.tsx',
	'Escape cancels in-flight LLM generation on the first press',
);
coveredBy(
	'Esc',
	'../app/sections/interactive-app.spec.tsx',
	'Escape recalls an in-flight user message before assistant streaming starts',
);

// --- Images -------------------------------------------------------------------

binding(
	'Ctrl+V / Ctrl+X',
	'Ctrl+X removes the last attached image; neither key types text',
	async t => {
		const composer = renderComposer({
			restoreSubmittedDraft: {
				id: 1,
				inputState: {displayValue: 'with image', placeholderContent: {}},
				attachments: [
					{data: 'abc', mediaType: 'image/png'},
					{data: 'def', mediaType: 'image/png'},
				],
			},
		});
		t.teardown(composer.unmount);

		await waitForFrame(composer.lastFrame, /\[image #2: image\]/);
		await composer.press(KEY.ctrlX);
		await waitForCondition(
			() => !/\[image #2/.test(frameText(composer.lastFrame)),
		);
		t.regex(frameText(composer.lastFrame), /\[image #1: image\]/);

		// Ctrl+V reads the system clipboard; whatever it holds, the key itself
		// must never reach the text.
		await composer.press(KEY.ctrlV);
		t.is(await composer.submit(), 'with image');
	},
);

// --- Queued messages ----------------------------------------------------------

coveredBy(
	'↓ then Enter / Delete',
	'user-input.spec.tsx',
	'UserInput loads selected queued message for editing while busy',
);
coveredBy(
	'↓ then Enter / Delete',
	'user-input.spec.tsx',
	'UserInput removes selected queued message with Delete',
);

// --- App-level toggles routed through the composer ----------------------------

binding('Shift+Tab', 'calls onToggleMode', async t => {
	let toggles = 0;
	const composer = renderComposer({onToggleMode: () => toggles++});
	t.teardown(composer.unmount);

	await composer.press(KEY.shiftTab);
	await waitForCondition(() => toggles === 1);
	t.is(toggles, 1);
});

binding(
	'Ctrl+O',
	'toggles compact tool output, including while disabled',
	async t => {
		let toggles = 0;
		const composer = renderComposer({
			onToggleCompactDisplay: () => toggles++,
		});
		t.teardown(composer.unmount);

		await composer.press(KEY.ctrlO);
		await waitForCondition(() => toggles === 1);

		composer.rerender(
			<TestWrapper>
				<UserInput
					forceFocus={true}
					disabled={true}
					onToggleCompactDisplay={() => toggles++}
				/>
			</TestWrapper>,
		);
		await wait();
		await composer.press(KEY.ctrlO);
		await waitForCondition(() => toggles === 2);
		t.is(toggles, 2);
	},
);

coveredBy(
	'Ctrl+N',
	'user-input.spec.tsx',
	'UserInput calls onToggleReasoningExpanded when ctrl+n is pressed',
);
coveredBy(
	'Ctrl+R',
	'user-input.spec.tsx',
	'UserInput enters reverse prompt search on ctrl+r and displays matched prompt',
);
coveredBy(
	'Ctrl+R',
	'user-input.spec.tsx',
	'UserInput cancels reverse search on Escape and restores original draft',
);
coveredBy(
	'Ctrl+T',
	'user-input.spec.tsx',
	'UserInput calls onToggleTaskList when ctrl+t is pressed while disabled',
);
coveredBy(
	'Ctrl+G',
	'user-input.spec.tsx',
	'UserInput leaves Ctrl+G alone so voice push-to-talk keeps working',
);

// Ctrl+S and Ctrl+C are handled by App.tsx's global useInput, which the
// composer split does not touch. What the composer owes them is to let the
// key through untouched: no text, no submit.
for (const [keybind, key] of [
	['Ctrl+S', KEY.ctrlS],
	['Ctrl+C', KEY.ctrlC],
] as const) {
	binding(keybind, 'the composer neither types nor submits it', async t => {
		const composer = renderComposer();
		t.teardown(composer.unmount);

		await composer.type('abc');
		await composer.press(key);
		t.deepEqual(composer.submitted, []);
		t.is(await composer.submit(), 'abc');
	});
}

// --- Transcript scroll and the overlay itself ---------------------------------

coveredBy(
	'PgUp / PgDn / wheel',
	'../app/sections/interactive-app.spec.tsx',
	'PgUp/PgDn scroll the shortcuts overlay but not the transcript behind it',
);
coveredBy(
	'PgUp / PgDn / wheel',
	'../app/components/chat-history.spec.tsx',
	'PageUp is ignored (no crash, no indicator) when scrollActive is false, even in fullscreen',
);
coveredBy(
	'?',
	'user-input.spec.tsx',
	'UserInput opens the shortcuts overlay on ? in an empty prompt and closes it on Esc',
);
coveredBy(
	'?',
	'user-input.spec.tsx',
	'UserInput types ? literally when the prompt is not empty',
);

// --- Coverage -----------------------------------------------------------------

test('every ? legend row is characterised, and only legend rows are', t => {
	for (const keybind of LEGEND_KEYS) {
		t.truthy(
			coverage.get(keybind)?.length,
			`legend row "${keybind}" has no characterisation test`,
		);
	}
	for (const keybind of coverage.keys()) {
		t.true(
			LEGEND_KEYS.has(keybind),
			`"${keybind}" is characterised but is not a legend row`,
		);
	}
});

test('every cited characterisation test still exists under that title', t => {
	const sources = new Map<string, string>();
	for (const {file, title} of elsewhere) {
		if (!sources.has(file)) {
			sources.set(
				file,
				readFileSync(new URL(`./${file}`, import.meta.url), 'utf8'),
			);
		}
		t.true(
			sources.get(file)!.includes(`'${title}'`),
			`${file} no longer has a test titled "${title}"`,
		);
	}
});
