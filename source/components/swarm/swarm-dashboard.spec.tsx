import test from 'ava';
import React from 'react';
import {render} from 'ink-testing-library';

import {SwarmDashboardUI} from './swarm-dashboard';
import type {SwarmConfig} from '@/app/types';

test('SwarmDashboardUI renders correct number of workers', t => {
	const config: SwarmConfig = {
		prompt: 'refactor auth',
		workers: 3,
		swarmMode: 'review',
	};

	const workers = [
		{ id: '1', status: 'running', tokens: 100 },
		{ id: '2', status: 'running', tokens: 200 },
		{ id: '3', status: 'running', tokens: 300 },
	];

	const {lastFrame, unmount} = render(
		<SwarmDashboardUI
			config={config}
			swarmStatus="running"
			workers={workers}
		/>
	);
	const frame = lastFrame();

	t.truthy(frame?.includes('Worker 1'));
	t.truthy(frame?.includes('Worker 2'));
	t.truthy(frame?.includes('Worker 3'));
	t.falsy(frame?.includes('Worker 4'));
	// The prompt is not rendered, so we don't assert it.
	t.truthy(frame?.includes('review'));
	t.truthy(frame?.includes('running'));
	unmount();
});

test('SwarmDashboardUI renders different states correctly', t => {
	const config: SwarmConfig = {
		prompt: 'test transitions',
		workers: 1,
		swarmMode: 'yolo',
		restrictedScope: 'src/',
	};

	const {lastFrame, unmount, rerender} = render(
		<SwarmDashboardUI
			config={config}
			swarmStatus="starting"
			workers={[{ id: '1', status: 'starting', tokens: 0 }]}
		/>
	);
	
	// Initial state
	t.truthy(lastFrame()?.includes('starting'));
	t.truthy(lastFrame()?.includes('src/'));
	
	rerender(
		<SwarmDashboardUI
			config={config}
			swarmStatus="running"
			workers={[{ id: '1', status: 'running', tokens: 0 }]}
		/>
	);
	
	t.truthy(lastFrame()?.includes('running'));
	
	unmount();
	t.pass();
});
