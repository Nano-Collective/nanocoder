import test from 'ava';
import React from 'react';
import {renderWithTheme} from '../../test-utils/render-with-theme';
import {createStaticComponents} from './app-container';
import type {AppContainerProps} from './app-container';

test('createStaticComponents includes welcome message when shouldShowWelcome is true', t => {
	const props: AppContainerProps = {
		shouldShowWelcome: true,
		currentProvider: 'test-provider',
		currentModel: 'test-model',
	};

	const components = createStaticComponents(props);
	t.is(components.length, 2); // Welcome + BootSummary
	t.is((components[0] as React.ReactElement).key, 'welcome');
	t.is((components[1] as React.ReactElement).key, 'boot-summary');

	// Render and verify the components display correctly
	const {lastFrame, unmount} = renderWithTheme(<>{components}</>);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Nanocoder/); // Welcome message should contain "Nanocoder"
	unmount();
});

test('createStaticComponents excludes welcome message when shouldShowWelcome is false', t => {
	const props: AppContainerProps = {
		shouldShowWelcome: false,
		currentProvider: 'test-provider',
		currentModel: 'test-model',
	};

	const components = createStaticComponents(props);
	t.is(components.length, 1); // Only BootSummary
	t.is((components[0] as React.ReactElement).key, 'boot-summary');

	// Render and verify the components display correctly
	const {lastFrame, unmount} = renderWithTheme(<>{components}</>);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /test-provider/); // Should show provider name
	t.regex(output!, /test-model/); // Should show model name
	unmount();
});

test('createStaticComponents includes boot summary with provider and model', t => {
	const props: AppContainerProps = {
		shouldShowWelcome: false,
		currentProvider: 'local',
		currentModel: 'gpt-4',
	};

	const components = createStaticComponents(props);
	const bootSummary = components.find(
		c => (c as React.ReactElement).key === 'boot-summary',
	) as React.ReactElement;

	t.truthy(bootSummary);

	// Render and verify the components display correctly
	const {lastFrame, unmount} = renderWithTheme(<>{components}</>);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /local/); // Provider name
	t.regex(output!, /gpt-4/); // Model name
	unmount();
});

test('createStaticComponents omits boot summary when no provider or model', t => {
	const props: AppContainerProps = {
		shouldShowWelcome: false,
		currentProvider: '',
		currentModel: '',
	};

	const components = createStaticComponents(props);
	t.is(components.length, 0);
});
