import test from 'ava';
import React from 'react';
import {render} from 'ink-testing-library';
import {useSwarmCoordinator} from './use-swarm-coordinator.js';
import type {SwarmConfig} from '../../app/types.js';
import {Text} from 'ink';

function TestComponent({config}: {config: SwarmConfig}) {
	const {status, workers} = useSwarmCoordinator(config);
	return (
		<Text>
			Status: {status}, Workers: {workers.length}
		</Text>
	);
}

test('useSwarmCoordinator initializes correctly', t => {
	const config: SwarmConfig = {
		prompt: 'test prompt',
		workers: 2,
		swarmMode: 'review',
	};

	const {lastFrame} = render(<TestComponent config={config} />);

	t.true(lastFrame()?.includes('Status: starting'));
	t.true(lastFrame()?.includes('Workers: 2'));
});
