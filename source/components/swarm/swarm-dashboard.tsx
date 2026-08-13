import {Box, Text, useApp, useInput} from 'ink';
import Spinner from 'ink-spinner';
import {useEffect, useState} from 'react';
import type {SwarmConfig} from '@/app/types';

type WorkerStatus = 'starting' | 'running' | 'merging' | 'complete';

interface WorkerState {
	id: number;
	status: WorkerStatus;
	tokens: number;
	currentTool?: string;
}

const TOOLS = ['read_file', 'grep_search', 'write_to_file', 'run_command'];

export function SwarmDashboard({config}: {config: SwarmConfig}) {
	const {exit} = useApp();
	const [ticks, setTicks] = useState(0);

	// Handle graceful exit via Ctrl+C
	useInput((input, key) => {
		if (key.ctrl && input === 'c') {
			exit();
			process.exit(0);
		}
	});

	useEffect(() => {
		const interval = setInterval(() => {
			setTicks(t => t + 1);
		}, 500); // tick every half second
		return () => clearInterval(interval);
	}, []);

	// Deterministic state based on ticks
	const workers: WorkerState[] = Array.from({length: config.workers}).map(
		(_, i) => {
			const offset = i * 2; // offset in ticks
			const effectiveTicks = Math.max(0, ticks - offset);

			let status: WorkerStatus = 'starting';
			let tokens = 0;
			let currentTool: string | undefined;

			if (effectiveTicks < 4) {
				status = 'starting';
			} else if (effectiveTicks < 16) {
				status = 'running';
				tokens = (effectiveTicks - 4) * 150;
				currentTool = TOOLS[effectiveTicks % TOOLS.length];
			} else if (effectiveTicks < 20) {
				status = 'merging';
				tokens = 12 * 150;
			} else {
				status = 'complete';
				tokens = 12 * 150;
			}

			return {
				id: i + 1,
				status,
				tokens,
				currentTool,
			};
		},
	);

	const allComplete = workers.every(w => w.status === 'complete');

	useEffect(() => {
		if (allComplete && ticks > 0) {
			const timer = setTimeout(() => {
				exit();
				process.exit(0);
			}, 1500);
			return () => clearTimeout(timer);
		}
	}, [allComplete, exit, ticks]);

	return (
		<Box
			flexDirection="column"
			padding={1}
			borderStyle="round"
			borderColor="blue"
		>
			<Box marginBottom={1} flexDirection="column">
				<Text bold color="cyan">
					🐝 Nanocoder Swarm (Phase 1 Mock)
				</Text>
				<Text color="gray">
					Mode: <Text color="white">{config.swarmMode}</Text>
				</Text>
				<Text color="gray">
					Prompt: <Text color="white">{config.prompt}</Text>
				</Text>
				{config.restrictedScope && (
					<Text color="gray">
						Scope: <Text color="yellow">{config.restrictedScope}</Text>
					</Text>
				)}
			</Box>

			<Box flexDirection="column" marginBottom={1}>
				{workers.map(w => (
					<Box key={w.id} marginBottom={1} flexDirection="row">
						<Box width={15}>
							<Text color="green">Worker {w.id}</Text>
						</Box>
						<Box width={15}>
							<Text
								color={
									w.status === 'starting'
										? 'yellow'
										: w.status === 'running'
											? 'blue'
											: w.status === 'merging'
												? 'magenta'
												: 'green'
								}
							>
								{w.status === 'complete' ? '✓ ' : <Spinner type="dots" />}
								{w.status.toUpperCase()}
							</Text>
						</Box>
						<Box width={20}>
							<Text color="gray">{w.tokens.toLocaleString()} tkns</Text>
						</Box>
						<Box flexGrow={1}>
							{w.status === 'running' && w.currentTool ? (
								<Text color="gray">
									running <Text color="cyan">{w.currentTool}</Text>
								</Text>
							) : null}
						</Box>
					</Box>
				))}
			</Box>

			{allComplete && (
				<Box marginTop={1}>
					<Text color="green" bold>
						All workers completed successfully. Unified diff ready.
					</Text>
				</Box>
			)}
		</Box>
	);
}
