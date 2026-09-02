import {Box, Text, useApp, useInput} from 'ink';
import Spinner from 'ink-spinner';
import {useEffect} from 'react';
import type {SwarmConfig} from '@/app/types';
import type {LLMClient} from '@/types/core';
import {useSwarmCoordinator} from './use-swarm-coordinator';

export function SwarmDashboard({
	config,
	client,
}: {
	config: SwarmConfig;
	client: LLMClient | null;
}) {
	const {exit} = useApp();

	const {
		status: swarmStatus,
		workers,
		error,
		cancelSwarm,
	} = useSwarmCoordinator(config, client ?? undefined);

	// Handle graceful exit via Ctrl+C
	useInput((input, key) => {
		if (key.ctrl && input === 'c') {
			cancelSwarm();
			exit();
			process.exit(1);
		}
	});

	const allComplete = swarmStatus === 'complete' || swarmStatus === 'failed';

	useEffect(() => {
		if (allComplete) {
			const timer = setTimeout(() => {
				exit();
				process.exit(swarmStatus === 'failed' ? 1 : 0);
			}, 3000); // 3 seconds to review final state
			return () => clearTimeout(timer);
		}
	}, [allComplete, exit, swarmStatus]);

	return (
		<SwarmDashboardUI
			config={config}
			swarmStatus={swarmStatus}
			workers={workers}
			error={error}
		/>
	);
}

export function SwarmDashboardUI({
	config,
	swarmStatus,
	workers,
	error,
}: {
	config: SwarmConfig;
	swarmStatus: string;
	workers: Array<{
		id: string;
		status: string;
		tokens: number;
		currentTool?: string;
		error?: string;
	}>;
	error?: string;
}) {
	const _allComplete = swarmStatus === 'complete' || swarmStatus === 'failed';
	return (
		<Box
			flexDirection="column"
			padding={1}
			borderStyle="round"
			borderColor="blue"
		>
			<Box marginBottom={1} flexDirection="column">
				<Text bold color="cyan">
					🐝 Nanocoder Swarm (Orchestrator)
				</Text>
				<Text color="gray">
					Mode: <Text color="white">{config.swarmMode}</Text>
				</Text>
				<Text color="gray">
					Status:{' '}
					<Text
						color={
							swarmStatus === 'complete'
								? 'green'
								: swarmStatus === 'failed'
									? 'red'
									: 'cyan'
						}
					>
						{swarmStatus}
					</Text>
				</Text>
				{error && (
					<Text color="red">
						Error: <Text color="white">{error}</Text>
					</Text>
				)}
				{config.restrictedScope && (
					<Text color="gray">
						Scope: <Text color="yellow">{config.restrictedScope}</Text>
					</Text>
				)}
			</Box>

			<Box flexDirection="column" marginBottom={1}>
				{workers.map(worker => (
					<Box key={worker.id} flexDirection="row" gap={2}>
						<Box width={20}>
							{worker.status === 'complete' && <Text color="green">✓ </Text>}
							{worker.status === 'failed' && <Text color="red">✗ </Text>}
							{(worker.status === 'starting' ||
								worker.status === 'running') && (
								<Text color="cyan">
									<Spinner type="dots" />{' '}
								</Text>
							)}
							<Text bold color={worker.status === 'failed' ? 'red' : 'white'}>
								Worker{' '}
								{String(worker.id).length > 7
									? String(worker.id).substring(0, 7)
									: worker.id}
							</Text>
						</Box>
						<Box width={15}>
							<Text color={worker.status === 'failed' ? 'red' : 'gray'}>
								{worker.status}
							</Text>
						</Box>
						<Box width={25}>
							<Text color="yellow">{worker.currentTool || ''}</Text>
						</Box>
						<Box flexGrow={1} justifyContent="flex-end">
							<Text color="gray">{worker.tokens} tokens</Text>
						</Box>
					</Box>
				))}
			</Box>

			{swarmStatus === 'complete' && (
				<Box marginTop={1}>
					<Text color="green" bold>
						All workers completed successfully. Unified diff ready.
					</Text>
				</Box>
			)}
		</Box>
	);
}
