import {existsSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	TitleShapeContext,
	useTitleShape,
	getInitialTitleShape,
	updateTitleShape as updateShapeInHook,
} from './useTitleShape';
import {getTitleShape, resetPreferencesCache, updateTitleShape as updateTitleShapeInPrefs} from '@/config/preferences';
import type {TitleShape} from '../components/ui/styled-title';
import type {UserPreferences} from '@/types/index';
import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';

console.log('\nuseTitleShape.spec.ts');

// Use environment variable to isolate config directory for tests
const testConfigDir = join(tmpdir(), `nanocoder-test-config-${Date.now()}`);

test.before(() => {
	// Set config directory for all tests
	process.env.NANOCODER_CONFIG_DIR = testConfigDir;
	mkdirSync(testConfigDir, {recursive: true});
	// Reset preferences cache to pick up new config directory
	resetPreferencesCache();
});

test.after.always(() => {
	// Clean up test config directory
	if (existsSync(testConfigDir)) {
		rmSync(testConfigDir, {recursive: true, force: true});
	}
	// Clean up environment
	delete process.env.NANOCODER_CONFIG_DIR;
	// Reset cache to restore normal behavior
	resetPreferencesCache();
});

// Helper to get preferences file path
const getTestPreferencesPath = () => join(testConfigDir, 'nanocoder-preferences.json');

// Helper component to test useTitleShape
function TitleShapeConsumer({
	onRender,
}: {
	onRender: (titleShape: ReturnType<typeof useTitleShape>) => void;
}) {
	const titleShape = useTitleShape();
	React.useEffect(() => {
		onRender(titleShape);
	}, [titleShape, onRender]);
	return null;
}

// Mock TitleShapeProvider for testing
function MockTitleShapeProvider({
	children,
	initialShape = 'pill',
}: {
	children: React.ReactNode;
	initialShape?: TitleShape;
}) {
	const [currentTitleShape, setCurrentTitleShape] = React.useState<TitleShape>(initialShape);

	const value = {
		currentTitleShape,
		setCurrentTitleShape,
		commitTitleShape: setCurrentTitleShape,
	};

	return React.createElement(TitleShapeContext.Provider, {value}, children);
}

test('useTitleShape returns title shape context when used within provider', t => {
	let capturedTitleShape: ReturnType<typeof useTitleShape> | null = null;

	render(
		React.createElement(MockTitleShapeProvider, {
			initialShape: 'rounded',
			children: React.createElement(TitleShapeConsumer, {
				onRender: titleShape => {
					capturedTitleShape = titleShape;
				},
			}),
		}),
	);

	t.truthy(capturedTitleShape);
	t.is(capturedTitleShape!.currentTitleShape, 'rounded');
	t.is(typeof capturedTitleShape!.setCurrentTitleShape, 'function');
	t.is(typeof capturedTitleShape!.commitTitleShape, 'function');
});

test('useTitleShape provides currentTitleShape and setCurrentTitleShape', t => {
	let capturedTitleShape: ReturnType<typeof useTitleShape> | null = null;

	render(
		React.createElement(MockTitleShapeProvider, {
			initialShape: 'square',
			children: React.createElement(TitleShapeConsumer, {
				onRender: titleShape => {
					capturedTitleShape = titleShape;
				},
			}),
		}),
	);

	t.truthy(capturedTitleShape);
	t.is(capturedTitleShape!.currentTitleShape, 'square');
	t.is(typeof capturedTitleShape!.setCurrentTitleShape, 'function');
	t.is(typeof capturedTitleShape!.commitTitleShape, 'function');
});

test('useTitleShape throws error when used outside of TitleShapeProvider', t => {
	let capturedError: Error | null = null;

	function ConsumerWithoutProvider() {
		try {
			useTitleShape();
		} catch (error) {
			capturedError = error as Error;
		}
		return null;
	}

	render(React.createElement(ConsumerWithoutProvider));

	t.truthy(capturedError);
	t.regex(
		capturedError!.message,
		/useTitleShape must be used within a TitleShapeProvider/,
	);
});

test('useTitleShape works with different title shapes', t => {
	const shapes: TitleShape[] = ['pill', 'rounded', 'square', 'double', 'arrow-left', 'powerline-angled'];

	for (const shape of shapes) {
		let capturedTitleShape: ReturnType<typeof useTitleShape> | null = null;

		render(
			React.createElement(MockTitleShapeProvider, {
				initialShape: shape,
				children: React.createElement(TitleShapeConsumer, {
					onRender: titleShape => {
						capturedTitleShape = titleShape;
					},
				}),
			}),
		);

		t.truthy(capturedTitleShape);
		t.is(capturedTitleShape!.currentTitleShape, shape);
	}
});

