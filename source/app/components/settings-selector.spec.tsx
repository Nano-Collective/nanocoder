import test from 'ava';
import React from 'react';
import {renderWithTheme} from '../../test-utils/render-with-theme';
import {SettingsSelector} from './settings-selector';

test('SettingsSelector renders without crashing', t => {
	const {unmount} = renderWithTheme(<SettingsSelector onCancel={() => {}} />);
	t.truthy(true);
	unmount();
});

test('SettingsSelector top-level menu shows "Settings" title', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	const output = lastFrame();
	t.truthy(output);
	t.truthy(output!.includes('Settings'));
	unmount();
});

test('SettingsSelector top-level menu shows category labels', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	const output = lastFrame();
	t.truthy(output);
	// Check that key categories appear
	t.truthy(output!.includes('Appearance'));
	t.truthy(output!.includes('Input'));
	t.truthy(output!.includes('Behavior'));
	t.truthy(output!.includes('Providers'));
	t.truthy(output!.includes('MCPs'));
	t.truthy(output!.includes('Web Search'));
	t.truthy(output!.includes('Environment'));
	t.truthy(output!.includes('Advanced'));
	unmount();
});

test('SettingsSelector top-level menu shows navigation hints', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	const output = lastFrame();
	t.truthy(output);
	// Check for Enter/Esc hints
	t.truthy(output!.includes('Enter') || output!.includes('Esc'));
	unmount();
});

test('SettingsSelector main menu shows Behavior category', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	const output = lastFrame();
	t.truthy(output);
	t.truthy(output!.includes('Behavior'));
	unmount();
});
