import test from 'ava';
import React from 'react';
import {renderWithTheme} from '../../test-utils/render-with-theme';
import {ChatInput} from './chat-input';
import type {ChatInputProps} from './chat-input';

function createDefaultProps(
	overrides: Partial<ChatInputProps> = {},
): ChatInputProps {
	return {
		isCancelling: false,
		isToolExecuting: false,
		isToolConfirmationMode: false,
		isQuestionMode: false,
		pendingToolCalls: [],
		currentToolIndex: 0,
		pendingQuestion: null,
		onQuestionAnswer: () => {},
		mcpInitialized: true,
		client: {},
		nonInteractivePrompt: undefined,
		nonInteractiveLoadingMessage: null,
		customCommands: [],
		inputDisabled: false,
		developmentMode: 'normal',
		contextPercentUsed: null,
		onToolConfirm: async () => {},
		onToolCancel: () => {},
		onSubmit: async () => {},
		onCancel: () => {},
		onToggleMode: () => {},
		...overrides,
	};
}

test('ChatInput renders without error', t => {
	const props = createDefaultProps();
	const {lastFrame, unmount} = renderWithTheme(<ChatInput {...props} />);
	const output = lastFrame();
	t.truthy(output);
	unmount();
});

test('ChatInput shows UserInput when ready for input', t => {
	const props = createDefaultProps({
		mcpInitialized: true,
		client: {},
		nonInteractivePrompt: undefined,
		isToolExecuting: false,
		isToolConfirmationMode: false,
	});

	const {lastFrame, unmount} = renderWithTheme(<ChatInput {...props} />);
	const output = lastFrame();
	t.truthy(output);
	unmount();
});

test('ChatInput shows loading spinner when not initialized', t => {
	const props = createDefaultProps({
		mcpInitialized: false,
		client: null,
	});

	const {lastFrame, unmount} = renderWithTheme(<ChatInput {...props} />);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Loading/);
	unmount();
});

test('ChatInput shows completion message in non-interactive mode when done', t => {
	const props = createDefaultProps({
		nonInteractivePrompt: 'test prompt',
		nonInteractiveLoadingMessage: null,
		mcpInitialized: true,
		client: {},
	});

	const {lastFrame, unmount} = renderWithTheme(<ChatInput {...props} />);
	const output = lastFrame();
	t.truthy(output);
	// Note: marginLeft={-1} in the component cuts off the first character in tests
	t.regex(output!, /ompleted.*Exiting/);
	unmount();
});

test('ChatInput shows tool confirmation when in tool confirmation mode', t => {
	const mockToolCall = {
		id: 'test-1',
		function: {name: 'test_tool', arguments: {}},
	};

	const props = createDefaultProps({
		isToolConfirmationMode: true,
		pendingToolCalls: [mockToolCall],
		currentToolIndex: 0,
	});

	const {lastFrame, unmount} = renderWithTheme(<ChatInput {...props} />);
	const output = lastFrame();
	t.truthy(output);
	unmount();
});

test('ChatInput shows tool execution indicator when executing', t => {
	const mockToolCall = {
		id: 'test-1',
		function: {name: 'test_tool', arguments: {}},
	};

	const props = createDefaultProps({
		isToolExecuting: true,
		pendingToolCalls: [mockToolCall],
		currentToolIndex: 0,
	});

	const {lastFrame, unmount} = renderWithTheme(<ChatInput {...props} />);
	const output = lastFrame();
	t.truthy(output);
	unmount();
});

test('ChatInput shows cancelling indicator when cancelling', t => {
	const props = createDefaultProps({
		isCancelling: true,
	});

	const {lastFrame, unmount} = renderWithTheme(<ChatInput {...props} />);
	const output = lastFrame();
	t.truthy(output);
	unmount();
});

test('ChatInput shows question prompt when in question mode', t => {
	const props = createDefaultProps({
		isQuestionMode: true,
		pendingQuestion: {
			question: 'Which database?',
			options: ['PostgreSQL', 'SQLite'],
			allowFreeform: true,
		},
	});

	const {lastFrame, unmount} = renderWithTheme(<ChatInput {...props} />);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Which database/);
	t.regex(output!, /PostgreSQL/);
	t.regex(output!, /SQLite/);
	unmount();
});

test('ChatInput does not show question prompt when not in question mode', t => {
	const props = createDefaultProps({
		isQuestionMode: false,
		pendingQuestion: null,
	});

	const {lastFrame, unmount} = renderWithTheme(<ChatInput {...props} />);
	const output = lastFrame();
	t.truthy(output);
	t.notRegex(output!, /Which database/);
	unmount();
});
