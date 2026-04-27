import test from 'ava';
import React from 'react';
import {renderWithTheme} from '../../test-utils/render-with-theme';
import {SettingsSelector} from './settings-selector';

test('SettingsSelector renders without crashing', t => {
	const {unmount} = renderWithTheme(<SettingsSelector onCancel={() => {}} />);
	t.truthy(true);
	unmount();
});

test('SettingsSelector main menu shows settings options', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	const output = lastFrame();
	t.truthy(output);
	t.truthy(output!.includes('Settings'));
	unmount();
});

test('SettingsSelector main menu shows Theme option', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	const output = lastFrame();
	t.truthy(output);
	t.truthy(output!.includes('Theme'));
	unmount();
});

test('SettingsSelector main menu shows navigation hints', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	const output = lastFrame();
	t.truthy(output);
	// Check for Enter/Esc hints
	t.truthy(output!.includes('Enter') || output!.includes('Esc'));
	unmount();
});
