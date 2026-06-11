import {existsSync, mkdirSync, unlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'ava';
import {Box, Text} from 'ink';
import React from 'react';
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
	const configFileName = `.bad-${Date.now()}.json`;
	const configPath = join(process.cwd(), configFileName);
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
			projectDir={process.cwd()}
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

	try {
		unlinkSync(configPath);
	} catch {}
});

test.serial('blocks saving corrupted config', async t => {
	const configFileName = `.bad-save-${Date.now()}.json`;
	const configPath = join(process.cwd(), configFileName);
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
			projectDir={process.cwd()}
			onComplete={() => {}}
		/>,
	);

	stdin.write('\r');
	await new Promise(r => setTimeout(r, 100));

	stdin.write('\r');
	await new Promise(r => setTimeout(r, 50));

	const output = lastFrame()!;
	t.regex(output, /Cannot save: the existing configuration file contains invalid/);
	
	try {
		unlinkSync(configPath);
	} catch {}
});

test.serial('deleting corrupted config clears corruption state', async t => {
	const configFileName = `.bad-del-${Date.now()}.json`;
	const configPath = join(process.cwd(), configFileName);
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
			projectDir={process.cwd()}
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


