import {randomBytes} from 'node:crypto';
import {copyFileSync, existsSync, realpathSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {LLMClient} from '@/types/core';
import {formatError} from '@/utils/error-formatter';
import {
	createWorktree,
	ensureCleanTree,
	ensureSwarmExcludes,
	removeWorktree,
	runGit,
} from '@/utils/git-worktree';
import {decomposeGoal, describeRepository} from './decompose';
import {applyPatches, collectPatch} from './patches';
import type {TaskDefinition} from './tasks';
import type {SwarmConfig, SwarmSnapshot, WorkerState} from './types';
import {buildWorkerPrompt, runWorker} from './worker';

// Project files that are usually left out of git, so a fresh worktree lacks
// them although a worker needs them to reach the same provider and tools.
const LOCAL_CONFIG_FILES = ['agents.config.json', '.mcp.json', '.env'];

export interface SwarmDependencies {
	client: Pick<LLMClient, 'chat'>;
	cwd: string;
	cliPath: string;
	/** Provider, model and similar options every worker is started with. */
	workerOptions: string[];
	signal: AbortSignal;
	onUpdate: (snapshot: SwarmSnapshot) => void;
	/** Asked only in `apply` mode, once every patch has passed verification. */
	confirmApply: () => Promise<boolean>;
	runWorker?: typeof runWorker;
}

interface Worktree {
	task: TaskDefinition;
	branch: string;
	directory: string;
}

async function ensureRepositoryRoot(cwd: string): Promise<string> {
	let root: string;
	try {
		root = (await runGit(['rev-parse', '--show-toplevel'], cwd)).trim();
	} catch {
		throw new Error('Swarm needs to run inside a Git repository.');
	}
	if (realpathSync(root) !== realpathSync(cwd)) {
		throw new Error(`Run swarm from the repository root: ${root}`);
	}
	try {
		return (await runGit(['rev-parse', '--verify', 'HEAD'], cwd)).trim();
	} catch {
		throw new Error('Swarm needs at least one commit to branch from.');
	}
}

/**
 * Splits the goal, runs one worker per task in its own worktree, and combines
 * their patches. The main working tree is only ever changed by one atomic
 * `git apply` at the very end, so a failure or cancellation needs no rollback
 * there. Never throws: the outcome is in the returned snapshot.
 */
export async function runSwarm(
	config: SwarmConfig,
	dependencies: SwarmDependencies,
): Promise<SwarmSnapshot> {
	const {client, cwd, cliPath, workerOptions, onUpdate, confirmApply} =
		dependencies;
	const start = dependencies.runWorker ?? runWorker;

	let snapshot: SwarmSnapshot = {
		status: 'decomposing',
		workers: [],
		patches: [],
		applied: false,
	};
	const update = (changes: Partial<SwarmSnapshot>) => {
		snapshot = {...snapshot, ...changes};
		onUpdate(snapshot);
	};
	const updateWorker = (
		id: string,
		changes: (worker: WorkerState) => Partial<WorkerState>,
	) => {
		update({
			workers: snapshot.workers.map(worker =>
				worker.id === id ? {...worker, ...changes(worker)} : worker,
			),
		});
	};

	const timeout = AbortSignal.timeout(config.timeoutMs);
	const failure = new AbortController();
	const signal = AbortSignal.any([
		dependencies.signal,
		timeout,
		failure.signal,
	]);

	const worktrees: Worktree[] = [];
	const finished = new Set<string>();
	let baseCommit = '';
	let runDirectory: string | undefined;

	const collect = async ({task, directory}: Worktree) => {
		const patch = await collectPatch(
			task,
			path.resolve(cwd, directory),
			baseCommit,
			path.resolve(cwd, runDirectory ?? '', `${task.id}.patch`),
		);
		if (!patch) return;
		update({
			patches: [
				...snapshot.patches,
				{...patch, patchPath: path.relative(cwd, patch.patchPath)},
			],
		});
	};

	try {
		onUpdate(snapshot);
		baseCommit = await ensureRepositoryRoot(cwd);
		await ensureSwarmExcludes(cwd);
		await ensureCleanTree(cwd);

		const tasks = await decomposeGoal({
			client,
			goal: config.prompt,
			maxTasks: config.workers,
			repository: await describeRepository(cwd),
			signal,
		});

		const runId = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
		runDirectory = path.join('.nanocoder', 'swarm', runId);
		await mkdir(path.resolve(cwd, runDirectory, 'worktrees'), {
			recursive: true,
		});
		await writeFile(
			path.resolve(cwd, runDirectory, 'plan.json'),
			`${JSON.stringify({goal: config.prompt, baseCommit, tasks}, null, 2)}\n`,
		);
		update({
			status: 'running',
			runDir: runDirectory,
			workers: tasks.map(task => ({
				id: task.id,
				status: 'pending',
				fileScope: task.fileScope,
				turns: 0,
				tokens: 0,
			})),
		});

		// One at a time: concurrent `git worktree add` can contend on git locks.
		for (const task of tasks) {
			signal.throwIfAborted();
			const worktree = {
				task,
				branch: `nanocoder-swarm-${runId}-${task.id}`,
				directory: path.join(runDirectory, 'worktrees', task.id),
			};
			await createWorktree(
				worktree.branch,
				worktree.directory,
				baseCommit,
				cwd,
			);
			worktrees.push(worktree);
			for (const file of LOCAL_CONFIG_FILES) {
				const source = path.resolve(cwd, file);
				const target = path.resolve(cwd, worktree.directory, file);
				// With a clean tree, a file missing from the worktree is ignored,
				// so the copy cannot end up in a patch.
				if (existsSync(source) && !existsSync(target)) {
					copyFileSync(source, target);
				}
			}
		}

		let firstError: Error | undefined;
		await Promise.all(
			worktrees.map(async worktree => {
				const {task} = worktree;
				updateWorker(task.id, () => ({status: 'running'}));
				try {
					const {tokens} = await start({
						cliPath,
						cliArgs: [
							'run',
							'--mode',
							config.swarmMode === 'yolo' ? 'yolo' : 'auto-accept',
							'--plain',
							'--json',
							'--telemetry',
							'--trust-directory',
							'--restricted-scope',
							task.fileScope.map(entry => entry || '.').join(','),
							...workerOptions,
							buildWorkerPrompt(task, config.prompt),
						],
						cwd: path.resolve(cwd, worktree.directory),
						logPath: path.resolve(cwd, runDirectory ?? '', `${task.id}.log`),
						reportPath: path.resolve(
							cwd,
							runDirectory ?? '',
							`${task.id}.report.json`,
						),
						signal,
						onEvent: event => {
							updateWorker(task.id, worker =>
								event.type === 'turn'
									? {turns: worker.turns + 1, currentTool: undefined}
									: {currentTool: event.tool},
							);
						},
					});
					finished.add(task.id);
					updateWorker(task.id, () => ({
						status: 'success',
						currentTool: undefined,
						tokens,
					}));
				} catch (error) {
					const cancelled = signal.aborted;
					updateWorker(task.id, () => ({
						status: cancelled ? 'cancelled' : 'failed',
						currentTool: undefined,
						error: cancelled ? undefined : formatError(error),
					}));
					if (!cancelled) {
						firstError = new Error(
							`Worker ${task.id} failed: ${formatError(error)}`,
						);
						failure.abort();
					}
				}
			}),
		);
		if (firstError) throw firstError;
		signal.throwIfAborted();

		update({status: 'verifying'});
		for (const worktree of worktrees) await collect(worktree);
		signal.throwIfAborted();

		if (snapshot.patches.length > 0 && config.swarmMode !== 'review') {
			let approved = config.swarmMode === 'yolo';
			if (!approved) {
				update({status: 'awaiting-confirmation'});
				approved = await confirmApply();
			}
			dependencies.signal.throwIfAborted();
			if (approved) {
				update({status: 'applying'});
				await applyPatches(
					snapshot.patches,
					baseCommit,
					path.join(runDirectory, 'combined.patch'),
					cwd,
				);
				update({applied: true});
			}
		}
		update({status: 'complete'});
	} catch (error) {
		failure.abort();
		const message = dependencies.signal.aborted
			? 'Swarm cancelled.'
			: timeout.aborted
				? `Swarm timed out after ${Math.round(config.timeoutMs / 60_000)} minute(s).`
				: formatError(error);

		// Keep the work of the workers that did finish.
		for (const worktree of worktrees) {
			const {id} = worktree.task;
			if (!finished.has(id) || snapshot.patches.some(p => p.id === id)) {
				continue;
			}
			try {
				await collect(worktree);
			} catch {
				// A worker that broke its scope has no patch worth keeping.
			}
		}
		if (runDirectory) {
			await writeFile(
				path.resolve(cwd, runDirectory, 'error.log'),
				`${message}\n`,
			).catch(() => undefined);
		}
		update({status: 'failed', error: message});
	} finally {
		for (const {branch, directory} of worktrees) {
			try {
				await removeWorktree(directory, branch, cwd);
			} catch (error) {
				const message = `Could not remove worktree ${directory}: ${formatError(error)}`;
				update({
					error: snapshot.error ? `${snapshot.error}\n${message}` : message,
				});
			}
		}
	}

	return snapshot;
}
