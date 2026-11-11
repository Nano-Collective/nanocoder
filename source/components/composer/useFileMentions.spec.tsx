import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {UIStateProvider, useUIStateContext} from '../../hooks/useUIState';
import {setToolManagerGetter} from '../../message-handler';
import type {ToolManager} from '../../tools/tool-manager';
import type {InputState} from '../../types/hooks';
import {clearFileListCache} from '../../utils/file-autocomplete';
import {decodeMCPResourcePath, useFileMentions} from './useFileMentions.js';

type Mentions = ReturnType<typeof useFileMentions>;
type UIState = ReturnType<typeof useUIStateContext>;

const state = (displayValue: string): InputState => ({
	displayValue,
	placeholderContent: {},
});

const wait = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms));
async function until(condition: () => boolean, timeoutMs = 3000) {
	const start = Date.now();
	while (!condition()) {
		if (Date.now() - start > timeoutMs) throw new Error('timed out');
		await wait();
	}
}

function Probe({
	input,
	setInputState,
	onInputReplaced,
	capture,
}: {
	input: string;
	setInputState: (s: InputState) => void;
	onInputReplaced: () => void;
	capture: (m: Mentions, ui: UIState) => void;
}) {
	const mentions = useFileMentions({
		input,
		currentState: state(input),
		setInputState,
		onInputReplaced,
	});
	capture(mentions, useUIStateContext());
	return null;
}

/** A temp cwd holding `files`, with the file-list cache reset around it. */
function inTempDir(t: {teardown: (fn: () => void) => void}, files: string[]) {
	const dir = mkdtempSync(join(tmpdir(), 'mentions-'));
	for (const file of files) writeFileSync(join(dir, file), 'content');
	const cwd = process.cwd();
	process.chdir(dir);
	clearFileListCache();
	t.teardown(() => {
		process.chdir(cwd);
		clearFileListCache();
		rmSync(dir, {recursive: true, force: true});
	});
}

function setup(initialInput: string) {
	const replaced: InputState[] = [];
	let remounts = 0;
	let mentions!: Mentions;
	let ui!: UIState;
	const setInputState = (s: InputState) => {
		replaced.push(s);
	};
	const onInputReplaced = () => {
		remounts++;
	};
	const element = (input: string) => (
		<UIStateProvider>
			<Probe
				input={input}
				setInputState={setInputState}
				onInputReplaced={onInputReplaced}
				capture={(m, u) => {
					mentions = m;
					ui = u;
				}}
			/>
		</UIStateProvider>
	);
	const view = render(element(initialInput));
	return {
		replaced,
		get remounts() {
			return remounts;
		},
		get mentions() {
			return mentions;
		},
		get ui() {
			return ui;
		},
		setInput: (input: string) => view.rerender(element(input)),
		unmount: view.unmount,
	};
}

test('decodeMCPResourcePath splits the server off a URI that has colons', t => {
	t.deepEqual(decodeMCPResourcePath('mcp-resource:docs:file:///a/b.md'), {
		serverName: 'docs',
		uri: 'file:///a/b.md',
	});
	t.is(decodeMCPResourcePath('src/app.ts'), null);
	t.is(decodeMCPResourcePath('mcp-resource:no-separator'), null);
});

test.serial('lists files for the mention under the caret, and closes without one', async t => {
	inTempDir(t, ['zzalpha.txt', 'zzbeta.txt']);
	const s = setup('look at @zz');
	t.teardown(s.unmount);

	await until(() => s.mentions.completions.length === 2);
	t.true(s.mentions.isActive);
	t.is(s.mentions.selectedIndex, 0);

	s.setInput('no mention here');
	await until(() => !s.mentions.isActive);
	t.deepEqual(s.mentions.completions, []);
});

test.serial('moveSelection wraps at both ends and is a no-op without a list', async t => {
	inTempDir(t, ['zz1.txt', 'zz2.txt', 'zz3.txt']);
	const s = setup('@zz');
	t.teardown(s.unmount);
	await until(() => s.mentions.completions.length === 3);

	t.true(s.mentions.moveSelection('up'));
	await wait();
	t.is(s.mentions.selectedIndex, 2);
	t.true(s.mentions.moveSelection('down'));
	await wait();
	t.is(s.mentions.selectedIndex, 0);

	s.mentions.dismiss();
	await wait();
	t.false(s.mentions.isActive);
	t.false(s.mentions.moveSelection('down'));
});

test.serial('selectCurrent attaches the highlighted file and closes the list', async t => {
	inTempDir(t, ['zzpick.txt']);
	const s = setup('read @zzpi');
	t.teardown(s.unmount);
	await until(() => s.mentions.completions.length === 1);

	t.true(await s.mentions.selectCurrent());
	await wait();
	t.is(s.replaced.length, 1);
	t.regex(s.replaced[0]!.displayValue, /^read \[@zzpick\.txt\]/);
	t.is(s.remounts, 1);
	t.false(s.mentions.isActive);
});

test.serial('selectCurrent does nothing while the list is closed', async t => {
	const s = setup('plain text');
	t.teardown(s.unmount);
	await wait(50);
	t.false(await s.mentions.selectCurrent());
	t.deepEqual(s.replaced, []);
});

test.serial('MCP resources join the list under their display name', async t => {
	inTempDir(t, []);
	setToolManagerGetter(
		() =>
			({
				getMCPClient: () => ({
					getAllResources: () => [
						{uri: 'file:///api.md', name: 'zzapi', serverName: 'docs'},
					],
				}),
			}) as unknown as ToolManager,
	);
	t.teardown(() => setToolManagerGetter(() => null));

	const s = setup('@zzapi');
	t.teardown(s.unmount);
	await until(() => s.mentions.completions.length === 1);

	const [entry] = s.mentions.completions;
	t.is(entry!.displayPath, 'zzapi (docs)');
	t.is(entry!.resourceName, 'zzapi');
	t.deepEqual(decodeMCPResourcePath(entry!.path), {
		serverName: 'docs',
		uri: 'file:///api.md',
	});
});

test.serial('files handed over by the explorer are attached and the handoff cleared', async t => {
	inTempDir(t, ['zzexplored.txt']);
	const s = setup('');
	t.teardown(s.unmount);
	await wait(50);

	s.ui.setPendingFileMentions(['zzexplored.txt']);
	await until(() => s.replaced.length > 0);
	t.regex(s.replaced[0]!.displayValue, /\[@zzexplored\.txt\]/);
	t.is(s.remounts, 1);
	await until(() => s.ui.pendingFileMentions.length === 0);
});
