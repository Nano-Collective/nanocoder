import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import React from 'react';
// CRITICAL: redirect preference reads to a temp dir BEFORE settings-tabs (and
// its @/config/preferences import chain) loads. SettingsSelector now reads
// preferences at mount to populate the Settings tab's row values.
process.env.NANOCODER_CONFIG_DIR = mkdtempSync(
	join(tmpdir(), 'nanocoder-spec-'),
);
const {resetPreferencesCache} = await import('@/config/preferences');
resetPreferencesCache();

const {renderWithTheme} = await import('../../test-utils/render-with-theme');
const {SettingsSelector} = await import('./settings-tabs');

test('SettingsSelector renders without crashing', t => {
	const {unmount} = renderWithTheme(<SettingsSelector onCancel={() => {}} />);
	t.truthy(true);
	unmount();
});

test('SettingsSelector shows the tab bar with Appearance tab', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	const output = lastFrame();
	t.truthy(output);
	t.truthy(output!.includes('Appearance'));
	unmount();
});

test('SettingsSelector shows Theme option', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	const output = lastFrame();
	t.truthy(output);
	t.truthy(output!.includes('Theme'));
	unmount();
});

test('SettingsSelector shows navigation hints', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	const output = lastFrame();
	t.truthy(output);
	// Check for Enter/Esc hints
	t.truthy(output!.includes('Enter') || output!.includes('Esc'));
	unmount();
});

test('SettingsSelector shows Tool Results and Thinking option on the Display tab', async t => {
	const {lastFrame, stdin, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	const tick = () => new Promise(resolve => setTimeout(resolve, 30));
	await tick();
	// Appearance -> Input -> Display.
	stdin.write('[C');
	await tick();
	stdin.write('[C');
	await tick();
	const output = lastFrame();
	t.truthy(output);
	t.truthy(output!.includes('Tool Results and Thinking'));
	unmount();
});