test.serial('getInitialTitleShape: returns preference value if available', t => {
	const preferencesPath = getTestPreferencesPath();
	const preferences: UserPreferences = {
		titleShape: 'square',
	};

	writeFileSync(preferencesPath, JSON.stringify(preferences, null, 2), 'utf-8');
	resetPreferencesCache();

	const result = getInitialTitleShape();
	t.is(result, 'square');
});

test.serial('getInitialTitleShape: defaults to "pill" when no preference exists', t => {
	// Ensure preferences file doesn't exist or is empty
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}
	resetPreferencesCache();

	const result = getInitialTitleShape();
	t.is(result, 'pill');
});

test.serial('getInitialTitleShape: defaults to "pill" when preference file is empty', t => {
	const preferencesPath = getTestPreferencesPath();
	writeFileSync(preferencesPath, '{}', 'utf-8');
	resetPreferencesCache();

	const result = getInitialTitleShape();
	t.is(result, 'pill');
});

test.serial('getInitialTitleShape: defaults to "pill" when preference is null', t => {
	const preferencesPath = getTestPreferencesPath();
	const preferences: UserPreferences = {
		titleShape: undefined,
	};

	writeFileSync(preferencesPath, JSON.stringify(preferences, null, 2), 'utf-8');
	resetPreferencesCache();

	const result = getInitialTitleShape();
	t.is(result, 'pill');
});

test.serial('getInitialTitleShape: works with all valid title shapes', t => {
	const validShapes: TitleShape[] = [
		'pill',
		'rounded',
		'square',
		'double',
		'arrow-left',
		'arrow-right',
		'arrow-double',
		'angled-box',
		'powerline-angled',
		'powerline-angled-thin',
		'powerline-block',
		'powerline-block-alt',
		'powerline-curved',
		'powerline-curved-thin',
		'powerline-flame',
		'powerline-flame-thin',
		'powerline-graph',
		'powerline-ribbon',
		'powerline-segment',
		'powerline-segment-thin',
	];

	for (const shape of validShapes) {
		const preferencesPath = getTestPreferencesPath();
		const preferences: UserPreferences = {
			titleShape: shape,
		};

		writeFileSync(preferencesPath, JSON.stringify(preferences, null, 2), 'utf-8');
		resetPreferencesCache();

		const result = getInitialTitleShape();
		t.is(result, shape, `Should get initial shape: ${shape}`);
	}
});

test.serial('updateTitleShape: saves shape to preferences', t => {
	const preferencesPath = getTestPreferencesPath();

	// Update the title shape
	updateShapeInHook('double');

	// Read back the preferences file
	resetPreferencesCache();
	const savedShape = getTitleShape();

	t.is(savedShape, 'double');
});

test.serial('updateTitleShape: works with all valid title shapes', t => {
	const validShapes: TitleShape[] = [
		'pill',
		'rounded',
		'square',
		'double',
		'arrow-left',
		'arrow-right',
		'arrow-double',
		'angled-box',
		'powerline-angled',
		'powerline-angled-thin',
		'powerline-block',
		'powerline-block-alt',
		'powerline-curved',
		'powerline-curved-thin',
		'powerline-flame',
		'powerline-flame-thin',
		'powerline-graph',
		'powerline-ribbon',
		'powerline-segment',
		'powerline-segment-thin',
	];

	for (const shape of validShapes) {
		// Update the title shape
		updateShapeInHook(shape);

		// Read back the preferences file
		resetPreferencesCache();
		const savedShape = getTitleShape();

		t.is(savedShape, shape, `Should update with shape: ${shape}`);
	}
});

test.serial('getInitialTitleShape and updateTitleShape work together', t => {
	const preferencesPath = getTestPreferencesPath();

	// Start with no preferences
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}
	resetPreferencesCache();

	// Should return default 'pill'
	let result = getInitialTitleShape();
	t.is(result, 'pill');

	// Update to 'rounded'
	updateShapeInHook('rounded');
	resetPreferencesCache();

	// Should now return 'rounded'
	result = getInitialTitleShape();
	t.is(result, 'rounded');

	// Update to 'double'
	updateShapeInHook('double');
	resetPreferencesCache();

	// Should now return 'double'
	result = getInitialTitleShape();
	t.is(result, 'double');
});
