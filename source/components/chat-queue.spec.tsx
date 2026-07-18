import test from 'ava';
import {Box, Text} from 'ink';
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

// ============================================================================
// Fullscreen (disableStatic) path — used on the alt screen where Ink's
// <Static> has no native scrollback to print into.
// ============================================================================

test('disableStatic renders staticComponents in regular flow instead of Static', t => {
	const {lastFrame} = render(
		<ChatQueue
			staticComponents={[<Box key="1">Flow message</Box>]}
			queuedComponents={[]}
			disableStatic
		/>,
	);
	t.regex(lastFrame() ?? '', /Flow message/);
});

test('disableStatic still renders the live (last-queued) component below the flow', t => {
	const {lastFrame} = render(
		<ChatQueue
			staticComponents={[]}
			queuedComponents={[
				<Box key="frozen">Frozen part</Box>,
				<Box key="live">Live part</Box>,
			]}
			renderLastQueuedComponentLive
			disableStatic
		/>,
	);
	const output = lastFrame() ?? '';
	t.regex(output, /Frozen part/);
	t.regex(output, /Live part/);
});

test('disableStatic caps the rendered tail at FULLSCREEN_TAIL_CAP (60) components', t => {
	// 70 numbered items; only the last 60 (indices 10..69) should survive.
	const components = Array.from({length: 70}, (_, i) => (
		<Box key={`item-${i}`}>{`item-${i}`}</Box>
	));

	const {lastFrame} = render(
		<ChatQueue
			staticComponents={components}
			queuedComponents={[]}
			disableStatic
		/>,
	);
	const output = lastFrame() ?? '';

	t.false(output.includes('item-9\n') || /item-9$/.test(output));
	t.notRegex(output, /\bitem-0\b/);
	t.notRegex(output, /\bitem-9\b/);
	t.regex(output, /\bitem-10\b/);
	t.regex(output, /\bitem-69\b/);
});

test('disableStatic with fewer than 60 components renders all of them untouched', t => {
	const components = Array.from({length: 5}, (_, i) => (
		<Box key={`short-${i}`}>{`short-${i}`}</Box>
	));
	const {lastFrame} = render(
		<ChatQueue
			staticComponents={components}
			queuedComponents={[]}
			disableStatic
		/>,
	);
	const output = lastFrame() ?? '';
	for (let i = 0; i < 5; i++) {
		t.regex(output, new RegExp(`\\bshort-${i}\\b`));
	}
});

test('disableStatic falls back to `flow-${index}` key for components without a key', t => {
	const NoKeyComponent = () => <Box>anonymous flow item</Box>;
	t.notThrows(() => {
		render(
			<ChatQueue
				staticComponents={[<NoKeyComponent />]}
				queuedComponents={[]}
				disableStatic
			/>,
		);
	});
});

test('disableStatic renders nothing extra when both component lists are empty', t => {
	const {lastFrame} = render(
		<ChatQueue staticComponents={[]} queuedComponents={[]} disableStatic />,
	);
	t.is(lastFrame(), '');
});

// ============================================================================
// clearKey — forces a fresh Ink <Static> instance on /clear
// ============================================================================

const tick = () => new Promise(resolve => setTimeout(resolve, 30));

test('changing clearKey remounts the Static-backed content (component key changes across renders)', async t => {
	let mountCount = 0;
	const TrackMount = () => {
		React.useEffect(() => {
			mountCount++;
		}, []);
		return <Text>tracked</Text>;
	};

	const {rerender} = render(
		<ChatQueue
			staticComponents={[<TrackMount key="tracked" />]}
			queuedComponents={[]}
			clearKey="session-1"
		/>,
	);
	await tick();
	t.is(mountCount, 1);

	rerender(
		<ChatQueue
			staticComponents={[<TrackMount key="tracked" />]}
			queuedComponents={[]}
			clearKey="session-2"
		/>,
	);
	await tick();
	t.is(mountCount, 2);
});

test('same clearKey across rerenders does not remount the Static content', async t => {
	let mountCount = 0;
	const TrackMount = () => {
		React.useEffect(() => {
			mountCount++;
		}, []);
		return <Text>tracked</Text>;
	};

	const {rerender} = render(
		<ChatQueue
			staticComponents={[<TrackMount key="tracked" />]}
			queuedComponents={[]}
			clearKey="stable"
		/>,
	);
	await tick();
	t.is(mountCount, 1);

	rerender(
		<ChatQueue
			staticComponents={[<TrackMount key="tracked" />]}
			queuedComponents={[]}
			clearKey="stable"
		/>,
	);
	await tick();
	t.is(mountCount, 1);
});
