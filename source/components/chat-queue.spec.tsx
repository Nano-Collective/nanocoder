import test from 'ava';
import {Box} from 'ink';
import {render} from 'ink-testing-library';
import React from 'react';
import ChatQueue from './chat-queue';

test('ChatQueue renders without components', t => {
	t.notThrows(() => {
		render(<ChatQueue staticComponents={[]} queuedComponents={[]} />);
	});
});

test('ChatQueue renders with static components', t => {
	const components = [
		<Box key="1">First message</Box>,
		<Box key="2">Second message</Box>,
	];

	t.notThrows(() => {
		render(<ChatQueue staticComponents={components} queuedComponents={[]} />);
	});
});

test('ChatQueue renders with queued components', t => {
	const components = [
		<Box key="1">Queued message</Box>,
	];

	t.notThrows(() => {
		render(<ChatQueue staticComponents={[]} queuedComponents={components} />);
	});
});

test('ChatQueue renders with both static and queued components', t => {
	const staticComponents = [
		<Box key="1">Static message</Box>,
	];
	const queuedComponents = [
		<Box key="2">Queued message</Box>,
	];

	t.notThrows(() => {
		render(
			<ChatQueue staticComponents={staticComponents} queuedComponents={queuedComponents} />,
		);
	});
});

test('ChatQueue merges static and queued components', t => {
	const {lastFrame} = render(
		<ChatQueue
			staticComponents={[<Box key="1">Static</Box>]}
			queuedComponents={[<Box key="2">Queued</Box>]}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
});

test('ChatQueue can render the last queued component outside Static', t => {
	const {lastFrame, rerender} = render(
		<ChatQueue
			queuedComponents={[
				<Box key="frozen">Frozen queued message</Box>,
				<Box key="live">Recallable queued message</Box>,
			]}
			renderLastQueuedComponentLive
		/>,
	);

	t.regex(lastFrame() ?? '', /Frozen queued message/);
	t.regex(lastFrame() ?? '', /Recallable queued message/);

	rerender(
		<ChatQueue
			queuedComponents={[<Box key="frozen">Frozen queued message</Box>]}
			renderLastQueuedComponentLive
		/>,
	);

	t.regex(lastFrame() ?? '', /Frozen queued message/);
	t.notRegex(lastFrame() ?? '', /Recallable queued message/);
});

test('ChatQueue component can be unmounted', t => {
	const {unmount} = render(<ChatQueue staticComponents={[]} queuedComponents={[]} />);

	t.notThrows(() => {
		unmount();
	});
});

test('ChatQueue re-renders without crashing', t => {
	const {rerender} = render(<ChatQueue staticComponents={[]} queuedComponents={[]} />);

	t.notThrows(() => {
		rerender(<ChatQueue staticComponents={[]} queuedComponents={[]} />);
	});
});

test('ChatQueue handles components without keys', t => {
	const components = [<Box key="1">No key component</Box>];

	t.notThrows(() => {
		render(<ChatQueue staticComponents={components} queuedComponents={[]} />);
	});
});

test('ChatQueue generates default key for component without key prop', t => {
	// Component without a key prop - should use fallback `static-${index}`
	const ComponentWithoutKey = () => <Box>No key</Box>;
	// Add the component without a React key prop
	const components = [<ComponentWithoutKey />];

	t.notThrows(() => {
		render(<ChatQueue staticComponents={components} queuedComponents={[]} />);
	});
});
