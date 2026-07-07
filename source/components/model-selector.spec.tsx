import ModelSelector from './model-selector.js';
import {renderWithTheme} from '../test-utils/render-with-theme.js';
import test from 'ava';
import React from 'react';

console.log('\nmodel-selector.spec.tsx');

interface ProviderFixture {
	name: string;
	models: string[];
}

// Mutating handle shared with the loader via the NANOCODER_PROVIDERS env var.
// We can't easily mock the module (loadAllProviderConfigs) under AVA 7 +
// tsx without import.meta.mock on the aliased specifier, so the env var is
// the supported test seam — the loader reads it on every call.
const providerState: {current: ProviderFixture[]} = {current: []};

function setProviders(providers: ProviderFixture[]): void {
	providerState.current = providers;
	process.env.NANOCODER_PROVIDERS = JSON.stringify(
		providers.map(p => ({name: p.name, models: p.models})),
	);
}

test.beforeEach(() => {
	setProviders([]);
	process.env.NANOCODER_IGNORE_PROJECT_CONFIG = '1';
});

test.afterEach(() => {
	delete process.env.NANOCODER_PROVIDERS;
	delete process.env.NANOCODER_IGNORE_PROJECT_CONFIG;
});

// ============================================================================
// Rendering
// ============================================================================

test('model-selector renders title', t => {
	setProviders([{name: 'openai', models: ['gpt-4o', 'gpt-4o-mini']}]);

	const {lastFrame} = renderWithTheme(
		<ModelSelector
			currentProvider="openai"
			currentModel="gpt-4o"
			onModelSelect={() => {}}
			onCancel={() => {}}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Select a Model/i);
});

test('model-selector renders model list after loading', t => {
	setProviders([
		{name: 'openai', models: ['model1', 'model2', 'model3']},
	]);

	const {lastFrame} = renderWithTheme(
		<ModelSelector
			currentProvider="openai"
			currentModel="model1"
			onModelSelect={() => {}}
			onCancel={() => {}}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Select a Model/i);
	t.regex(output!, /model1/);
	t.regex(output!, /model2/);
	t.regex(output!, /model3/);
});

test('model-selector marks current model in list', t => {
	setProviders([
		{name: 'openai', models: ['model1', 'model2', 'model3']},
	]);

	const {lastFrame} = renderWithTheme(
		<ModelSelector
			currentProvider="openai"
			currentModel="model2"
			onModelSelect={() => {}}
			onCancel={() => {}}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /model2.*\(current\)/i);
});

test('model-selector shows cancel instruction', t => {
	setProviders([{name: 'openai', models: ['model1', 'model2']}]);

	const {lastFrame} = renderWithTheme(
		<ModelSelector
			currentProvider="openai"
			currentModel="model1"
			onModelSelect={() => {}}
			onCancel={() => {}}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Press Escape to cancel/i);
});

test('model-selector component renders without crashing', t => {
	setProviders([{name: 'openai', models: ['model1']}]);

	const {unmount} = renderWithTheme(
		<ModelSelector
			currentProvider="openai"
			currentModel="model1"
			onModelSelect={() => {}}
			onCancel={() => {}}
		/>,
	);

	t.notThrows(() => unmount());
});

test('model-selector handles multiple models', t => {
	setProviders([
		{name: 'openai', models: Array.from({length: 10}, (_, i) => `model-${i + 1}`)},
	]);

	const {lastFrame} = renderWithTheme(
		<ModelSelector
			currentProvider="openai"
			currentModel="model-1"
			onModelSelect={() => {}}
			onCancel={() => {}}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Select a Model/i);
});

test('model-selector accepts valid props', t => {
	setProviders([{name: 'openai', models: ['model1']}]);

	t.notThrows(() => {
		renderWithTheme(
			<ModelSelector
				currentProvider="openai"
				currentModel="model1"
				onModelSelect={() => {}}
				onCancel={() => {}}
			/>,
		);
	});
});

// ============================================================================
// Error/Empty States
// ============================================================================

