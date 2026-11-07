import {readFileSync} from 'node:fs';
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
		currentModel: 'test-model',
		currentProvider: 'test-provider',
		checkpointLoadData: null,
		onModelSelect: async () => {},
		onModelSelectionCancel: () => {},
		onModelDatabaseCancel: () => {},
		onConfigWizardComplete: async () => {},
		onConfigWizardCancel: () => {},
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
	});
	const component = ModalSelectors(props);
	t.truthy(component);

	const {lastFrame, unmount} = renderWithTheme(<>{component}</>);
	const output = lastFrame();
	t.truthy(output);
	unmount();
});

// Regression for #1775: ModalSelectors is on the startup path
// (App -> interactive-app -> modal-selectors), so a static import of the model
// database command would drag its model fetcher and clipboard chain into every
// session. It must stay a dynamic import.
test('modal-selectors: model-database is imported lazily, not at module load', t => {
	const source = readFileSync(
		new URL('./modal-selectors.tsx', import.meta.url),
		'utf8',
	);

	t.false(
		/^\s*import\s.*from\s+['"]@\/commands\/model-database['"]/m.test(source),
		'@/commands/model-database must not be statically imported (see #1775)',
	);
	t.regex(source, /import\(\s*['"]@\/commands\/model-database['"]\s*\)/);
});

/**
 * Ink flushes renders on a throttle and the lazy modal only mounts once its
 * dynamic import resolves, so poll for the first painted frame instead of
 * guessing a fixed delay.
 */
async function waitForFrame(
	lastFrame: () => string | undefined,
	timeoutMs = 2000,
): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	let frame = lastFrame() ?? '';
	while (frame.length === 0 && Date.now() < deadline) {
		await new Promise(resolve => setTimeout(resolve, 50));
		frame = lastFrame() ?? '';
	}
	return frame;
}

test('ModalSelectors renders ModelDatabaseDisplay when activeMode is modelDatabase', async t => {
	const props = createDefaultProps({activeMode: 'modelDatabase'});
	const component = ModalSelectors(props);
	t.truthy(component);

	const originalFetch = globalThis.fetch;
	// Keep the display in its loading state: the modal itself is lazy (see
	// #1775), and this test only needs to prove it mounted — not that models
	// load.
	globalThis.fetch = (() => new Promise<Response>(() => {})) as typeof fetch;

	try {
		const {lastFrame, unmount} = renderWithTheme(<>{component}</>);

		const output = await waitForFrame(lastFrame);
		t.truthy(output);
		t.regex(output, /model-database|Model Browser/i);
		unmount();
	} finally {
		globalThis.fetch = originalFetch;
	}
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
