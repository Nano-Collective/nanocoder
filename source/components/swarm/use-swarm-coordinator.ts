import {execFile, execSync, spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {useEffect, useRef, useState} from 'react';
import {z} from 'zod';
import type {SwarmConfig} from '@/app/types';
import type {LLMClient} from '@/types/core';
import {createWorktree, ensureCleanTree} from '@/utils/git-worktree';
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
		let localPreSwarmCommit: string | undefined;
		try {
			// 1. Capture preSwarmCommit
			setStatus('starting');
			// Ensure the working tree is clean before running the swarm
			ensureCleanTree(process.cwd());

			const {stdout} = await execFileAsync('git', ['rev-parse', 'HEAD']);
			const commit = stdout.trim();
			setPreSwarmCommit(commit);
			localPreSwarmCommit = commit;

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
IMPORTANT: You MUST ensure that the fileScope arrays for different workers are MUTUALLY EXCLUSIVE. No two workers can be allowed to edit the same file or directory.
IMPORTANT: You MUST respond with a valid JSON object matching this exact shape:
{
  "tasks": [
    {
      "id": "worker-1",
      "description": "Task description here",
      "fileScope": ["path/to/file1.ts"]
    }
  ]
}`,
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

			// Resolve the absolute path to the nanocoder CLI entry point from the current cwd
			// (because the child runs in the worktree where dist/ might not be present)
			const cliPath = path.resolve(
				process.cwd(),
				process.argv[1] || process.argv[0],
			);

			// Create worktrees and spawn processes
			const workerPromises = tasks.map(async task => {
				const branchName = `nanocoder-swarm-${task.id}`;
				const targetPath = `.nanocoder/worktrees/${task.id}`;

				// Cleanup old state just in case an old run crashed
				try {
					const resolvedTarget = path.resolve(process.cwd(), targetPath);
					if (fs.existsSync(resolvedTarget)) {
						execSync(`rm -rf "${resolvedTarget}"`);
					}
					execSync(`git worktree remove "${resolvedTarget}" --force`, {
						stdio: 'ignore',
					});
				} catch (_e) {
					// Ignore
				}
				try {
					execSync(`git branch -D ${branchName}`, {stdio: 'ignore'});
				} catch (_e) {
					// Ignore
				}

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

					const providerArgs = config.provider
						? ['--provider', config.provider]
						: [];
					const modelArgs = config.model ? ['--model', config.model] : [];

					const child = spawn(
						process.execPath,
						[
							cliPath,
							'run',
							'--mode',
							config.swarmMode === 'yolo' ? 'yolo' : 'auto-accept',
							'--json',
							'--telemetry',
							'--trust-directory',
							...providerArgs,
							...modelArgs,
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
								fs.appendFileSync(
									`.nanocoder/worker-${task.id}-error.log`,
									line + '\n',
								);
							}
						}
					});

					child.on('close', (code: number | null) => {
						if (code === 0) {
							// Parse the final output just in case there's summary usage in the final report
							try {
								// Find the start of the JSON object (in case of preceding warnings)
								const bufferStr = jsonBuffer.trim();
								const jsonStart = bufferStr.indexOf('{');
								if (jsonStart === -1) {
									throw new Error('No JSON object found in output');
								}
								const finalReport = JSON.parse(bufferStr.substring(jsonStart));

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
							fs.writeFileSync(
								`.nanocoder/worker-${task.id}-stdout.json`,
								jsonBuffer,
							);
							setWorkers(prev =>
								prev.map(w =>
									w.id === task.id
										? {
												...w,
												status: 'failed',
												error: `Exit 1. See .nanocoder/worker-${task.id}-stdout.json`,
											}
										: w,
								),
							);
							reject(
								new Error(
									`Worker ${task.id} failed with exit code ${code}. Output saved.`,
								),
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
			if (!localPreSwarmCommit) {
				throw new Error('Pre-swarm commit not found during merge');
			}
			await executeSwarmMerge(tasks, localPreSwarmCommit, process.cwd());

			setStatus('complete');
		} catch (err) {
			fs.writeFileSync(
				'.nanocoder/swarm-error.log',
				err instanceof Error ? err.stack || err.message : String(err),
			);
			setError(err instanceof Error ? err.message : String(err));
			setStatus('rolling_back');

			// Cleanup worktrees and rollback
			if (localPreSwarmCommit) {
				try {
					await executeSwarmRollback(tasks, localPreSwarmCommit, process.cwd());
				} catch (rollbackErr) {
					setError(`Rollback failed: ${rollbackErr}`);
				}
			}

			setStatus('failed');
		}
	}

	return {status, workers, error, preSwarmCommit};
}
