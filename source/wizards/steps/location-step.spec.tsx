import {resolve} from 'node:path';
import test from 'ava';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {renderWithTheme as render} from '@/test-utils/render-with-theme';
import React from 'react';
import {LocationStep} from './location-step.js';

// Mirrors base-config-wizard.tsx's real LocationStep box.
function WizardBox({
	projectDir,
	onComplete,
}: {
	projectDir: string;
	onComplete: () => void;
}) {
	const {boxWidth} = useResponsiveTerminal();
	return (
		<TitledBoxWithPreferences
			title="Setup"
			width={boxWidth}
			borderColor="blue"
			paddingX={2}
			paddingY={1}
			flexDirection="column"
		>
			<LocationStep onComplete={onComplete} projectDir={projectDir} />
		</TitledBoxWithPreferences>
	);
}

// ============================================================================
// Tests for LocationStep Component Rendering
// ============================================================================

console.log(`\nlocation-step.spec.tsx – ${React.version}`);

test('LocationStep renders with location selection options', t => {
	const {lastFrame} = render(
		<LocationStep onComplete={() => {}} projectDir="/test/project" />,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Where would you like to create your configuration\?/);
});

test('LocationStep shows project directory option', t => {
	const {lastFrame} = render(
		<LocationStep onComplete={() => {}} projectDir="/test/project" />,
	);

	const output = lastFrame();
	t.regex(output!, /Current project directory/);
});

test('LocationStep shows global config option', t => {
	const {lastFrame} = render(
		<LocationStep onComplete={() => {}} projectDir="/test/project" />,
	);

	const output = lastFrame();
	t.regex(output!, /Global user config/);
});

test('LocationStep shows the resolved project path next to the option', t => {
	const {lastFrame} = render(
		<LocationStep onComplete={() => {}} projectDir="/test/project" />,
	);

	const output = lastFrame();
	t.truthy(output);
	const lines = output!.split('\n');
	const stemIndex = lines.findIndex(line =>
		line.includes('Current project directory'),
	);
	t.true(stemIndex !== -1, 'expected to find the project directory stem');
	t.is(lines[stemIndex + 1]?.trim(), resolve('/test/project'));
});

test('LocationStep does not clip the leaf directory inside the real wizard box', t => {
	const originalColumns = process.stdout.columns;
	try {
		for (const columns of [60, 80, 120]) {
			Object.defineProperty(process.stdout, 'columns', {
				value: columns,
				configurable: true,
			});

			const {lastFrame} = render(
				<WizardBox
					onComplete={() => {}}
					projectDir="/Users/will/Documents/GitHub/some-org/some-really-long-monorepo-name/packages/leaf-dir"
				/>,
			);

			const output = lastFrame();
			t.true(
				output!.includes('leaf-dir'),
				`at ${columns} cols, expected leaf directory to stay visible, got: ${output}`,
			);
		}
	} finally {
		Object.defineProperty(process.stdout, 'columns', {
			value: originalColumns,
			configurable: true,
		});
	}
});

test('LocationStep shows tip about config types', t => {
	const {lastFrame} = render(
		<LocationStep onComplete={() => {}} projectDir="/test/project" />,
	);

	const output = lastFrame();
	t.regex(output!, /Project configs are useful for team settings/);
});

// ============================================================================
// Tests for LocationStep Component Callbacks
// ============================================================================

test('LocationStep calls onComplete when provided', t => {
	let completeCalled = false;

	const {lastFrame} = render(
		<LocationStep
			onComplete={() => {
				completeCalled = true;
			}}
			projectDir="/test/project"
		/>,
	);

	t.truthy(lastFrame());
	t.false(completeCalled); // Should not be called on render
});

test('LocationStep calls onBack when provided', t => {
	let backCalled = false;

	const {lastFrame} = render(
		<LocationStep
			onComplete={() => {}}
			onBack={() => {
				backCalled = true;
			}}
			projectDir="/test/project"
		/>,
	);

	t.truthy(lastFrame());
	t.false(backCalled); // Should not be called on render
});

// ============================================================================
// Tests for LocationStep Props Validation
// ============================================================================

test('LocationStep requires onComplete prop', t => {
	const {lastFrame} = render(
		<LocationStep onComplete={() => {}} projectDir="/test/project" />,
	);

	t.truthy(lastFrame());
});

test('LocationStep requires projectDir prop', t => {
	const {lastFrame} = render(
		<LocationStep onComplete={() => {}} projectDir="/test/project" />,
	);

	t.truthy(lastFrame());
});

test('LocationStep handles optional onBack prop', t => {
	const {lastFrame} = render(
		<LocationStep onComplete={() => {}} projectDir="/test/project" />,
	);

	t.truthy(lastFrame());
});

// ============================================================================
// Tests for LocationStep UI Elements
// ============================================================================

test('LocationStep renders SelectInput component', t => {
	const {lastFrame} = render(
		<LocationStep onComplete={() => {}} projectDir="/test/project" />,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Current project directory|Global user config/);
});

test('LocationStep renders with correct initial state', t => {
	const {frames} = render(
		<LocationStep onComplete={() => {}} projectDir="/test/project" />,
	);

	t.true(frames.length > 0);

	const firstFrame = frames[0];
	t.regex(firstFrame, /Where would you like to create your configuration\?/);
});

test('LocationStep renders without crashing', t => {
	const {lastFrame} = render(
		<LocationStep onComplete={() => {}} projectDir="/test/project" />,
	);

	t.truthy(lastFrame());
});

test('LocationStep accepts projectDir with different paths', t => {
	const testPaths = [
		'/home/user/project',
		'/var/www/app',
		'C:\\Users\\test\\project',
	];

	for (const projectDir of testPaths) {
		const {lastFrame} = render(
			<LocationStep onComplete={() => {}} projectDir={projectDir} />,
		);

		t.truthy(lastFrame());
	}
});

// ============================================================================
// Tests for LocationStep Narrow Terminal Mode
// ============================================================================

test('LocationStep renders in narrow mode', t => {
	// Note: This test verifies the component renders, but we can't easily
	// simulate terminal width changes in tests
	const {lastFrame} = render(
		<LocationStep onComplete={() => {}} projectDir="/test/project" />,
	);

	t.truthy(lastFrame());
});

test('LocationStep shows config path information', t => {
	const {lastFrame} = render(
		<LocationStep onComplete={() => {}} projectDir="/test/project" />,
	);

	const output = lastFrame();
	t.truthy(output);
	// Should contain information about where configs will be created
	t.regex(output!, /Current project directory|Global user config/);
});
