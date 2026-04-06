import {render} from 'ink-testing-library';
import test from 'ava';
import React from 'react';
import {defaultTheme, themes} from '@/config/themes';
import {ThemeContext} from '@/hooks/useTheme';
import {TitleShapeContext} from '@/hooks/useTitleShape';
import {TUNE_DEFAULTS} from '@/types/config';
import type {TuneConfig} from '@/types/config';
import {TuneSelector} from './tune-selector';

void React;

console.log('\ntune-selector.spec.tsx');

const mockTheme = {
	currentTheme: defaultTheme,
	colors: themes[defaultTheme].colors,
	setCurrentTheme: () => {},
};

const mockTitleShape = {
	currentTitleShape: 'pill' as const,
	setCurrentTitleShape: () => {},
};

function Wrapper({children}: {children: React.ReactNode}) {
	return (
		<ThemeContext.Provider value={mockTheme}>
			<TitleShapeContext.Provider value={mockTitleShape}>
				{children}
			</TitleShapeContext.Provider>
		</ThemeContext.Provider>
	);
}

function renderTuneSelector(
	config: TuneConfig = TUNE_DEFAULTS,
	onSelect = (_c: TuneConfig) => {},
	onCancel = () => {},
) {
	return render(
		<Wrapper>
			<TuneSelector
				currentConfig={config}
				onSelect={onSelect}
				onCancel={onCancel}
			/>
		</Wrapper>,
	);
}

const ENABLED_CONFIG: TuneConfig = {...TUNE_DEFAULTS, enabled: true};

// ============================================================================
// Rendering Tests
// ============================================================================

test('renders without crashing', t => {
	const {unmount} = renderTuneSelector();
	t.notThrows(() => unmount());
});

test('shows Tune title', t => {
	const {lastFrame} = renderTuneSelector();
	const output = lastFrame()!;
	t.true(output.includes('Tune'));
});

test('shows toggle option', t => {
	const {lastFrame} = renderTuneSelector();
	const output = lastFrame()!;
	t.true(output.includes('Disabled'));
});

test('shows Apply & Close option', t => {
	const {lastFrame} = renderTuneSelector();
	const output = lastFrame()!;
	t.true(output.includes('Apply'));
});

test('shows Load Preset option', t => {
	const {lastFrame} = renderTuneSelector();
	const output = lastFrame()!;
	t.true(output.includes('Preset'));
});

// ============================================================================
// Enabled State — shows all config options
// ============================================================================

test('shows Tool Profile when enabled', t => {
	const {lastFrame} = renderTuneSelector(ENABLED_CONFIG);
	const output = lastFrame()!;
	t.true(output.includes('Tool Profile'));
});

test('shows Aggressive Compact when enabled', t => {
	const {lastFrame} = renderTuneSelector(ENABLED_CONFIG);
	const output = lastFrame()!;
	t.true(output.includes('Aggressive Compact'));
});

test('shows Native Tool Calling when enabled', t => {
	const {lastFrame} = renderTuneSelector(ENABLED_CONFIG);
	const output = lastFrame()!;
	t.true(output.includes('Native Tool Calling'));
});

test('shows Model Parameters when enabled', t => {
	const {lastFrame} = renderTuneSelector(ENABLED_CONFIG);
	const output = lastFrame()!;
	t.true(output.includes('Model Parameters'));
});

// ============================================================================
// Disabled State — hides config options
// ============================================================================

test('hides Tool Profile when disabled', t => {
	const {lastFrame} = renderTuneSelector();
	const output = lastFrame()!;
	t.false(output.includes('Tool Profile'));
});

test('hides Aggressive Compact when disabled', t => {
	const {lastFrame} = renderTuneSelector();
	const output = lastFrame()!;
	t.false(output.includes('Aggressive Compact'));
});

test('hides Native Tool Calling when disabled', t => {
	const {lastFrame} = renderTuneSelector();
	const output = lastFrame()!;
	t.false(output.includes('Native Tool Calling'));
});

test('hides Model Parameters when disabled', t => {
	const {lastFrame} = renderTuneSelector();
	const output = lastFrame()!;
	t.false(output.includes('Model Parameters'));
});

// ============================================================================
// Display Values
// ============================================================================

test('shows current tool profile name', t => {
	const config: TuneConfig = {...ENABLED_CONFIG, toolProfile: 'minimal'};
	const {lastFrame} = renderTuneSelector(config);
	const output = lastFrame()!;
	t.true(output.includes('minimal'));
});

test('shows Aggressive Compact OFF by default', t => {
	const {lastFrame} = renderTuneSelector(ENABLED_CONFIG);
	const output = lastFrame()!;
	t.regex(output, /Aggressive Compact.*OFF/);
});

test('shows Aggressive Compact ON when enabled', t => {
	const config: TuneConfig = {...ENABLED_CONFIG, aggressiveCompact: true};
	const {lastFrame} = renderTuneSelector(config);
	const output = lastFrame()!;
	t.regex(output, /Aggressive Compact.*ON/);
});

test('shows Native Tool Calling ON by default', t => {
	const {lastFrame} = renderTuneSelector(ENABLED_CONFIG);
	const output = lastFrame()!;
	t.regex(output, /Native Tool Calling.*ON/);
});

test('shows Native Tool Calling OFF with XML fallback', t => {
	const config: TuneConfig = {...ENABLED_CONFIG, disableNativeTools: true};
	const {lastFrame} = renderTuneSelector(config);
	const output = lastFrame()!;
	t.regex(output, /Native Tool Calling.*OFF/);
	t.true(output.includes('XML fallback'));
});

test('shows Model Parameters defaults when unconfigured', t => {
	const {lastFrame} = renderTuneSelector(ENABLED_CONFIG);
	const output = lastFrame()!;
	t.regex(output, /Model Parameters.*defaults/);
});

test('shows Model Parameters configured when set', t => {
	const config: TuneConfig = {
		...ENABLED_CONFIG,
		modelParameters: {temperature: 0.5},
	};
	const {lastFrame} = renderTuneSelector(config);
	const output = lastFrame()!;
	t.regex(output, /Model Parameters.*configured/);
});

// ============================================================================
// Toggle labels
// ============================================================================

test('shows Tune - Disabled when disabled', t => {
	const {lastFrame} = renderTuneSelector();
	const output = lastFrame()!;
	t.true(output.includes('Tune - Disabled'));
});

test('shows Tune - Enabled when enabled', t => {
	const {lastFrame} = renderTuneSelector(ENABLED_CONFIG);
	const output = lastFrame()!;
	t.true(output.includes('Tune - Enabled'));
});
