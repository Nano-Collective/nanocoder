import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {getColors} from '@/config/index';
import {DiffDisplay} from './diff-display';

test('should render simple diff with context', t => {
	const oldLines = ['line 1', 'line 2'];
	const newLines = ['line 1', 'replaced'];
	const contextBeforeLines = [{lineNum: 1, content: 'const x = 1;'}];
	const contextAfterLines = [{lineNum: 5, content: 'return x;'}];

	const {lastFrame} = render(
		<DiffDisplay
			oldLines={oldLines}
			newLines={newLines}
			startLine={2}
			contextBeforeLines={contextBeforeLines}
			contextAfterLines={contextAfterLines}
			themeColors={getColors()}
			language="typescript"
		/>,
	);

	t.truthy(lastFrame());
	t.not(lastFrame(), '');
});

test('should render added lines', t => {
	const oldLines: string[] = [];
	const newLines = ['new line 1', 'new line 2'];
	const contextBeforeLines = [];
	const contextAfterLines = [];

	const {lastFrame} = render(
		<DiffDisplay
			oldLines={oldLines}
			newLines={newLines}
			startLine={1}
			contextBeforeLines={contextBeforeLines}
			contextAfterLines={contextAfterLines}
			themeColors={getColors()}
			language="plaintext"
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
});

test('should render removed lines', t => {
	const oldLines = ['removed line 1', 'removed line 2'];
	const newLines: string[] = [];
	const contextBeforeLines = [];
	const contextAfterLines = [];

	const {lastFrame} = render(
		<DiffDisplay
			oldLines={oldLines}
			newLines={newLines}
			startLine={1}
			contextBeforeLines={contextBeforeLines}
			contextAfterLines={contextAfterLines}
			themeColors={getColors()}
			language="plaintext"
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
});

test('should render mixed diff with added, removed, and unchanged', t => {
	const oldLines = ['keep 1', 'remove', 'keep 2'];
	const newLines = ['keep 1', 'add', 'keep 2'];
	const contextBeforeLines = [];
	const contextAfterLines = [];

	const {lastFrame} = render(
		<DiffDisplay
			oldLines={oldLines}
			newLines={newLines}
			startLine={1}
			contextBeforeLines={contextBeforeLines}
			contextAfterLines={contextAfterLines}
			themeColors={getColors()}
			language="plaintext"
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
});

test('should render empty diff', t => {
	const oldLines: string[] = [];
	const newLines: string[] = [];
	const contextBeforeLines = [];
	const contextAfterLines = [];

	const {lastFrame} = render(
		<DiffDisplay
			oldLines={oldLines}
			newLines={newLines}
			startLine={1}
			contextBeforeLines={contextBeforeLines}
			contextAfterLines={contextAfterLines}
			themeColors={getColors()}
			language="plaintext"
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
});