test('model-selector shows error when no models available', t => {
	setProviders([]);

	const {lastFrame} = renderWithTheme(
		<ModelSelector
			currentProvider="openai"
			currentModel="model1"
			onModelSelect={() => {}}
			onCancel={() => {}}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /No models available/i);
	t.regex(output!, /Make sure your providers are properly configured/i);
});

// ============================================================================
// Keyboard Interaction
// ============================================================================

test('model-selector calls onCancel when escape key is pressed', async t => {
	setProviders([{name: 'openai', models: ['model1', 'model2']}]);

	let cancelCalled = false;
	const onCancel = () => {
		cancelCalled = true;
	};

	const {stdin} = renderWithTheme(
		<ModelSelector
			currentProvider="openai"
			currentModel="model1"
			onModelSelect={() => {}}
			onCancel={onCancel}
		/>,
	);

	stdin.write('\u001B');
	await new Promise(resolve => setTimeout(resolve, 50));

	t.true(cancelCalled);
});

test('model-selector escape key works in empty state', async t => {
	setProviders([]);

	let cancelCalled = false;
	const onCancel = () => {
		cancelCalled = true;
	};

	const {stdin} = renderWithTheme(
		<ModelSelector
			currentProvider="openai"
			currentModel="model1"
			onModelSelect={() => {}}
			onCancel={onCancel}
		/>,
	);

	stdin.write('\u001B');
	await new Promise(resolve => setTimeout(resolve, 50));

	t.true(cancelCalled);
});

test('model-selector calls onModelSelect when model is selected via Enter key', async t => {
	setProviders([
		{name: 'openai', models: ['model1', 'model2', 'model3']},
	]);

	let selectedProvider = '';
	let selectedModel = '';
	const onModelSelect = (provider: string, model: string) => {
		selectedProvider = provider;
		selectedModel = model;
	};

	const {stdin} = renderWithTheme(
		<ModelSelector
			currentProvider="openai"
			currentModel="model1"
			onModelSelect={onModelSelect}
			onCancel={() => {}}
		/>,
	);

	// Press Enter to select the default (first) model
	stdin.write('\r');
	await new Promise(resolve => setTimeout(resolve, 50));

	t.is(selectedProvider, 'openai');
	t.is(selectedModel, 'model1');
});

test('model-selector selection works after navigation', async t => {
	setProviders([
		{name: 'openai', models: ['model1', 'model2', 'model3']},
	]);

	let selectedProvider = '';
	let selectedModel = '';
	const onModelSelect = (provider: string, model: string) => {
		selectedProvider = provider;
		selectedModel = model;
	};

	const {stdin} = renderWithTheme(
		<ModelSelector
			currentProvider="openai"
			currentModel="model1"
			onModelSelect={onModelSelect}
			onCancel={() => {}}
		/>,
	);

	// Navigate down once
	stdin.write('\u001B[B'); // Down arrow
	await new Promise(resolve => setTimeout(resolve, 50));

	// Press Enter to select
	stdin.write('\r');
	await new Promise(resolve => setTimeout(resolve, 50));

	t.is(selectedProvider, 'openai');
	t.is(selectedModel, 'model2');
});

test('model-selector displays correct model count', t => {
	setProviders([
		{name: 'openai', models: Array.from({length: 5}, (_, i) => `model-${i + 1}`)},
	]);

	const {lastFrame} = renderWithTheme(
		<ModelSelector
			currentProvider="openai"
			currentModel="model-1"
			onModelSelect={() => {}}
			onCancel={() => {}}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	for (let i = 1; i <= 5; i++) {
		t.regex(output!, new RegExp(`model-${i}`));
	}
});

test('model-selector formats current model label correctly', t => {
	setProviders([{name: 'openai', models: ['alpha', 'beta', 'gamma']}]);

	const {lastFrame} = renderWithTheme(
		<ModelSelector
			currentProvider="openai"
			currentModel="beta"
			onModelSelect={() => {}}
			onCancel={() => {}}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	// Current model should be marked
	t.regex(output!, /beta.*\(current\)/i);
	// Other models should not be marked as current
	t.notRegex(output!, /alpha.*\(current\)/i);
	t.notRegex(output!, /gamma.*\(current\)/i);
});
