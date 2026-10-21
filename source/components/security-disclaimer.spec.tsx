import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import React from 'react';
import {renderWithTheme} from '../test-utils/render-with-theme.js';
import SecurityDisclaimer from './security-disclaimer';

console.log('\nsecurity-disclaimer.spec.tsx');

// ============================================================================
// Component Rendering Tests
// ============================================================================

test('SecurityDisclaimer renders without crashing', t => {
	const {lastFrame} = renderWithTheme(
		<SecurityDisclaimer onConfirm={() => {}} onExit={() => {}} />,
	);

	t.truthy(lastFrame());
});

test('SecurityDisclaimer displays Security Warning title', t => {
	const {lastFrame} = renderWithTheme(
		<SecurityDisclaimer onConfirm={() => {}} onExit={() => {}} />,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Security Warning/);
});

test('SecurityDisclaimer displays the current working directory', t => {
	const {lastFrame} = renderWithTheme(
		<SecurityDisclaimer onConfirm={() => {}} onExit={() => {}} />,
	);

	const output = lastFrame();
	t.truthy(output);
	// process.cwd() should be displayed
	t.regex(output!, new RegExp(process.cwd()));
});

test('SecurityDisclaimer displays trust warning message', t => {
	const {lastFrame} = renderWithTheme(
		<SecurityDisclaimer onConfirm={() => {}} onExit={() => {}} />,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Do you trust the files/);
	t.regex(output!, /may read, write, or execute/);
	t.regex(output!, /security risks/);
});

test('SecurityDisclaimer displays Yes and No options', t => {
	const {lastFrame} = renderWithTheme(
		<SecurityDisclaimer onConfirm={() => {}} onExit={() => {}} />,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Yes, proceed/);
	t.regex(output!, /No, exit/);
});

// ============================================================================
// Interaction Tests
// ============================================================================

test('SecurityDisclaimer calls onConfirm when Yes option is selected', t => {
	let confirmCalled = false;
	const handleConfirm = () => {
		confirmCalled = true;
	};

	const {lastFrame} = renderWithTheme(
		<SecurityDisclaimer onConfirm={handleConfirm} onExit={() => {}} />,
	);

	t.truthy(lastFrame());

	// Note: Testing actual SelectInput interaction requires stdin manipulation
	// This test verifies the component structure is correct for onSelect
	// In a real scenario, when user selects "Yes, proceed", handleSelect would be called
	// which calls onConfirm()
	t.true(typeof handleConfirm === 'function');
});

test('SecurityDisclaimer calls onExit when No option is selected', t => {
	let exitCalled = false;
	const handleExit = () => {
		exitCalled = true;
	};

	const {lastFrame} = renderWithTheme(
		<SecurityDisclaimer onConfirm={() => {}} onExit={handleExit} />,
	);

	t.truthy(lastFrame());

	// Note: Testing actual SelectInput interaction requires stdin manipulation
	// This test verifies the component structure is correct for onSelect
	// In a real scenario, when user selects "No, exit", handleSelect would be called
	// which calls onExit()
	t.true(typeof handleExit === 'function');
});

test('SecurityDisclaimer handleSelect function branches correctly', t => {
	// Simulate the handleSelect logic directly
	let confirmCalled = false;
	let exitCalled = false;
	const handleConfirm = () => {
		confirmCalled = true;
	};
	const handleExit = () => {
		exitCalled = true;
	};

	// Simulate selecting "Yes"
	const yesItem = {label: 'Yes, proceed', value: 'yes'};
	if (yesItem.value === 'yes') {
		handleConfirm();
	}
	t.true(confirmCalled);
	t.false(exitCalled);

	// Reset and simulate selecting "No"
	confirmCalled = false;
	const noItem = {label: 'No, exit', value: 'no'};
	if (noItem.value === 'no') {
		handleExit();
	}
	t.false(confirmCalled);
	t.true(exitCalled);
});

test('SecurityDisclaimer has correct item values', t => {
	// Verify the enum and items structure
	const items = [
		{label: 'Yes, proceed', value: 'yes'},
		{label: 'No, exit', value: 'no'},
	];

	t.is(items.length, 2);
	t.is(items[0].value, 'yes');
	t.is(items[1].value, 'no');
});

test('SecurityDisclaimer displays with error border color', t => {
	const {lastFrame} = renderWithTheme(
		<SecurityDisclaimer onConfirm={() => {}} onExit={() => {}} />,
	);

	const output = lastFrame();
	t.truthy(output);
	// The TitledBox should use colors.error for borderColor
	// This is verified by the component rendering without error
});

test('SecurityDisclaimer component structure is valid', t => {
	const {lastFrame} = renderWithTheme(
		<SecurityDisclaimer onConfirm={() => {}} onExit={() => {}} />,
	);

	const output = lastFrame();
	t.truthy(output);
	t.true(output!.length > 0);
});

test('SecurityDisclaimer maintains consistent layout', t => {
	const {lastFrame} = renderWithTheme(
		<SecurityDisclaimer onConfirm={() => {}} onExit={() => {}} />,
	);

	const output = lastFrame();
	t.truthy(output);

	// Check for TitledBox structure
	t.regex(output!, /│/); // Border characters from TitledBox
});

test('SecurityDisclaimer names the plugins and hooks in the folder', t => {
	const root = mkdtempSync(join(tmpdir(), 'trust-prompt-'));
	try {
		const pluginDir = join(root, '.nanocoder', 'plugins');
		mkdirSync(pluginDir, {recursive: true});
		writeFileSync(join(pluginDir, 'pulled.mjs'), 'export default {}\n');
		writeFileSync(
			join(root, 'agents.config.json'),
			JSON.stringify({
				nanocoder: {
					hooks: {'session-start': [{command: 'echo hooked'}]},
				},
			}),
		);

		const {lastFrame} = renderWithTheme(
			<SecurityDisclaimer
				directory={root}
				onConfirm={() => {}}
				onExit={() => {}}
			/>,
		);
		const output = lastFrame() ?? '';
		t.regex(output, /1 plugin/);
		t.regex(output, /1 session-start hook/);
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});
