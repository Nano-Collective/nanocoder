import test from 'ava';
import type {Key} from 'ink';
import {render} from 'ink-testing-library';
import React from 'react';
import {
	SHORTCUTS_OVERHEAD_ROWS,
	useShortcutsOverlay,
} from './useShortcutsOverlay.js';

type Overlay = ReturnType<typeof useShortcutsOverlay>;

const noKey = {
	upArrow: false,
	downArrow: false,
	pageUp: false,
	pageDown: false,
	escape: false,
} as Key;

function Probe({
	onOpenChange,
	rowCount,
	capture,
}: {
	onOpenChange?: (open: boolean) => void;
	rowCount: number;
	capture: (overlay: Overlay) => void;
}) {
	capture(useShortcutsOverlay(onOpenChange, rowCount));
	return null;
}

function setup(rows: number, rowCount = 30) {
	const original = process.stdout.rows;
	process.stdout.rows = rows;
	const events: boolean[] = [];
	let overlay!: Overlay;
	const view = render(
		<Probe
			rowCount={rowCount}
			onOpenChange={open => events.push(open)}
			capture={o => {
				overlay = o;
			}}
		/>,
	);
	const act = async (fn: (o: Overlay) => void) => {
		fn(overlay);
		await new Promise(resolve => setTimeout(resolve, 20));
	};
	return {
		events,
		get overlay() {
			return overlay;
		},
		act,
		cleanup: () => {
			view.unmount();
			process.stdout.rows = original;
		},
	};
}

test.serial('opens and closes, reporting each change and keeping isOpenNow in step', async t => {
	const s = setup(40);
	t.teardown(s.cleanup);

	t.false(s.overlay.isOpen);
	await s.act(o => o.setOpen(true));
	t.true(s.overlay.isOpen);
	t.true(s.overlay.isOpenNow());

	await s.act(o => o.handleKey({...noKey, escape: true}));
	t.false(s.overlay.isOpen);
	t.false(s.overlay.isOpenNow());
	t.deepEqual(s.events, [true, false]);
});

test.serial('reports the overlay closed when unmounted while open', async t => {
	const s = setup(40);
	await s.act(o => o.setOpen(true));
	s.cleanup();
	t.deepEqual(s.events, [true, false]);
});

test.serial('sizes the window to the terminal and clamps scrolling to it', async t => {
	const rows = 20;
	const rowCount = 30;
	const s = setup(rows, rowCount);
	t.teardown(s.cleanup);

	const visible = rows - SHORTCUTS_OVERHEAD_ROWS;
	await s.act(o => o.setOpen(true));
	t.deepEqual(s.overlay.view, {
		start: 0,
		visibleCount: visible,
		maxStart: rowCount - visible,
	});

	await s.act(o => o.handleKey({...noKey, downArrow: true}));
	t.is(s.overlay.view.start, 1);
	await s.act(o => o.handleKey({...noKey, upArrow: true}));
	await s.act(o => o.handleKey({...noKey, upArrow: true}));
	t.is(s.overlay.view.start, 0);

	for (let i = 0; i < 5; i++) {
		await s.act(o => o.handleKey({...noKey, pageDown: true}));
	}
	t.is(s.overlay.view.start, rowCount - visible);
	await s.act(o => o.handleKey({...noKey, pageUp: true}));
	t.is(s.overlay.view.start, rowCount - 2 * visible);

	// Reopening starts from the top.
	await s.act(o => o.setOpen(false));
	await s.act(o => o.setOpen(true));
	t.is(s.overlay.view.start, 0);
});

test.serial('every row fits without scrolling on a tall terminal', async t => {
	const s = setup(100, 10);
	t.teardown(s.cleanup);

	t.deepEqual(s.overlay.view, {start: 0, visibleCount: 10, maxStart: 0});
	await s.act(o => o.handleKey({...noKey, pageDown: true}));
	t.is(s.overlay.view.start, 0);
});
