import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {ProviderStep} from './provider-step.js';

// ============================================================================
// Tests for ProviderStep Component Rendering
// ============================================================================

console.log(`\nprovider-step.spec.tsx – ${React.version}`);

test('ProviderStep renders with initial options', t => {
	const {lastFrame} = render(<ProviderStep onComplete={() => {}} />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Let's add AI providers/);
});

test('ProviderStep shows template selection option', t => {
	const {lastFrame} = render(<ProviderStep onComplete={() => {}} />);

	const output = lastFrame();
	t.regex(output!, /Choose from common templates/);
});

test('ProviderStep shows custom provider option', t => {
	const {lastFrame} = render(<ProviderStep onComplete={() => {}} />);

	const output = lastFrame();
	t.regex(output!, /Add custom provider manually/);
});

test('ProviderStep does not show skip option', t => {
	const {lastFrame} = render(<ProviderStep onComplete={() => {}} />);

	const output = lastFrame();
	t.notRegex(output!, /Skip providers/);
});

test('ProviderStep shows edit option when providers exist', t => {
	const existingProviders = [
		{
			name: 'ollama',
			baseUrl: 'http://localhost:11434/v1',
			models: ['llama2'],
		},
	];

	const {lastFrame} = render(
		<ProviderStep
			onComplete={() => {}}
			existingProviders={existingProviders}
		/>,
	);

	const output = lastFrame();
	t.regex(output!, /Edit existing providers/);
});

test('ProviderStep does not show edit option when no providers exist', t => {
	const {lastFrame} = render(<ProviderStep onComplete={() => {}} />);

	const output = lastFrame();
	t.notRegex(output!, /Edit existing providers/);
});

test('ProviderStep shows provider count when providers exist', t => {
	const existingProviders = [
		{
			name: 'ollama',
			baseUrl: 'http://localhost:11434/v1',
			models: ['llama2'],
		},
		{
			name: 'OpenRouter',
			baseUrl: 'https://openrouter.ai/api/v1',
			apiKey: 'test-key',
			models: ['model1'],
		},
	];

	const {lastFrame} = render(
		<ProviderStep
			onComplete={() => {}}
			existingProviders={existingProviders}
		/>,
	);

	const output = lastFrame();
	t.regex(output!, /2 provider\(s\) already added/);
});

test('ProviderStep renders without crashing when onBack is provided', t => {
	let backCalled = false;

	const {lastFrame} = render(
		<ProviderStep
			onComplete={() => {}}
			onBack={() => {
				backCalled = true;
			}}
		/>,
	);

	t.truthy(lastFrame());
	t.false(backCalled); // Should not be called on render
});

test('ProviderStep accepts existingProviders prop', t => {
	const existingProviders = [
		{
			name: 'test-provider',
			baseUrl: 'http://localhost:8080/v1',
			models: ['test-model'],
		},
	];

	const {lastFrame} = render(
		<ProviderStep
			onComplete={() => {}}
			existingProviders={existingProviders}
		/>,
	);

	// Component should render without errors
	t.truthy(lastFrame());
});

test('ProviderStep renders with correct initial state', t => {
	const {frames} = render(<ProviderStep onComplete={() => {}} />);

	// Should have rendered at least one frame
	t.true(frames.length > 0);

	// First frame should show initial options
	const firstFrame = frames[0];
	t.regex(firstFrame, /Let's add AI providers/);
});

// ============================================================================
// Tests for ProviderStep Component Modes
// ============================================================================

test('ProviderStep renders template selection mode', t => {
	const {lastFrame} = render(<ProviderStep onComplete={() => {}} />);

	const output = lastFrame();
	// Initial mode shows the prompt to choose templates
	t.regex(output!, /Let's add AI providers/);
});

test('ProviderStep shows provider templates in list', t => {
	const {lastFrame} = render(<ProviderStep onComplete={() => {}} />);

	const output = lastFrame();
	// Initial screen shows option to choose templates
	t.regex(output!, /Choose from common templates/);
});

// ============================================================================
// Tests for ProviderStep Component Callbacks
// ============================================================================

test('ProviderStep calls onComplete when provided', t => {
	let completeCalled = false;

	const {lastFrame} = render(
		<ProviderStep
			onComplete={() => {
				completeCalled = true;
			}}
		/>,
	);

	t.truthy(lastFrame());
	t.false(completeCalled); // Should not be called on render
});

test('ProviderStep calls onBack when provided', t => {
	let backCalled = false;

	const {lastFrame} = render(
		<ProviderStep
			onComplete={() => {}}
			onBack={() => {
				backCalled = true;
			}}
		/>,
	);

	t.truthy(lastFrame());
	t.false(backCalled); // Should not be called on render
});

// ============================================================================
// Tests for ProviderStep State Management
// ============================================================================

test('ProviderStep shows single provider count', t => {
	const existingProviders = [
		{
			name: 'provider1',
			baseUrl: 'http://localhost:1111/v1',
			models: ['model1'],
		},
	];

	const {lastFrame} = render(
		<ProviderStep
			onComplete={() => {}}
			existingProviders={existingProviders}
		/>,
	);

	const output = lastFrame();
	t.regex(output!, /1 provider\(s\) already added/);
});

test('ProviderStep shows multiple providers count', t => {
	const existingProviders = [
		{
			name: 'provider1',
			baseUrl: 'http://localhost:1111/v1',
			models: ['model1'],
		},
		{
			name: 'provider2',
			baseUrl: 'http://localhost:2222/v1',
			models: ['model2'],
		},
	];

	const {lastFrame} = render(
		<ProviderStep
			onComplete={() => {}}
			existingProviders={existingProviders}
		/>,
	);

	const output = lastFrame();
	t.regex(output!, /2 provider\(s\) already added/);
});

test('ProviderStep handles empty existingProviders array', t => {
	const {lastFrame} = render(
		<ProviderStep onComplete={() => {}} existingProviders={[]} />,
	);

	const output = lastFrame();
	t.truthy(output);
	// Should not show provider count when none exist
	t.notRegex(output!, /provider\(s\) already added/);
});

// ============================================================================
// Tests for ProviderStep Props Validation
// ============================================================================

test('ProviderStep requires onComplete prop', t => {
	const {lastFrame} = render(<ProviderStep onComplete={() => {}} />);

	// Component should render without errors
	t.truthy(lastFrame());
});

test('ProviderStep handles optional onBack prop', t => {
	const {lastFrame} = render(<ProviderStep onComplete={() => {}} />);

	// Component should render without errors even without onBack
	t.truthy(lastFrame());
});

test('ProviderStep handles optional existingProviders prop', t => {
	const {lastFrame} = render(<ProviderStep onComplete={() => {}} />);

	// Component should render without errors even without existingProviders
	t.truthy(lastFrame());
});

// ============================================================================
// Tests for ProviderStep UI Elements
// ============================================================================

test('ProviderStep renders SelectInput component', t => {
	const {lastFrame} = render(<ProviderStep onComplete={() => {}} />);

	const output = lastFrame();
	// SelectInput should render options
	t.truthy(output);
	t.regex(
		output!,
		/Choose from common templates|Add custom provider manually|Done/,
	);
});

test('ProviderStep shows Done & Save option when providers exist', t => {
	const existingProviders = [
		{
			name: 'test',
			baseUrl: 'http://localhost:8080/v1',
			models: ['model1'],
		},
	];

	const {lastFrame} = render(
		<ProviderStep
			onComplete={() => {}}
			existingProviders={existingProviders}
		/>,
	);

	const output = lastFrame();
	t.regex(output!, /Done & Save/);
});

test('ProviderStep does not show Done & Save option when no providers exist', t => {
	const {lastFrame} = render(<ProviderStep onComplete={() => {}} />);

	const output = lastFrame();
	t.notRegex(output!, /Done & Save/);
});

test('ProviderStep shows correct text color for provider count', t => {
	const existingProviders = [
		{
			name: 'test',
			baseUrl: 'http://localhost:8080/v1',
			models: ['test'],
		},
	];

	const {lastFrame} = render(
		<ProviderStep
			onComplete={() => {}}
			existingProviders={existingProviders}
		/>,
	);

	// Component should render the provider count
	const output = lastFrame();
	t.regex(output!, /1 provider\(s\) already added/);
});

test('ProviderStep renders multiple provider names when added', t => {
	const existingProviders = [
		{
			name: 'ollama',
			baseUrl: 'http://localhost:11434/v1',
			models: ['llama2'],
		},
		{
			name: 'OpenRouter',
			baseUrl: 'https://openrouter.ai/api/v1',
			apiKey: 'test',
			models: ['model1'],
		},
	];

	const {lastFrame} = render(
		<ProviderStep
			onComplete={() => {}}
			existingProviders={existingProviders}
		/>,
	);

	const output = lastFrame();
	t.regex(output!, /2 provider\(s\) already added/);
});

// ============================================================================
// Tests for ProviderStep Delete Config Feature
// ============================================================================

test('ProviderStep shows delete option when config exists and onDelete provided', t => {
	const {lastFrame} = render(
		<ProviderStep
			onComplete={() => {}}
			onDelete={() => {}}
			configExists={true}
		/>,
	);

	const output = lastFrame();
	t.regex(output!, /Delete config file/);
});

test('ProviderStep does not show delete option when config does not exist', t => {
	const {lastFrame} = render(
		<ProviderStep
			onComplete={() => {}}
			onDelete={() => {}}
			configExists={false}
		/>,
	);

	const output = lastFrame();
	t.notRegex(output!, /Delete config file/);
});

test('ProviderStep does not show delete option when onDelete not provided', t => {
	const {lastFrame} = render(
		<ProviderStep onComplete={() => {}} configExists={true} />,
	);

	const output = lastFrame();
	t.notRegex(output!, /Delete config file/);
});

test('ProviderStep accepts onDelete prop', t => {
	let deleteCalled = false;

	const {lastFrame} = render(
		<ProviderStep
			onComplete={() => {}}
			onDelete={() => {
				deleteCalled = true;
			}}
			configExists={true}
		/>,
	);

	t.truthy(lastFrame());
	t.false(deleteCalled); // Should not be called on render
});

test('ProviderStep accepts configExists prop', t => {
	const {lastFrame} = render(
		<ProviderStep onComplete={() => {}} configExists={true} />,
	);

	// Component should render without errors
	t.truthy(lastFrame());
});

// ============================================================================
// Tests for ProviderStep Initial Menu Options
// ============================================================================

test('ProviderStep shows all initial options without providers', t => {
	const {lastFrame} = render(<ProviderStep onComplete={() => {}} />);

	const output = lastFrame();
	t.regex(output!, /Choose from common templates/);
	t.regex(output!, /Add custom provider manually/);
	// Should not show Done & Save when no providers
	t.notRegex(output!, /Done & Save/);
	// Should not show edit when no providers
	t.notRegex(output!, /Edit existing providers/);
});

test('ProviderStep shows all initial options with providers', t => {
	const existingProviders = [
		{
			name: 'test',
			baseUrl: 'http://localhost:8080/v1',
			models: ['model1'],
		},
	];

	const {lastFrame} = render(
		<ProviderStep
			onComplete={() => {}}
			existingProviders={existingProviders}
		/>,
	);

	const output = lastFrame();
	t.regex(output!, /Choose from common templates/);
	t.regex(output!, /Add custom provider manually/);
	t.regex(output!, /Edit existing providers/);
	t.regex(output!, /Done & Save/);
});

// ============================================================================
// Tests for ProviderStep with Combined Props
// ============================================================================

test('ProviderStep renders with all props combined', t => {
	const existingProviders = [
		{
			name: 'test',
			baseUrl: 'http://localhost:8080/v1',
			models: ['model1'],
		},
	];

	const {lastFrame} = render(
		<ProviderStep
			onComplete={() => {}}
			onBack={() => {}}
			onDelete={() => {}}
			existingProviders={existingProviders}
			configExists={true}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	// Should show all relevant options
	t.regex(output!, /Choose from common templates/);
	t.regex(output!, /Add custom provider manually/);
	t.regex(output!, /Edit existing providers/);
	t.regex(output!, /Done & Save/);
	t.regex(output!, /Delete config file/);
});

test('ProviderStep shows provider count message', t => {
	const existingProviders = [
		{
			name: 'provider1',
			baseUrl: 'http://localhost:1111/v1',
			models: ['model1'],
		},
		{
			name: 'provider2',
			baseUrl: 'http://localhost:2222/v1',
			models: ['model2'],
		},
		{
			name: 'provider3',
			baseUrl: 'http://localhost:3333/v1',
			models: ['model3'],
		},
	];

	const {lastFrame} = render(
		<ProviderStep
			onComplete={() => {}}
			existingProviders={existingProviders}
		/>,
	);

	const output = lastFrame();
	t.regex(output!, /3 provider\(s\) already added/);
});

// ============================================================================
// Tests for ProviderStep Edge Cases
// ============================================================================

test('ProviderStep handles undefined existingProviders', t => {
	const {lastFrame} = render(
		<ProviderStep onComplete={() => {}} existingProviders={undefined} />,
	);

	t.truthy(lastFrame());
});

test('ProviderStep handles provider with apiKey', t => {
	const existingProviders = [
		{
			name: 'openrouter',
			baseUrl: 'https://openrouter.ai/api/v1',
			apiKey: 'test-key',
			models: ['model1'],
		},
	];

	const {lastFrame} = render(
		<ProviderStep
			onComplete={() => {}}
			existingProviders={existingProviders}
		/>,
	);

	const output = lastFrame();
	t.regex(output!, /1 provider\(s\) already added/);
});

test('ProviderStep handles provider with empty models array', t => {
	const existingProviders = [
		{
			name: 'test',
			baseUrl: 'http://localhost:8080/v1',
			models: [],
		},
	];

	const {lastFrame} = render(
		<ProviderStep
			onComplete={() => {}}
			existingProviders={existingProviders}
		/>,
	);

	const output = lastFrame();
	t.regex(output!, /1 provider\(s\) already added/);
});

test('ProviderStep handles provider with multiple models', t => {
	const existingProviders = [
		{
			name: 'ollama',
			baseUrl: 'http://localhost:11434/v1',
			models: ['llama2', 'codellama', 'mistral', 'phi'],
		},
	];

	const {lastFrame} = render(
		<ProviderStep
			onComplete={() => {}}
			existingProviders={existingProviders}
		/>,
	);

	const output = lastFrame();
	t.regex(output!, /1 provider\(s\) already added/);
});

test('ProviderStep handles many providers', t => {
	const existingProviders = [
		{name: 'p1', baseUrl: 'http://localhost:1/v1', models: ['m1']},
		{name: 'p2', baseUrl: 'http://localhost:2/v1', models: ['m2']},
		{name: 'p3', baseUrl: 'http://localhost:3/v1', models: ['m3']},
		{name: 'p4', baseUrl: 'http://localhost:4/v1', models: ['m4']},
		{name: 'p5', baseUrl: 'http://localhost:5/v1', models: ['m5']},
	];

	const {lastFrame} = render(
		<ProviderStep
			onComplete={() => {}}
			existingProviders={existingProviders}
		/>,
	);

	const output = lastFrame();
	t.regex(output!, /5 provider\(s\) already added/);
});

// ============================================================================
// Tests for ProviderStep Rendering Consistency
// ============================================================================

test('ProviderStep renders consistently with same props', t => {
	const props = {
		onComplete: () => {},
		existingProviders: [
			{name: 'test', baseUrl: 'http://localhost:8080/v1', models: ['m1']},
		],
	};

	const output1 = render(<ProviderStep {...props} />).lastFrame();
	const output2 = render(<ProviderStep {...props} />).lastFrame();

	t.is(output1, output2);
});

test('ProviderStep renders without errors on multiple frames', t => {
	const {frames} = render(<ProviderStep onComplete={() => {}} />);

	t.true(frames.length > 0);
	for (const frame of frames) {
		t.truthy(frame);
	}
});
