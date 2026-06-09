import {render} from 'ink-testing-library';
import test from 'ava';
import {Text} from 'ink';
import React from 'react';
import {RenderErrorBoundary} from './render-error-boundary.js';

void React; // JSX runtime requires React in scope

function Boom(): React.ReactElement {
	throw new Error('kaboom');
}

test('renders children unchanged when they do not throw', t => {
	const {lastFrame} = render(
		<RenderErrorBoundary>
			<Text>hello world</Text>
		</RenderErrorBoundary>,
	);
	t.regex(lastFrame()!, /hello world/);
	t.notRegex(lastFrame()!, /Could not render/);
});

test('catches a throwing child and shows a fallback instead of crashing', t => {
	t.notThrows(() => {
		const {lastFrame} = render(
			<RenderErrorBoundary label="bash">
				<Boom />
			</RenderErrorBoundary>,
		);
		t.regex(lastFrame()!, /Could not render/);
		t.regex(lastFrame()!, /bash/);
	});
});

// Reproduces the exact crash that took down the TUI: a malformed model tool
// arg surfaced as a raw object child ("object with keys {description}").
test('catches a raw object rendered as a child', t => {
	t.notThrows(() => {
		const bad = {description: 'x'} as unknown as React.ReactNode;
		const {lastFrame} = render(<RenderErrorBoundary>{bad}</RenderErrorBoundary>);
		t.regex(lastFrame()!, /Could not render/);
	});
});
