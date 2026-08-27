import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import React from 'react';

// CRITICAL: redirect config reads to a temp dir BEFORE the component (and its
// @/config chain) loads, so the machine's real preferences can't leak in.
process.env.NANOCODER_CONFIG_DIR = mkdtempSync(
	join(tmpdir(), 'nanocoder-jsonviewer-'),
);

const {renderWithTheme} = await import('../../test-utils/render-with-theme');
const {JsonViewer} = await import('./json-viewer');

const DOWN = '[B';

function tick(ms = 60): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Every assertion here is a regression guard for a way the editor silently
 * corrupted the config file it was editing.
 */

test('typing a value containing w/q/? does not save, exit or open help', async t => {
	let saved: unknown;
	let cancelled = false;
	const {stdin, unmount} = renderWithTheme(
			<JsonViewer
				data={{model: 'x'}}
				onSave={value => {
					saved = value;
				}}
				onCancel={() => {
					cancelled = true;
				}}
		/>,
	);
	await tick();

	stdin.write(DOWN);
	await tick();
	stdin.write('e');
	await tick();

	// One character per chunk — that is how a real terminal delivers typing, and
	// it is the only way `input === 'w'` can match. These used to run as bare
	// shortcuts because the checks sat above the edit-mode guard.
	for (const char of 'qw?') {
		stdin.write(char);
		await tick();
	}

	t.is(saved, undefined, 'w must not write to disk mid-edit');
	t.false(cancelled, 'q must not exit the editor mid-edit');
	unmount();
});

test('a string edit commits the typed value intact', async t => {
	let latest: unknown;
	const {stdin, unmount} = renderWithTheme(
			<JsonViewer
				data={{model: 'x'}}
				onChange={value => {
					latest = value;
				}}
		/>,
	);
	await tick();

	stdin.write(DOWN);
	await tick();
	stdin.write('e');
	await tick();
	// One char per chunk, as a real terminal sends typing.
	for (const char of 'qwen3') {
		stdin.write(char);
		await tick();
	}
	stdin.write('\r');
	await tick();

	// The editor seeds the input with the current value, so typing appends to it.
	t.deepEqual(latest, {model: 'xqwen3'}, 'q and w must reach the text input');
	unmount();
});

test('a non-numeric number edit is rejected instead of retyping the value', async t => {
	let latest: unknown;
	const {stdin, lastFrame, unmount} = renderWithTheme(
			<JsonViewer
				data={{threshold: 42}}
				onChange={value => {
					latest = value;
				}}
		/>,
	);
	await tick();

	stdin.write(DOWN);
	await tick();
	stdin.write('e');
	await tick();
	stdin.write('abc');
	await tick();
	stdin.write('\r');
	await tick();

	// The old fallback wrote currentRow.value — the FORMATTED string — turning the
	// number 42 into the string "42".
	t.deepEqual(latest, {threshold: 42}, 'the number must survive a failed edit');
	t.regex(lastFrame() ?? '', /not a number/, 'the editor reports the error');
	unmount();
});

test('a collapsed container cannot be edited into a string', async t => {
	let latest: unknown;
	const data = {providers: {ollama: {url: 'http://localhost'}}};
	const {stdin, unmount} = renderWithTheme(
			<JsonViewer
				data={data}
				initialCollapsedDepth={1}
				onChange={value => {
					latest = value;
				}}
		/>,
	);
	await tick();

	// Cursor onto the collapsed "providers" row, then e + Enter — this used to
	// replace the whole subtree with the literal string "{ ... }".
	stdin.write(DOWN);
	await tick();
	stdin.write('e');
	await tick();
	stdin.write('\r');
	await tick();

	t.deepEqual(latest, data, 'the subtree must be untouched');
	unmount();
});

test('the status bar renders the shortcut hints without stray quotes', async t => {
	const {lastFrame, unmount} = renderWithTheme(<JsonViewer data={{a: 1}} />);
	await tick();

	const frame = lastFrame() ?? '';
	t.regex(frame, /\?:help/);
	t.regex(frame, /q:exit/);
	t.notRegex(frame, /' '/, 'raw JSX text leaked literal quotes into the bar');
	unmount();
});
