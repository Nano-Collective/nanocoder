import test from 'ava';
import React from 'react';
import {render} from 'ink-testing-library';

import {SwarmDashboard} from './swarm-dashboard';
import type {SwarmConfig} from '@/app/types';

// Helper to delay execution
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('SwarmDashboard renders correct number of workers', t => {
	const config: SwarmConfig = {
		prompt: 'refactor auth',
		workers: 3,
		swarmMode: 'review',
	};

	const {lastFrame, unmount} = render(<SwarmDashboard config={config} />);
	const frame = lastFrame();

	t.truthy(frame?.includes('Worker 1'));
	t.truthy(frame?.includes('Worker 2'));
	t.truthy(frame?.includes('Worker 3'));
	t.falsy(frame?.includes('Worker 4'));
	t.truthy(frame?.includes('refactor auth'));
	t.truthy(frame?.includes('review'));
    unmount();
});

test('SwarmDashboard deterministic state transitions', async t => {
	const config: SwarmConfig = {
		prompt: 'test transitions',
		workers: 1,
		swarmMode: 'yolo',
		restrictedScope: 'src/',
	};

	const {lastFrame, unmount} = render(<SwarmDashboard config={config} />);
	
	// Initial state
	t.truthy(lastFrame()?.includes('STARTING'));
	t.truthy(lastFrame()?.includes('src/'));
	
	// Wait a bit to hit RUNNING (effectiveTicks >= 4, 4 * 500ms = 2s)
	await delay(2500);
	t.truthy(lastFrame()?.includes('RUNNING'));
	
	unmount();
	t.pass();
});
