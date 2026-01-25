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
		isModelSelectionMode: false,
		isProviderSelectionMode: false,
		isModelDatabaseMode: false,
		isConfigWizardMode: false,
		isMcpWizardMode: false,
		isCheckpointLoadMode: false,
		isSettingsMode: false,
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
		onSettingsCancel: () => {},
		...overrides,
	};
}

test('ModalSelectors returns null when no mode is active', t => {
	const props = createDefaultProps();
	const result = ModalSelectors(props);
	t.is(result, null);
});

test('ModalSelectors renders ModelSelector when isModelSelectionMode is true', t => {
	const props = createDefaultProps({
		isModelSelectionMode: true,
		client: {}, // Mock client
	});
	const component = ModalSelectors(props);
	t.truthy(component);

	const {lastFrame, unmount} = renderWithTheme(<>{component}</>);
	const output = lastFrame();
	t.truthy(output);
	unmount();
});

test('ModalSelectors renders ProviderSelector when isProviderSelectionMode is true', t => {
	const props = createDefaultProps({isProviderSelectionMode: true});
	const component = ModalSelectors(props);
	t.truthy(component);

	const {lastFrame, unmount} = renderWithTheme(<>{component}</>);
	const output = lastFrame();
	t.truthy(output);
	unmount();
});

test('ModalSelectors renders ModelDatabaseDisplay when isModelDatabaseMode is true', t => {
	const props = createDefaultProps({isModelDatabaseMode: true});
	const component = ModalSelectors(props);
	t.truthy(component);

	const {lastFrame, unmount} = renderWithTheme(<>{component}</>);
	const output = lastFrame();
	t.truthy(output);
	unmount();
});

test('ModalSelectors renders ConfigWizard when isConfigWizardMode is true', t => {
	const props = createDefaultProps({isConfigWizardMode: true});
	const component = ModalSelectors(props);
	t.truthy(component);

	const {lastFrame, unmount} = renderWithTheme(<>{component}</>);
	const output = lastFrame();
	t.truthy(output);
	unmount();
});

test('ModalSelectors renders McpWizard when isMcpWizardMode is true', t => {
	const props = createDefaultProps({isMcpWizardMode: true});
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

test('ModalSelectors renders CheckpointSelector when isCheckpointLoadMode is true and data exists', t => {
	const props = createDefaultProps({
		isCheckpointLoadMode: true,
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

test('ModalSelectors returns null when isCheckpointLoadMode is true but data is null', t => {
	const props = createDefaultProps({
		isCheckpointLoadMode: true,
		checkpointLoadData: null,
	});
	const result = ModalSelectors(props);
	t.is(result, null);
});

test('ModalSelectors prioritizes first active mode when multiple are true', t => {
	const props = createDefaultProps({
		isModelSelectionMode: true,
		isProviderSelectionMode: true,
		isModelDatabaseMode: true,
		client: {}, // Mock client for ModelSelector
	});
	const component = ModalSelectors(props);
	t.truthy(component);

	const {lastFrame, unmount} = renderWithTheme(<>{component}</>);
	const output = lastFrame();
	t.truthy(output);
	unmount();
});
