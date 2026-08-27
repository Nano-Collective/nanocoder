import {existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {Box, Text} from 'ink';
import React from 'react';
// CRITICAL: redirect config reads to a temp dir BEFORE any @/config import.
// BaseConfigWizard calls getColors() -> loadPreferences() directly (not
// through ThemeContext), which otherwise reads this machine's real global
// preferences file. A fork-only `selectedTheme` value there (not present in
// upstream's themes.json) makes getThemeColors() throw, crashing every test
// in this file before it can render anything.
process.env.NANOCODER_CONFIG_DIR = mkdtempSync(
	join(tmpdir(), 'nanocoder-wizard-spec-'),
);
const {resetPreferencesCache} = await import('@/config/preferences');
resetPreferencesCache();

import {renderWithTheme} from '../test-utils/render-with-theme.js';
import {BaseConfigWizard} from './base-config-wizard.js';

console.log(`\nbase-config-wizard.spec.tsx – ${React.version}`);

interface FakeItems {
	entries: string[];
}

const noopRenderConfigure = () => <Text>configure step</Text>;
const noopRenderSummary = (items: FakeItems) => (
	<Box flexDirection="column">
		<Text>items: {items.entries.length}</Text>
	</Box>
);

test('renders the supplied title in the box header', t => {
	const {lastFrame} = renderWithTheme(
		<BaseConfigWizard<FakeItems>
			title="Custom Wizard Title"
			focusId="custom-wizard"
			configFileName=".custom.json"
			initialItems={{entries: []}}
			parseConfig={() => ({entries: []})}
			buildConfig={items => items}
			hasItems={items => items.entries.length > 0}
			renderConfigureStep={noopRenderConfigure}
			renderSummaryItems={noopRenderSummary}
			projectDir="/tmp/example"
			onComplete={() => {}}
		/>,
	);

	t.regex(lastFrame()!, /Custom Wizard Title/);
});

test('renders the location step on first mount', t => {
	const {lastFrame} = renderWithTheme(
		<BaseConfigWizard<FakeItems>
			title="Title"
			focusId="loc-wizard"
			configFileName=".x.json"
			initialItems={{entries: []}}
			parseConfig={() => ({entries: []})}
			buildConfig={items => items}
			hasItems={items => items.entries.length > 0}
			renderConfigureStep={noopRenderConfigure}
			renderSummaryItems={noopRenderSummary}
			projectDir="/tmp/example"
			onComplete={() => {}}
		/>,
	);

	const output = lastFrame()!;
	t.regex(output, /Where would you like to create your configuration/);
	t.regex(output, /Current project directory/);
	t.regex(output, /Global user config/);
});

test('shows the standard footer hints in the wizard frame', t => {
	const {lastFrame} = renderWithTheme(
		<BaseConfigWizard<FakeItems>
			title="Title"
			focusId="footer-wizard"
			configFileName=".x.json"
			initialItems={{entries: []}}
			parseConfig={() => ({entries: []})}
			buildConfig={items => items}
			hasItems={items => items.entries.length > 0}
			renderConfigureStep={noopRenderConfigure}
			renderSummaryItems={noopRenderSummary}
			projectDir="/tmp/example"
			onComplete={() => {}}
		/>,
	);

	const output = lastFrame()!;
	t.regex(output, /Esc.*Exit wizard/);
	t.regex(output, /Shift\+Tab.*Go back/);
});

test('does not invoke onComplete or onCancel during initial render', t => {
	let completeCalled = false;
	let cancelCalled = false;

	renderWithTheme(
		<BaseConfigWizard<FakeItems>
			title="Title"
			focusId="cb-wizard"
			configFileName=".x.json"
			initialItems={{entries: []}}
			parseConfig={() => ({entries: []})}
			buildConfig={items => items}
			hasItems={items => items.entries.length > 0}
			renderConfigureStep={noopRenderConfigure}
			renderSummaryItems={noopRenderSummary}
			projectDir="/tmp/example"
			onComplete={() => {
				completeCalled = true;
			}}
			onCancel={() => {
				cancelCalled = true;
			}}
		/>,
	);

	t.false(completeCalled);
	t.false(cancelCalled);
});

test('handles missing onCancel without throwing', t => {
	t.notThrows(() => {
		renderWithTheme(
			<BaseConfigWizard<FakeItems>
				title="Title"
				focusId="no-cancel-wizard"
				configFileName=".x.json"
				initialItems={{entries: []}}
				parseConfig={() => ({entries: []})}
				buildConfig={items => items}
				hasItems={items => items.entries.length > 0}
				renderConfigureStep={noopRenderConfigure}
				renderSummaryItems={noopRenderSummary}
				projectDir="/tmp/example"
				onComplete={() => {}}
			/>,
		);
	});
});

test('renders consistently across multiple mounts with the same props', t => {
	const props = {
		title: 'Repeatable',
		focusId: 'rep-wizard',
		configFileName: '.x.json',
		initialItems: {entries: []},
		parseConfig: () => ({entries: []}),
		buildConfig: (items: FakeItems) => items,
		hasItems: (items: FakeItems) => items.entries.length > 0,
		renderConfigureStep: noopRenderConfigure,
		renderSummaryItems: noopRenderSummary,
		projectDir: '/tmp/example',
		onComplete: () => {},
	};

	const a = renderWithTheme(<BaseConfigWizard<FakeItems> {...props} />);
	const b = renderWithTheme(<BaseConfigWizard<FakeItems> {...props} />);

	t.is(a.lastFrame(), b.lastFrame());
});

test.serial('displays an error when the configuration file contains invalid JSON', async t => {
	const testDir = join(tmpdir(), `nanocoder-wizard-test-corrupt-${Date.now()}`);
	mkdirSync(testDir, {recursive: true});
	t.teardown(() => rmSync(testDir, {recursive: true, force: true}));

	const configFileName = '.bad.json';
	const configPath = join(testDir, configFileName);
	writeFileSync(configPath, '{ this is bad json }', 'utf-8');

	const {lastFrame, stdin} = renderWithTheme(
		<BaseConfigWizard<FakeItems>
			title="Title"
			focusId="corrupt-wizard"
			configFileName={configFileName}
			initialItems={{entries: []}}
			parseConfig={() => {
				throw new Error('Parse error');
			}}
			buildConfig={items => items}
			hasItems={items => items.entries.length > 0}
			renderConfigureStep={noopRenderConfigure}
			renderSummaryItems={noopRenderSummary}
			projectDir={testDir}
			onComplete={() => {}}
		/>,
	);

	// It will default to "existing config" since the file exists
	// We send "Enter" to select "Edit this configuration"
	stdin.write('\r');

	// Wait for the async useEffect file read
	await new Promise(r => setTimeout(r, 100));

	const output = lastFrame()!;
	t.regex(output, /Configuration file has invalid JSON and cannot be loaded/);
});

test.serial('blocks saving corrupted config', async t => {
	const testDir = join(tmpdir(), `nanocoder-wizard-test-save-${Date.now()}`);
	mkdirSync(testDir, {recursive: true});
	t.teardown(() => rmSync(testDir, {recursive: true, force: true}));

	const configFileName = '.bad-save.json';
	const configPath = join(testDir, configFileName);
	writeFileSync(configPath, '{ invalid }', 'utf-8');

	const {lastFrame, stdin} = renderWithTheme(
		<BaseConfigWizard<FakeItems>
			title="Title"
			focusId="corrupt-save-wizard"
			configFileName={configFileName}
			initialItems={{entries: []}}
			parseConfig={() => {
				throw new Error('Parse error');
			}}
			buildConfig={items => items}
			hasItems={items => items.entries.length > 0}
			renderConfigureStep={({onComplete}) => {
				setTimeout(() => onComplete({entries: [{name: 'new'}]}), 10);
				return <></>;
			}}
			renderSummaryItems={noopRenderSummary}
			projectDir={testDir}
			onComplete={() => {}}
		/>,
	);

	stdin.write('\r');
	await new Promise(r => setTimeout(r, 100));

	stdin.write('\r');
	await new Promise(r => setTimeout(r, 50));

	const output = lastFrame()!;
	t.regex(output, /Cannot save: the existing configuration file contains invalid/);
});

test.serial('deleting corrupted config clears corruption state', async t => {
	const testDir = join(tmpdir(), `nanocoder-wizard-test-del-${Date.now()}`);
	mkdirSync(testDir, {recursive: true});
	t.teardown(() => rmSync(testDir, {recursive: true, force: true}));

	const configFileName = '.bad-del.json';
	const configPath = join(testDir, configFileName);
	writeFileSync(configPath, '{ invalid }', 'utf-8');
	let completedPath = '';

	const {lastFrame, stdin} = renderWithTheme(
		<BaseConfigWizard<FakeItems>
			title="Title"
			focusId="corrupt-del-wizard"
			configFileName={configFileName}
			initialItems={{entries: []}}
			parseConfig={() => {
				throw new Error('Parse error');
			}}
			buildConfig={items => items}
			hasItems={items => items.entries.length > 0}
			renderConfigureStep={({onDelete}) => {
				setTimeout(() => onDelete?.(), 10);
				return <></>;
			}}
			renderSummaryItems={noopRenderSummary}
			projectDir={testDir}
			onComplete={(path) => { completedPath = path; }}
		/>,
	);

	stdin.write('\r');
	await new Promise(r => setTimeout(r, 100));

	stdin.write('\r');
	await new Promise(r => setTimeout(r, 50));

	t.false(existsSync(configPath));
	t.is(completedPath, configPath);
});

test.serial(
	'configure step receives pre-existing config entries synchronously on entering configure (regression: deferred load lost entries)',
	async t => {
		const testDir = join(
			tmpdir(),
			`nanocoder-wizard-test-preload-${Date.now()}`,
		);
		mkdirSync(testDir, {recursive: true});
		t.teardown(() => rmSync(testDir, {recursive: true, force: true}));

		const configFileName = 'agents.config.json';
		const configPath = join(testDir, configFileName);
		writeFileSync(
			configPath,
			JSON.stringify({
				providers: [{name: 'openai'}, {name: 'anthropic'}],
			}),
			'utf-8',
		);

		// Records the `items` the configure step actually received the moment
		// it first renders. Before the fix (deferred useEffect load, firing
		// after `setStep('configure')` had already committed), this step's
		// own useState initializer would capture the wizard's still-empty
		// `initialItems` — a real config-file with entries would render here
		// as if it were empty, silently discarding the user's existing
		// providers on next save.
		const receivedOnFirstRender: string[][] = [];

		// A real component (not a function called inline by BaseConfigWizard's
		// switch statement) so its `useState` initializer runs as ITS OWN
		// hook, exactly matching how the real configure steps this bug
		// affected are structured — a plain function reference invoked
		// directly would attach the hook to BaseConfigWizard itself instead.
		function ConfigureCapture({items}: {items: FakeItems}) {
			const [captured] = React.useState(items.entries);
			receivedOnFirstRender.push(captured);
			return (
				<Box flexDirection="column">
					<Text>configure step</Text>
					<Text>entries: {captured.join(',')}</Text>
				</Box>
			);
		}

		const {lastFrame, stdin} = renderWithTheme(
			<BaseConfigWizard<FakeItems>
				title="Title"
				focusId="preload-wizard"
				configFileName={configFileName}
				initialItems={{entries: []}}
				parseConfig={raw => ({
					entries: (raw as {providers: {name: string}[]}).providers.map(
						p => p.name,
					),
				})}
				buildConfig={items => ({
					providers: items.entries.map(name => ({name})),
				})}
				hasItems={items => items.entries.length > 0}
				renderConfigureStep={({items}) => <ConfigureCapture items={items} />}
				renderSummaryItems={noopRenderSummary}
				projectDir={testDir}
				onComplete={() => {}}
			/>,
		);

		// Project config exists, so the location step opens in
		// "existing-config" mode; the first (default-selected) option is
		// "Edit this configuration" — select it with Enter.
		stdin.write('\r');
		await new Promise(r => setTimeout(r, 100));

		t.true(receivedOnFirstRender.length >= 1);
		// The captured value comes from a useState initializer, so every
		// render (even re-renders after the initial mount) must report the
		// same first-mount snapshot. Before the fix, this would be `[]`.
		for (const captured of receivedOnFirstRender) {
			t.deepEqual(captured, ['openai', 'anthropic']);
		}

		const output = lastFrame()!;
		t.regex(output, /entries: openai,anthropic/);
	},
);


