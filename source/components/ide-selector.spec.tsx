import test from 'ava';
import React from 'react';
import {IdeSelector} from './ide-selector.js';
import {renderWithTheme} from '../test-utils/render-with-theme.js';

console.log('\nide-selector.spec.tsx');

test('ide-selector renders title', t => {
	const {lastFrame} = renderWithTheme(
		React.createElement(IdeSelector, {
			onSelect: () => {},
			onCancel: () => {},
		}),
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Connect to an IDE/);
});

test('ide-selector renders description text', t => {
	const {lastFrame} = renderWithTheme(
		React.createElement(IdeSelector, {
			onSelect: () => {},
			onCancel: () => {},
		}),
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Select an IDE to enable live integration/);
});

test('ide-selector renders VS Code option', t => {
	const {lastFrame} = renderWithTheme(
		React.createElement(IdeSelector, {
			onSelect: () => {},
			onCancel: () => {},
		}),
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /VS Code/);
});

test('ide-selector shows cancel instruction', t => {
	const {lastFrame} = renderWithTheme(
		React.createElement(IdeSelector, {
			onSelect: () => {},
			onCancel: () => {},
		}),
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Press Escape to cancel/);
});

test('ide-selector renders without crashing', t => {
	const {unmount} = renderWithTheme(
		React.createElement(IdeSelector, {
			onSelect: () => {},
			onCancel: () => {},
		}),
	);

	t.notThrows(() => unmount());
});

test('ide-selector calls onCancel when Escape is pressed', async t => {
	let cancelCalled = false;
	const onCancel = () => {
		cancelCalled = true;
	};

	const {stdin} = renderWithTheme(
		React.createElement(IdeSelector, {
			onSelect: () => {},
			onCancel,
		}),
	);

	// Press Escape key
	stdin.write('\u001B');

	await new Promise(resolve => setTimeout(resolve, 50));

	t.true(cancelCalled);
});

test('ide-selector calls onSelect with "vscode" when VS Code is selected', async t => {
	let selectedIde = '';
	const onSelect = (ide: string) => {
		selectedIde = ide;
	};

	const {stdin} = renderWithTheme(
		React.createElement(IdeSelector, {
			onSelect,
			onCancel: () => {},
		}),
	);

	// Press Enter to select the first (and only) item: VS Code
	stdin.write('\r');

	await new Promise(resolve => setTimeout(resolve, 50));

	t.is(selectedIde, 'vscode');
});
