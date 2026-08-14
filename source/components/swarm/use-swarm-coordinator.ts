import {execFile} from 'node:child_process';
import path from 'node:path';
import {promisify} from 'node:util';
import {useEffect, useRef, useState} from 'react';
import {z} from 'zod';
import type {SwarmConfig} from '@/app/types';
import type {LLMClient} from '@/types/core';

const execFileAsync = promisify(execFile);

export type SwarmStatus =
	| 'starting'
	| 'decomposing'
	| 'spawning'
	| 'running'
	| 'merging'
	| 'complete'
	| 'failed'
	| 'rolling_back';

export type WorkerStatus = 'starting' | 'running' | 'complete' | 'failed';

export interface SwarmWorkerState {
	id: string;
	status: WorkerStatus;
	tokens: number;
	currentTool?: string;
	error?: string;
}

const TaskSchema = z.object({
	tasks: z.array(
		z.object({
			id: z
				.string()
				.describe('A unique identifier for the worker (e.g. worker-1)'),
			description: z.string().describe('The prompt for this worker'),
			fileScope: z
				.array(z.string())
				.describe(
					'The specific file paths or directories this worker is allowed to modify (e.g. ["src/auth", "package.json"]). Scopes between workers MUST be mutually exclusive.',
				),
		}),
	),
});

type TaskDefinition = z.infer<typeof TaskSchema>['tasks'][0];

/**
 * Validates that no two tasks have overlapping file scopes.
 * A scope overlaps if one path is a parent/child of another, or they are exactly the same.
 */
function validateDisjointScopes(tasks: TaskDefinition[]): string | null {
	for (let i = 0; i < tasks.length; i++) {
		for (let j = i + 1; j < tasks.length; j++) {
			const scopeA = tasks[i]?.fileScope || [];
			const scopeB = tasks[j]?.fileScope || [];

			for (const pathA of scopeA) {
				for (const pathB of scopeB) {
					// Normalize paths to prevent false mismatches
					const normA = path.normalize(pathA);
					const normB = path.normalize(pathB);

					if (
						normA === normB ||
						normA.startsWith(normB + path.sep) ||
						normB.startsWith(normA + path.sep)
					) {
						return `Overlap detected between worker ${tasks[i]?.id} ("${pathA}") and worker ${tasks[j]?.id} ("${pathB}")`;
					}
				}
			}
		}
	}
	return null;
}

export function useSwarmCoordinator(config: SwarmConfig, client?: LLMClient) {
	const [status, setStatus] = useState<SwarmStatus>('starting');
	const [workers, setWorkers] = useState<SwarmWorkerState[]>([]);
	const [error, setError] = useState<string>();
	const [preSwarmCommit, setPreSwarmCommit] = useState<string>();

	const hasStarted = useRef(false);

	// biome-ignore lint/correctness/useExhaustiveDependencies: runSwarm is intentionally omitted to avoid infinite loops
	useEffect(() => {
		if (hasStarted.current || !client) return;
		hasStarted.current = true;

		void runSwarm();
	}, [client]);

	async function runSwarm() {
		try {
			// 1. Capture preSwarmCommit
			setStatus('starting');
			const {stdout} = await execFileAsync('git', ['rev-parse', 'HEAD']);
			const commit = stdout.trim();
			setPreSwarmCommit(commit);

			// 2. Decomposition
			setStatus('decomposing');
			let tasks: TaskDefinition[] = [];
			let attempt = 0;
			const maxAttempts = 3;

			while (attempt < maxAttempts) {
				attempt++;
				try {
					if (!client?.generateStructuredObject) {
						throw new Error('LLM client does not support structured outputs.');
					}

					const result = await client.generateStructuredObject<
						z.infer<typeof TaskSchema>
					>(
						`Decompose the following goal into exactly ${config.workers} parallel subtasks.\nGoal: ${config.prompt}`,
						TaskSchema,
						`You are the Swarm Coordinator. Your job is to break down goals into strictly independent tasks.
IMPORTANT: You MUST ensure that the fileScope arrays for different workers are MUTUALLY EXCLUSIVE. No two workers can be allowed to edit the same file or directory.`,
					);

					tasks = result.tasks;

					if (tasks.length !== config.workers) {
						throw new Error(
							`Generated ${tasks.length} tasks, expected ${config.workers}`,
						);
					}

					const overlapError = validateDisjointScopes(tasks);
					if (overlapError) {
						throw new Error(`Scope disjointness violation: ${overlapError}`);
					}

					// Success
					break;
				} catch (err) {
					if (attempt >= maxAttempts) {
						throw new Error(
							`Failed to decompose goal after ${maxAttempts} attempts: ${err instanceof Error ? err.message : String(err)}`,
						);
					}
					// Will retry
				}
			}

			// Initialize worker states
			setWorkers(
				tasks.map(t => ({
					id: t.id,
					status: 'starting',
					tokens: 0,
				})),
			);

			// 3. Worker Spawning
			setStatus('spawning');

			// TODO: Phase 3B - spawn child processes
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setStatus('failed');
		}
	}

	return {status, workers, error, preSwarmCommit};
}
