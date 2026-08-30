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
const {SettingsDisplayPanel, SettingsNotificationsPanel} = await import(
	'./settings-selector'
);
const {updateShowUsageFooter, updateNotificationsPreference} = await import(
	'@/config/preferences'
);

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

test('SettingsDisplayPanel offers a Usage & Cost Footer toggle, ON by default', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<SettingsDisplayPanel onBack={() => {}} onCancel={() => {}} />,
	);
	const output = lastFrame();
	t.truthy(output);
	t.true(output!.includes('Usage & Cost Footer'));
	// Preference is unset in the temp config dir, so it defaults to on.
	t.true(output!.includes('Usage & Cost Footer: ON'));
	unmount();
});

test('SettingsDisplayPanel reflects a disabled Usage & Cost Footer preference', t => {
	updateShowUsageFooter(false);
	try {
		const {lastFrame, unmount} = renderWithTheme(
			<SettingsDisplayPanel onBack={() => {}} onCancel={() => {}} />,
		);
		const output = lastFrame();
		t.truthy(output);
		t.true(output!.includes('Usage & Cost Footer: OFF'));
		unmount();
	} finally {
		updateShowUsageFooter(true);
	}
});

test('SettingsNotificationsPanel offers a Terminal Bell toggle, OFF by default', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<SettingsNotificationsPanel onBack={() => {}} onCancel={() => {}} />,
	);
	const output = lastFrame();
	t.truthy(output);
	// No preference saved in the temp config dir, so the bell starts off.
	t.true(output!.includes('Terminal Bell: OFF'));
	unmount();
});

test('SettingsNotificationsPanel reflects an enabled bell preference', t => {
	updateNotificationsPreference({enabled: true, bell: true});
	try {
		const {lastFrame, unmount} = renderWithTheme(
			<SettingsNotificationsPanel onBack={() => {}} onCancel={() => {}} />,
		);
		const output = lastFrame();
		t.truthy(output);
		t.true(output!.includes('Terminal Bell: ON'));
		// The bell is an extra channel beside sound, not a replacement for it.
		t.true(output!.includes('Sound: OFF'));
		unmount();
	} finally {
		updateNotificationsPreference({enabled: false, bell: false});
	}
});

test('SettingsNotificationsPanel exposes every notification event', t => {
	updateNotificationsPreference({
		enabled: true,
		events: {
			toolConfirmation: true,
			questionPrompt: true,
			generationComplete: true,
			triggeredRunComplete: true,
		},
	});
	try {
		const {lastFrame, unmount} = renderWithTheme(
			<SettingsNotificationsPanel onBack={() => {}} onCancel={() => {}} />,
		);
		const output = lastFrame();
		t.truthy(output);
		// Every NotificationEvent needs a row: the panel writes its whole config
		// back on each toggle, so an event with no row is dropped from the saved
		// preference and its notification silently stops firing.
		t.true(output!.includes('Tool Confirmation: ON'));
		t.true(output!.includes('Question Prompt: ON'));
		t.true(output!.includes('Generation Complete: ON'));
		t.true(output!.includes('Triggered Run Complete: ON'));
		unmount();
	} finally {
		updateNotificationsPreference({enabled: false});
	}
});
