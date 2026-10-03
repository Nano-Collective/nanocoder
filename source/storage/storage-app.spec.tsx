import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import stripAnsi from 'strip-ansi';
import type {StorageReport} from './diagnostics.js';
import {StorageApp} from './storage-app.js';

const report: StorageReport = {
	version: 1,
	scannedAt: '2026-01-01T00:00:00Z',
	projectRoot: '/project',
	sections: {
		sessions: {
			scope: 'global', root: '/data/sessions', count: 1, sizeBytes: 2048,
			limits: [{label: 'Retention', value: '30 days'}],
			items: [{name: 'session-a', path: '/data/sessions/a', sizeBytes: 2048, modifiedAt: '2026-01-01', status: 'warning', detail: 'stale'}],
			findings: [{code: 'stale', message: 'Old session', path: '/data/sessions/a', severity: 'warning'}],
		},
		artifacts: {scope: 'global', root: '/data/artifacts', count: 0, sizeBytes: 0, items: [], findings: []},
		timeline: {scope: 'project', root: '/project/timeline', count: 0, sizeBytes: 0, items: [], findings: []},
		checkpoints: {scope: 'project', root: '/project/checkpoints', count: 0, sizeBytes: 0, items: [], findings: []},
	},
};

const settle = () => new Promise(resolve => setTimeout(resolve, 40));

test('storage overview, section navigation, item and finding details, and back', async t => {
	const view = render(<StorageApp report={report} />);
	try {
		t.regex(view.lastFrame()!, /Nanocoder storage/);
		t.regex(view.lastFrame()!, /READ-ONLY/);
		t.regex(view.lastFrame()!, /Stores/);
		t.true(view.lastFrame()!.split('\n').length <= 24);
		t.regex(view.lastFrame()!, /Sessions \[global\]/);
		t.regex(view.lastFrame()!, /artifacts · 0 B/);
		t.regex(view.lastFrame()!, /\/data\/sessions/);
		view.stdin.write('\r');
		await settle();
		t.true(view.lastFrame()!.split('\n').length <= 24);
		t.regex(view.lastFrame()!, /Retention: 30 days/);
		view.stdin.write('\r');
		await settle();
		t.regex(view.lastFrame()!, /Path: \/data\/sessions\/a/);
		t.regex(view.lastFrame()!, /Detail: stale/);
		view.stdin.write('\x1b');
		await settle();
		view.stdin.write('\x1b[B');
		await settle();
		view.stdin.write('\r');
		await settle();
		t.regex(view.lastFrame()!, /Finding · stale/);
		t.regex(view.lastFrame()!, /Old session/);
		view.stdin.write('\x1b');
		await settle();
		view.stdin.write('\x1b');
		await settle();
		t.regex(view.lastFrame()!, /Enter Explore/);
	} finally {
		view.unmount();
	}
});

test('long sections keep the selected entry visible in the list', async t => {
	const items = Array.from({length: 20}, (_, index) => ({
		name: `session-${index}`,
		path: `/data/sessions/${index}`,
		sizeBytes: index,
		status: 'ok' as const,
	}));
	const longReport: StorageReport = {
		...report,
		sections: {
			...report.sections,
			sessions: {...report.sections.sessions, items, count: items.length, findings: []},
		},
	};
	const view = render(<StorageApp report={longReport} />);
	try {
		view.stdin.write('\r');
		await settle();
		t.true(view.lastFrame()!.split('\n').length <= 24);
		for (let index = 0; index < 14; index++) {
			view.stdin.write('\x1b[B');
			await settle();
		}
		t.regex(view.lastFrame()!, /❯ ITEM session-14/);
		t.regex(view.lastFrame()!, /Showing .* of 20/);
		t.notRegex(view.lastFrame()!, /ITEM session-0 /);
	} finally {
		view.unmount();
	}
});

test('narrow terminals stack panes and preserve navigation', async t => {
	const view = render(<StorageApp report={report} />);
	try {
		Object.defineProperty(view.stdout, 'columns', {value: 60, configurable: true});
		Object.defineProperty(view.stdout, 'rows', {value: 24, configurable: true});
		view.stdout.emit('resize');
		await settle();
		t.true(view.lastFrame()!.split('\n').length <= 24);
		t.regex(view.lastFrame()!, /Stores/);
		t.regex(view.lastFrame()!, /Sessions \[global\]/);
		t.regex(view.lastFrame()!, /Root: \/data\/sessions/);
		view.stdin.write('\r');
		await settle();
		view.stdin.write('\r');
		await settle();
		t.regex(view.lastFrame()!, /Item · session-a/);
		t.true(view.lastFrame()!.split('\n').length <= 24);
	} finally {
		view.unmount();
	}
});

test('an 80 by 24 terminal renders one full dashboard frame', async t => {
	const view = render(<StorageApp report={report} />);
	try {
		Object.defineProperty(view.stdout, 'columns', {value: 80, configurable: true});
		Object.defineProperty(view.stdout, 'rows', {value: 24, configurable: true});
		view.stdout.emit('resize');
		await settle();
		const frame = stripAnsi(view.lastFrame()!);
		const lines = frame.split('\n');
		t.is(lines.length, 24);
		t.true(lines[0]?.startsWith('╭'));
		t.regex(lines[1]!, /Nanocoder storage.*READ-ONLY/);
		t.regex(lines[4]!, /Stores\s+│ Sessions \[global\]/);
		t.regex(lines[22]!, /Enter Explore/);
		t.true(lines[23]?.startsWith('╰'));
	} finally {
		view.unmount();
	}
});

test('short terminals show a bounded section selector', async t => {
	const view = render(<StorageApp report={report} />);
	try {
		Object.defineProperty(view.stdout, 'columns', {value: 80, configurable: true});
		Object.defineProperty(view.stdout, 'rows', {value: 14, configurable: true});
		view.stdout.emit('resize');
		await settle();
		t.true(view.lastFrame()!.split('\n').length <= 14);
		t.regex(view.lastFrame()!, /checkpoints/);
		t.regex(view.lastFrame()!, /Esc Exit/);
		view.stdin.write('\r');
		await settle();
		t.regex(view.lastFrame()!, /Sessions \[global\]/);
		t.true(view.lastFrame()!.split('\n').length <= 14);
		view.stdin.write('\r');
		await settle();
		t.regex(view.lastFrame()!, /Item · session-a/);
		t.true(view.lastFrame()!.split('\n').length <= 14);
	} finally {
		view.unmount();
	}
});

test('tiny terminals show a resize hint instead of clipped controls', async t => {
	const view = render(<StorageApp report={report} />);
	try {
		Object.defineProperty(view.stdout, 'columns', {value: 36, configurable: true});
		Object.defineProperty(view.stdout, 'rows', {value: 10, configurable: true});
		view.stdout.emit('resize');
		await settle();
		t.regex(view.lastFrame()!, /Resize the terminal/);
		t.true(view.lastFrame()!.split('\n').length <= 10);
	} finally {
		view.unmount();
	}
});
