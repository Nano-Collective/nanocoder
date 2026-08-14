import {execFile, spawn} from 'node:child_process';
import path from 'node:path';
import {promisify} from 'node:util';
import {useEffect, useRef, useState} from 'react';
import {z} from 'zod';
import type {SwarmConfig} from '@/app/types';
import type {LLMClient} from '@/types/core';
import {createWorktree, removeWorktree} from '@/utils/git-worktree';

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
						// In the future: Parse streaming telemetry JSON lines here to update token counts/tools
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

			// For each task, perform diff and 3-way merge
			for (const task of tasks) {
				const branchName = `nanocoder-swarm-${task.id}`;
				const targetPath = `.nanocoder/worktrees/${task.id}`;
				const worktreeAbsPath = path.resolve(process.cwd(), targetPath);

				try {
					// Check for scope violations inside the worker's branch before applying
					const {stdout: changedFilesRaw} = await execFileAsync(
						'git',
						['diff', '--name-only', commit],
						{cwd: worktreeAbsPath},
					);
					const changedFiles = changedFilesRaw.split('\n').filter(Boolean);

					// Validate every changed file is within the assigned scope
					for (const changedFile of changedFiles) {
						let allowed = false;
						for (const allowedPath of task.fileScope) {
							const normChanged = path.normalize(changedFile);
							const normAllowed = path.normalize(allowedPath);
							if (
								normChanged === normAllowed ||
								normChanged.startsWith(normAllowed + path.sep)
							) {
								allowed = true;
								break;
							}
						}
						if (!allowed && task.fileScope.length > 0) {
							throw new Error(
								`Scope violation: Worker ${task.id} modified ${changedFile} which is outside its scope`,
							);
						}
					}

					// Create a patch and apply it to the main repository
					const {stdout: patchData} = await execFileAsync(
						'git',
						['diff', commit],
						{cwd: worktreeAbsPath},
					);
					if (patchData.trim()) {
						const patchPath = path.join(
							process.cwd(),
							'.nanocoder',
							`${task.id}.patch`,
						);
						await require('node:fs').promises.writeFile(patchPath, patchData);
						await execFileAsync('git', ['apply', '--3way', patchPath], {
							cwd: process.cwd(),
						});
					}
				} finally {
					// Always remove the worktree when merging is done
					try {
						removeWorktree(targetPath, branchName);
					} catch (e) {
						console.error(e);
					}
				}
			}

			setStatus('complete');
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setStatus('rolling_back');

			// Cleanup worktrees and rollback
			if (preSwarmCommit) {
				try {
					// Teardown worktrees if they exist
					const fs = require('node:fs');
					for (const task of tasks) {
						const branchName = `nanocoder-swarm-${task.id}`;
						const targetPath = `.nanocoder/worktrees/${task.id}`;
						if (fs.existsSync(path.resolve(process.cwd(), targetPath))) {
							try {
								removeWorktree(targetPath, branchName);
							} catch (e) {
								console.error(e);
							}
						}
					}

					// Hard reset back to original state
					await execFileAsync('git', ['reset', '--hard', preSwarmCommit]);
					await execFileAsync('git', ['clean', '-fd']);
				} catch (rollbackErr) {
					setError(`Rollback failed: ${rollbackErr}`);
				}
			}

			setStatus('failed');
		}
	}

	return {status, workers, error, preSwarmCommit};
}
