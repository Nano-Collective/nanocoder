import test from 'ava';
import {Text} from 'ink';
import React from 'react';
import stripAnsi from 'strip-ansi';
import ToolConfirmation from '@/components/tool-confirmation';
import {setToolManagerGetter} from '@/message-handler';
import {renderWithTheme} from '@/test-utils/render-with-theme';
import type {ToolCall} from '@/types/core';

test.afterEach(() => {
	setToolManagerGetter(() => null);
});

test('ToolConfirmation hides approval prompt while loading preview', async t => {
	let resolveFormatter: (value: any) => void;
	const formatterPromise = new Promise(resolve => {
		resolveFormatter = resolve;
	});

	const mockToolManager = {
		getMCPToolInfo: () => ({isMCPTool: false}),
		getToolEntry: () => ({tool: {}}),
		getToolValidator: () => undefined,
		getToolFormatter: () => () => formatterPromise,
	};

	setToolManagerGetter(() => mockToolManager as any);

	const toolCall: ToolCall = {
		type: 'function',
		id: 'call_1',
		function: {
			name: 'slow_tool',
			arguments: '{}',
		},
	};

	const {lastFrame, unmount} = renderWithTheme(
		<ToolConfirmation
			toolCall={toolCall}
			onConfirm={() => {}}
			onCancel={() => {}}
		/>,
	);

	// Wait one tick for useEffect to fire and set isLoadingPreview=true
	await new Promise(resolve => setTimeout(resolve, 0));

	// Initial render should show "Loading preview..." and NOT show the approval prompt
	const loadingFrame = stripAnsi(lastFrame() ?? '');
	t.regex(loadingFrame, /Loading preview.../);
	t.notRegex(loadingFrame, /Do you want to execute tool/);
	t.notRegex(loadingFrame, /Yes, execute this tool/);

	// Resolve the formatter
	resolveFormatter!(<Text>Loaded Preview</Text>);

	// Wait for promises to settle
	await new Promise(resolve => setTimeout(resolve, 0));

	// Now it should show the preview and the approval prompt
	const loadedFrame = stripAnsi(lastFrame() ?? '');
	t.notRegex(loadedFrame, /Loading preview.../);
	t.regex(loadedFrame, /Loaded Preview/);
	t.regex(loadedFrame, /Do you want to execute tool "slow_tool"\?/);
	t.regex(loadedFrame, /Yes, execute this tool/);

	unmount();
});
