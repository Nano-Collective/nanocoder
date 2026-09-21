import {render} from 'ink-testing-library';
import test from 'ava';
import React from 'react';
import {defaultTheme, themes} from '@/config/themes';
import {ThemeContext} from '@/hooks/useTheme';
import {TitleShapeContext} from '@/hooks/useTitleShape';
import {SettingsTitleShapePanel} from './settings-selector';

console.log('\nsettings-title-shape.spec.tsx');

interface TitleShapeLogs {
	previewCalls: string[];
	commitCalls: string[];
}

// Render the Title Shape panel with an instrumented TitleShapeContext so tests
// can observe which path (preview-only setter vs persist setter) each key
// triggers. This is the regression guard for the cancel bug: navigating and
// pressing Esc must preview/revert without ever persisting, while Enter commits.
function setupPanel(logs: TitleShapeLogs) {
	const {stdin, unmount} = render(
		<ThemeContext.Provider
			value={{
				currentTheme: defaultTheme,
				colors: themes[defaultTheme].colors,
				setCurrentTheme: () => {},
			}}
		>
			<TitleShapeContext.Provider
				value={{
					currentTitleShape: 'pill',
					setCurrentTitleShape: (shape: string) => {
						logs.previewCalls.push(shape);
					},
					commitTitleShape: (shape: string) => {
						logs.commitCalls.push(shape);
					},
				}}
			>
				<SettingsTitleShapePanel onBack={() => {}} onCancel={() => {}} />
			</TitleShapeContext.Provider>
		</ThemeContext.Provider>,
	);
	return {stdin, unmount};
}

const press = (stdin: ReturnType<typeof setupPanel>['stdin'], key: string) =>
	new Promise<void>(resolve => {
		stdin.write(key);
		setTimeout(resolve, 50);
	});

test('navigating the title-shape list previews without persisting', async t => {
	const logs = {previewCalls: [], commitCalls: []} as TitleShapeLogs;
	const {stdin, unmount} = setupPanel(logs);

	// Move down once: the new item is highlighted, which in the fixed code
	// calls setCurrentTitleShape (preview) and never commitTitleShape.
	await press(stdin, '\u001B[B');

	t.deepEqual(logs.previewCalls, ['rounded']);
	t.is(logs.commitCalls.length, 0);
	unmount();
});

test('Esc cancels and reverts the preview without persisting', async t => {
	const logs = {previewCalls: [], commitCalls: []} as TitleShapeLogs;
	const {stdin, unmount} = setupPanel(logs);

	// Navigate down (preview 'rounded'), then press Esc to cancel.
	await press(stdin, '\u001B[B');
	await press(stdin, '\u001B');

	// Esc reverts the in-memory preview back to the original shape and never
	// persists.
	t.deepEqual(logs.previewCalls, ['rounded', 'pill']);
	t.is(logs.commitCalls.length, 0);
	unmount();
});

test('Enter confirms via the commit (persistence) path', async t => {
	const logs = {previewCalls: [], commitCalls: []} as TitleShapeLogs;
	const {stdin, unmount} = setupPanel(logs);

	// Navigate down (preview 'rounded'), then press Enter to confirm.
	await press(stdin, '\u001B[B');
	await press(stdin, '\r');

	// Confirming commits the highlighted shape (persist) on top of the preview.
	t.deepEqual(logs.previewCalls, ['rounded']);
	t.deepEqual(logs.commitCalls, ['rounded']);
	unmount();
});
