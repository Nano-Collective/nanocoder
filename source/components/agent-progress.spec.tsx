import test from 'ava';
import React from 'react';
import {renderWithTheme} from '../test-utils/render-with-theme.js';
import AgentProgress from './agent-progress.js';

test('AgentProgress renders a string description', t => {
	const {lastFrame} = renderWithTheme(
		React.createElement(AgentProgress, {
			subagentName: 'explorer',
			description: 'investigate the auth flow',
		}),
	);
	t.regex(lastFrame()!, /investigate the auth flow/);
	t.regex(lastFrame()!, /explorer/);
});

// Regression: a weak model can emit the agent tool's `description` arg as a
// non-string (e.g. a nested object). That must not crash the renderer — it
// previously surfaced as "Objects are not valid as a React child (found:
// object with keys {description})" and took down the whole TUI.
test('AgentProgress does not crash when description is a non-string object', t => {
	t.notThrows(() => {
		const {lastFrame} = renderWithTheme(
			React.createElement(AgentProgress, {
				subagentName: 'explorer',
				description: {description: 'nested'} as unknown as string,
			}),
		);
		lastFrame();
	});
});

test('AgentProgress does not crash when description is undefined', t => {
	t.notThrows(() => {
		const {lastFrame} = renderWithTheme(
			React.createElement(AgentProgress, {
				subagentName: 'explorer',
				description: undefined as unknown as string,
			}),
		);
		lastFrame();
	});
});
