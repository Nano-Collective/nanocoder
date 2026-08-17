import {execFile, spawn} from 'node:child_process';
import path from 'node:path';
import {promisify} from 'node:util';
import {useEffect, useRef, useState} from 'react';
import {z} from 'zod';
import type {SwarmConfig} from '@/app/types';
import type {LLMClient} from '@/types/core';
import {createWorktree} from '@/utils/git-worktree';
import {
	type TaskDefinition,
	TaskSchema,
	validateDisjointScopes,
} from './coordinator-utils';
import {executeSwarmMerge, executeSwarmRollback} from './merge-manager';

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

export function useSwarmCoordinator(config: SwarmConfig, client?: LLMClient) {
	const [status, setStatus] = useState<SwarmStatus>('starting');
	const [workers, setWorkers] = useState<SwarmWorkerState[]>(() =>
		Array.from({length: config.workers}, (_, i) => ({
			id: String(i + 1),
			status: 'starting',
			tokens: 0,
		})),
	);
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
		let tasks: TaskDefinition[] = [];
		try {
			// 1. Capture preSwarmCommit
			setStatus('starting');
			const {stdout} = await execFileAsync('git', ['rev-parse', 'HEAD']);
			const commit = stdout.trim();
			setPreSwarmCommit(commit);

			// 2. Decomposition
			setStatus('decomposing');
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

			// Resolve the path to the nanocoder CLI entry point
			const cliPath = process.argv[1] || process.argv[0];

			// Create worktrees and spawn processes
			const workerPromises = tasks.map(async task => {
				const branchName = `nanocoder-swarm-${task.id}`;
				const targetPath = `.nanocoder/worktrees/${task.id}`;

				// Synchronous creation
				createWorktree(branchName, targetPath);

				const worktreeAbsPath = path.resolve(process.cwd(), targetPath);

				// Update state to running
				setWorkers(prev =>
					prev.map(w => (w.id === task.id ? {...w, status: 'running'} : w)),
				);

				return new Promise<void>((resolve, reject) => {
					// We pass the stringified array as restricted-scope (comma-separated is handled by CLI)
					const scopeArgs =
						task.fileScope.length > 0
							? ['--restricted-scope', task.fileScope.join(',')]
							: [];

					const child = spawn(
						process.execPath,
						[
							cliPath,
							'run',
							'--mode',
							'yolo',
							'--json',
							'--telemetry',
							...scopeArgs,
							task.description,
						],
						{
							cwd: worktreeAbsPath,
							env: {...process.env}, // Pass environment variables
						},
					);

					// Stream output parsing for telemetry (Phase 3C)
					let jsonBuffer = '';
					child.stdout?.on('data', (chunk: Buffer) => {
						jsonBuffer += chunk.toString();
					});

					let stderrBuffer = '';
					child.stderr?.on('data', (chunk: Buffer) => {
						stderrBuffer += chunk.toString();
						const lines = stderrBuffer.split('\n');
						stderrBuffer = lines.pop() || '';

						for (const line of lines) {
							if (!line.trim()) continue;
							try {
								const event = JSON.parse(line);
								if (event.type === 'tool' && event.tool) {
									setWorkers(prev =>
										prev.map(w =>
											w.id === task.id ? {...w, currentTool: event.tool} : w,
										),
									);
								} else if (event.type === 'turn') {
									// Heartbeat / turn update
								}
							} catch (_e) {
								// Ignore non-JSON stderr lines
							}
						}
					});

					child.on('close', (code: number | null) => {
						if (code === 0) {
							// Parse the final output just in case there's summary usage in the final report
							try {
								const finalReport = JSON.parse(
									jsonBuffer.trim().split('\n').pop() || '{}',
								);
								if (finalReport.usage) {
									setWorkers(prev =>
										prev.map(w =>
											w.id === task.id
												? {
														...w,
														tokens: finalReport.usage.totalTokens || 0,
														status: 'complete',
													}
												: w,
										),
									);
								} else {
									setWorkers(prev =>
										prev.map(w =>
											w.id === task.id ? {...w, status: 'complete'} : w,
										),
									);
								}
								resolve();
							} catch (e) {
								setWorkers(prev =>
									prev.map(w =>
										w.id === task.id
											? {...w, status: 'failed', error: 'Invalid JSON output'}
											: w,
									),
								);
								reject(
									new Error(`Worker ${task.id} output invalid JSON: ${e}`),
								);
							}
						} else {
							setWorkers(prev =>
								prev.map(w =>
									w.id === task.id
										? {...w, status: 'failed', error: `Exit code ${code}`}
										: w,
								),
							);
							reject(
								new Error(`Worker ${task.id} failed with exit code ${code}`),
							);
						}
					});

					child.on('error', (err: Error) => {
						setWorkers(prev =>
							prev.map(w =>
								w.id === task.id
									? {...w, status: 'failed', error: err.message}
									: w,
							),
						);
						reject(err);
					});
				});
			});

			setStatus('running');

			// Wait for all workers to finish. If ANY reject, it throws and goes to catch block (Rollback)
			await Promise.all(workerPromises);

			// Phase 3D: Merge
			setStatus('merging');
			if (!preSwarmCommit) {
				throw new Error('Pre-swarm commit not found during merge');
			}
			await executeSwarmMerge(tasks, preSwarmCommit, process.cwd());

			setStatus('complete');
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setStatus('rolling_back');

			// Cleanup worktrees and rollback
			if (preSwarmCommit) {
				try {
					await executeSwarmRollback(tasks, preSwarmCommit, process.cwd());
				} catch (rollbackErr) {
					setError(`Rollback failed: ${rollbackErr}`);
				}
			}

			setStatus('failed');
		}
	}

	return {status, workers, error, preSwarmCommit};
}
