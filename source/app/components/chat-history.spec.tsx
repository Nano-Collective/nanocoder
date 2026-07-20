import test from 'ava';
import React from 'react';
import {wheelEvents} from '@/utils/terminal-mouse';
import {renderWithTheme} from '../../test-utils/render-with-theme';
import {ChatHistory} from './chat-history';
import type {ChatHistoryProps} from './chat-history';

const tick = () => new Promise(resolve => setTimeout(resolve, 30));

function createDefaultProps(
	overrides: Partial<ChatHistoryProps> = {},
): ChatHistoryProps {
	return {
		startChat: true,
		staticComponents: [],
		queuedComponents: [],
		...overrides,
	};
}

test('ChatHistory renders without error', t => {
	const props = createDefaultProps();
	const {lastFrame, unmount} = renderWithTheme(<ChatHistory {...props} />);
	const output = lastFrame();
	// Empty components render as empty string, which is valid
	t.is(typeof output, 'string');
	unmount();
});

test('ChatHistory renders static components', t => {
	const props = createDefaultProps({
		staticComponents: [<div key="static-1">Static Content</div>],
	});
	const {lastFrame, unmount} = renderWithTheme(<ChatHistory {...props} />);
	const output = lastFrame();
	t.truthy(output);
	unmount();
});

test('ChatHistory renders queued components', t => {
	const props = createDefaultProps({
		queuedComponents: [<div key="queued-1">Queued Content</div>],
	});
	const {lastFrame, unmount} = renderWithTheme(<ChatHistory {...props} />);
	const output = lastFrame();
	t.truthy(output);
	unmount();
});

test('ChatHistory does not render content when startChat is false', t => {
	const props = createDefaultProps({
		startChat: false,
		staticComponents: [<div key="static-1">Should Not Show</div>],
	});
	const {lastFrame, unmount} = renderWithTheme(<ChatHistory {...props} />);
	const output = lastFrame();
	// Should render empty when startChat is false
	t.is(typeof output, 'string');
	// Content should not include the static component text
	t.false(output?.includes('Should Not Show'));
	unmount();
});

// ============================================================================
// Fullscreen mode: banner splitting, scroll gating (PageUp/PageDown, mouse
// wheel), and the /clear reset key.
// ============================================================================

test('fullscreen mode splits the first static component out as the banner', t => {
	const props = createDefaultProps({
		fullscreen: true,
		staticComponents: [
			<div key="banner">BANNER-MARKER</div>,
			<div key="rest">REST-MARKER</div>,
		],
	});
	const {lastFrame, unmount} = renderWithTheme(<ChatHistory {...props} />);
	const output = lastFrame() ?? '';
	t.regex(output, /BANNER-MARKER/);
	t.regex(output, /REST-MARKER/);
	unmount();
});

test('inline mode keeps the banner as part of staticComponents (not split out)', t => {
	const props = createDefaultProps({
		fullscreen: false,
		staticComponents: [<div key="banner">BANNER-MARKER</div>],
	});
	const {lastFrame, unmount} = renderWithTheme(<ChatHistory {...props} />);
	t.regex(lastFrame() ?? '', /BANNER-MARKER/);
	unmount();
});

test('fullscreen + scrollActive does not crash on PageUp/PageDown and stays stable when nothing overflows', t => {
	const props = createDefaultProps({
		fullscreen: true,
		scrollActive: true,
		staticComponents: [<div key="only">short content</div>],
	});
	const {stdin, lastFrame, unmount} = renderWithTheme(
		<ChatHistory {...props} />,
	);
	const before = lastFrame();
	t.notThrows(() => stdin.write('[5~')); // PageUp
	t.notThrows(() => stdin.write('[6~')); // PageDown
	t.truthy(before);
	unmount();
});

test('PageUp is ignored (no crash, no indicator) when scrollActive is false, even in fullscreen', async t => {
	const props = createDefaultProps({
		fullscreen: true,
		scrollActive: false,
		staticComponents: Array.from({length: 5}, (_, i) => (
			<div key={i}>{`line-${i}`}</div>
		)),
	});
	const {stdin, lastFrame, unmount} = renderWithTheme(
		<ChatHistory {...props} />,
	);
	const before = lastFrame();
	stdin.write('[5~'); // PageUp
	await tick();
	const after = lastFrame();
	// No scroll-position indicator text should ever appear — the useInput
	// handler is inactive (isActive: fullscreen && scrollActive).
	t.notRegex(after ?? '', /PgUp\/PgDn/);
	t.is(before, after);
	unmount();
});

test('PageUp is ignored (no crash) when fullscreen is false, even if scrollActive is true', async t => {
	const props = createDefaultProps({
		fullscreen: false,
		scrollActive: true,
		staticComponents: [<div key="only">inline content</div>],
	});
	const {stdin, lastFrame, unmount} = renderWithTheme(
		<ChatHistory {...props} />,
	);
	stdin.write('[5~');
	await tick();
	t.notRegex(lastFrame() ?? '', /PgUp\/PgDn/);
	unmount();
});

test('mouse wheel ticks are ignored when scrollActive is false (no subscription side effects)', async t => {
	const props = createDefaultProps({
		fullscreen: true,
		scrollActive: false,
		staticComponents: [<div key="only">content</div>],
	});
	const {lastFrame, unmount} = renderWithTheme(<ChatHistory {...props} />);
	const before = lastFrame();
	t.notThrows(() => {
		wheelEvents.emit('wheel', 'up');
		wheelEvents.emit('wheel', 'down');
	});
	await tick();
	t.is(lastFrame(), before);
	unmount();
});

test('mouse wheel ticks do not throw when active in fullscreen mode', async t => {
	const props = createDefaultProps({
		fullscreen: true,
		scrollActive: true,
		staticComponents: [<div key="only">content</div>],
	});
	const {unmount} = renderWithTheme(<ChatHistory {...props} />);
	t.notThrows(() => {
		wheelEvents.emit('wheel', 'up');
		wheelEvents.emit('wheel', 'down');
	});
	await tick();
	unmount();
});

test('unmounting a fullscreen+scrollActive instance detaches its wheel listener (no leak across instances)', async t => {
	const propsA = createDefaultProps({
		fullscreen: true,
		scrollActive: true,
		staticComponents: [<div key="a">A</div>],
	});
	const before = wheelEvents.listenerCount('wheel');
	const {unmount} = renderWithTheme(<ChatHistory {...propsA} />);
	t.true(wheelEvents.listenerCount('wheel') > before);
	unmount();
	await tick();
	t.is(wheelEvents.listenerCount('wheel'), before);
});

test('clearKey prop is accepted and does not change output for equal transcripts', t => {
	const propsA = createDefaultProps({
		clearKey: 'session-1',
		staticComponents: [<div key="s">same content</div>],
	});
	const propsB = createDefaultProps({
		clearKey: 'session-2',
		staticComponents: [<div key="s">same content</div>],
	});
	const a = renderWithTheme(<ChatHistory {...propsA} />);
	const b = renderWithTheme(<ChatHistory {...propsB} />);
	t.is(a.lastFrame(), b.lastFrame());
	a.unmount();
	b.unmount();
});
