import test from 'ava';
import React from 'react';
import {renderWithTheme} from '../../test-utils/render-with-theme';
import {ModalSelectors} from './modal-selectors';
import type {ModalSelectorsProps} from './modal-selectors';

// Helper to create default props
function createDefaultProps(
	overrides: Partial<ModalSelectorsProps> = {},
): ModalSelectorsProps {
	return {
		activeMode: null,
		isSettingsMode: false,
		showAllSessions: false,
		client: null,
		currentModel: 'test-model',
		currentProvider: 'test-provider',
		checkpointLoadData: null,
		onModelSelect: async () => {},
		onModelSelectionCancel: () => {},
		onProviderSelect: async () => {},
		onProviderSelectionCancel: () => {},
		onModelDatabaseCancel: () => {},
		onConfigWizardComplete: async () => {},
		onConfigWizardCancel: () => {},
		onMcpWizardComplete: async () => {},
		onMcpWizardCancel: () => {},
		onCheckpointSelect: async () => {},
		onCheckpointCancel: () => {},
		onSessionSelect: () => {},
		onSessionCancel: () => {},
		onSettingsCancel: () => {},
		...overrides,
	};
}

test('ModalSelectors returns null when no mode is active', t => {
	const props = createDefaultProps();
	const result = ModalSelectors(props);
	t.is(result, null);
});

test('ModalSelectors renders ModelSelector when activeMode is model', t => {
	const props = createDefaultProps({
		activeMode: 'model',
		client: {},
	});
	const component = ModalSelectors(props);
	t.truthy(component);

	const {lastFrame, unmount} = renderWithTheme(<>{component}</>);
	const output = lastFrame();
	t.truthy(output);
	unmount();
});

test('ModalSelectors renders ProviderSelector when activeMode is provider', t => {
	const props = createDefaultProps({activeMode: 'provider'});
	const component = ModalSelectors(props);
	t.truthy(component);

	const {lastFrame, unmount} = renderWithTheme(<>{component}</>);
	const output = lastFrame();
	t.truthy(output);
	unmount();
});

test('ModalSelectors renders ModelDatabaseDisplay when activeMode is modelDatabase', t => {
	const props = createDefaultProps({activeMode: 'modelDatabase'});
	const component = ModalSelectors(props);
	t.truthy(component);

	const {lastFrame, unmount} = renderWithTheme(<>{component}</>);
	const output = lastFrame();
	t.truthy(output);
	unmount();
});

test('ModalSelectors renders ConfigWizard when activeMode is configWizard', t => {
	const props = createDefaultProps({activeMode: 'configWizard'});
	const component = ModalSelectors(props);
	t.truthy(component);

	const {lastFrame, unmount} = renderWithTheme(<>{component}</>);
	const output = lastFrame();
	t.truthy(output);
	unmount();
});

test('ModalSelectors renders McpWizard when activeMode is mcpWizard', t => {
	const props = createDefaultProps({activeMode: 'mcpWizard'});
	const component = ModalSelectors(props);
	t.truthy(component);

	const {lastFrame, unmount} = renderWithTheme(<>{component}</>);
	const output = lastFrame();
	t.truthy(output);
	unmount();
});

test('ModalSelectors renders SettingsSelector when isSettingsMode is true', t => {
	const props = createDefaultProps({isSettingsMode: true});
	const component = ModalSelectors(props);
	t.truthy(component);

	const {lastFrame, unmount} = renderWithTheme(<>{component}</>);
	const output = lastFrame();
	t.truthy(output);
	unmount();
});

test('ModalSelectors renders CheckpointSelector when activeMode is checkpointLoad and data exists', t => {
	const props = createDefaultProps({
		activeMode: 'checkpointLoad',
		checkpointLoadData: {
			checkpoints: [],
			currentMessageCount: 0,
		},
	});
	const component = ModalSelectors(props);
	t.truthy(component);

	const {lastFrame, unmount} = renderWithTheme(<>{component}</>);
	const output = lastFrame();
	t.truthy(output);
	unmount();
});

test('ModalSelectors returns null when activeMode is checkpointLoad but data is null', t => {
	const props = createDefaultProps({
		activeMode: 'checkpointLoad',
		checkpointLoadData: null,
	});
	const result = ModalSelectors(props);
	t.is(result, null);
});

test('ModalSelectors renders SessionSelector when activeMode is sessionSelector', t => {
	const props = createDefaultProps({activeMode: 'sessionSelector'});
	const component = ModalSelectors(props);
	t.truthy(component);

	const {lastFrame, unmount} = renderWithTheme(<>{component}</>);
	const output = lastFrame();
	t.truthy(output);
	unmount();
});
