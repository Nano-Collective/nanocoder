import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
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
		t.regex(view.lastFrame()!, /Storage diagnostics · read-only/);
		t.true(view.lastFrame()!.split('\n').length <= 24);
		t.regex(view.lastFrame()!, /sessions \[global\]/);
		t.regex(view.lastFrame()!, /artifacts \[global\]/);
		t.regex(view.lastFrame()!, /\/data\/sessions/);
		view.stdin.write('\r');
		await settle();
		t.true(view.lastFrame()!.split('\n').length <= 24);
		t.regex(view.lastFrame()!, /Limit · Retention: 30 days/);
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
		t.regex(view.lastFrame()!, /Overview/);
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
