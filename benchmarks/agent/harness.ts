/**
 * Agent evaluation harness (Phase 0 of #1197).
 *
 * Measures pass/fail, steps, tokens and cost for one task at a time by
 * shelling out to the built CLI (`nanocoder --plain --json run`) rather than
 * importing the loop in-process. That keeps the harness version-agnostic, so a
 * released tag can be measured with the same code as the working tree.
 *
 * Pass/fail is the primary score: every fixture carries machine-checkable
 * assertions, and a run that finishes cheaply on degraded context still fails
 * them. Steps, tokens and cost are reported alongside, never instead.
 */
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {promisify} from 'node:util';
import {
	priceTokens,
	type TokenPricing,
} from '../../source/usage/response-usage';

const execFileAsync = promisify(execFile);

/**
 * Dated id for the vendored fixture set, recorded with every result. Bump it
 * whenever a fixture's tree, prompt or assertions change, so a fixture edit
 * can never be read as a change in the agent. The content hash beside it
 * catches an edit that forgot to bump this.
 */
export const FIXTURE_PACK_ID = 'agent-eval-2026-09-29';

/** Per-run wall-clock ceiling. A wedged model must not hang the suite. */
const DEFAULT_RUN_TIMEOUT_MS = 300_000;

/** Runs per task per configuration. A single run proves nothing. */
export const DEFAULT_RUNS_PER_TASK = 5;

export type Assertion =
	| {kind: 'file-contains'; path: string; text: string}
	| {kind: 'file-not-contains'; path: string; text: string}
	| {kind: 'final-text-matches'; pattern: string}
	| {kind: 'files-unchanged'}
	| {kind: 'command'; command: string; args: string[]};

export interface Fixture {
	name: string;
	/** Absolute path to the fixture's vendored tree. */
	dir: string;
	/** Free-form label: navigation, single-file-edit, multi-file, question. */
	category: string;
	prompt: string;
	assertions: Assertion[];
}

/** The `--json` report shape, as documented in docs/features/commands.md. */
export interface JsonReport {
	kind: 'success' | 'error' | 'tool-approval-required';
	exitCode: number;
	finalText: string;
	steps: number;
	usage?: {
		inputTokens?: number;
		outputTokens?: number;
		totalTokens?: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
	};
}

export interface TaskRun {
	fixture: string;
	pass: boolean;
	/** Why the assertions (or the run itself) failed; absent on a pass. */
	failure?: string;
	steps: number;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	/** Null when no pricing was available (the local Ollama tier). */
	costUsd: number | null;
	durationMs: number;
}

export interface Spread {
	median: number;
	iqr: number;
}

export interface TaskSummary {
	fixture: string;
	category: string;
	runs: number;
	passed: number;
	steps: Spread;
	totalTokens: Spread;
	costUsd: Spread | null;
	durationMs: Spread;
	/** Distinct assertion failures seen across the runs. */
	failures: string[];
}

export interface RunOptions {
	/** Path to the CLI entry to measure, usually `dist/cli.js`. */
	cliPath: string;
	fixture: Fixture;
	model?: string;
	provider?: string;
	/** Defaults to yolo: an unattended run must never wait for approval. */
	mode?: string;
	timeoutMs?: number;
	/** Injected so tests price runs without reaching models.dev. */
	getPricing?: (model: string) => Promise<TokenPricing | null>;
	/** Where the throwaway workspace is created. Defaults to the OS temp dir. */
	workspaceRoot?: string;
}

/**
 * Linear-interpolation quantile, matching the method used to report the
 * median and IQR together so the three numbers stay consistent.
 */
export function quantile(values: number[], p: number): number {
	if (values.length === 0) return Number.NaN;
	const sorted = [...values].sort((a, b) => a - b);
	const pos = (sorted.length - 1) * p;
	const lower = Math.floor(pos);
	const upper = Math.ceil(pos);
	if (lower === upper) return sorted[lower];
	return sorted[lower] + (sorted[upper] - sorted[lower]) * (pos - lower);
}

export function median(values: number[]): number {
	return quantile(values, 0.5);
}

export function iqr(values: number[]): number {
	if (values.length === 0) return Number.NaN;
	return quantile(values, 0.75) - quantile(values, 0.25);
}

function spread(values: number[]): Spread {
	return {median: median(values), iqr: iqr(values)};
}

/**
 * Pull the report out of stdout. `--json` keeps stdout clean, but a stray
 * provider warning would still leave the object recoverable between the first
 * `{` and the last `}`.
 */
export function parseJsonReport(stdout: string): JsonReport {
	const start = stdout.indexOf('{');
	const end = stdout.lastIndexOf('}');
	if (start === -1 || end <= start) {
		throw new Error('no JSON report found on stdout');
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout.slice(start, end + 1));
	} catch (error) {
		throw new Error(`unparseable JSON report: ${(error as Error).message}`);
	}

	const report = parsed as Partial<JsonReport>;
	if (typeof report.kind !== 'string' || typeof report.exitCode !== 'number') {
		throw new Error('JSON report is missing kind/exitCode');
	}
	// The step count is the measurement this harness exists for: a report
	// without it is a CLI too old to measure, not a zero-step run.
	if (typeof report.steps !== 'number') {
		throw new Error(
			'JSON report has no numeric steps field — measure a CLI that reports it',
		);
	}
	return {
		kind: report.kind as JsonReport['kind'],
		exitCode: report.exitCode,
		finalText: typeof report.finalText === 'string' ? report.finalText : '',
		steps: report.steps,
		usage: report.usage,
	};
}

async function listFiles(dir: string): Promise<string[]> {
	const entries = await fs.readdir(dir, {withFileTypes: true, recursive: true});
	return entries
		.filter(entry => entry.isFile())
		.map(entry =>
			path
				.relative(dir, path.join(entry.parentPath, entry.name))
				.split(path.sep)
				.join('/'),
		)
		.sort();
}

/**
 * Content hash of a directory tree: every file's path and bytes. Used both for
 * the fixture-set version and for the `files-unchanged` assertion.
 */
export async function hashTree(dir: string): Promise<string> {
	const hash = createHash('sha256');
	for (const relative of await listFiles(dir)) {
		hash.update(relative);
		hash.update(await fs.readFile(path.join(dir, relative)));
	}
	return hash.digest('hex').slice(0, 12);
}

export async function loadFixtures(fixturesDir: string): Promise<Fixture[]> {
	const entries = await fs.readdir(fixturesDir, {withFileTypes: true});
	const fixtures: Fixture[] = [];
	for (const entry of entries.filter(e => e.isDirectory()).sort()) {
		const dir = path.join(fixturesDir, entry.name);
		const manifest = JSON.parse(
			await fs.readFile(path.join(dir, 'task.json'), 'utf8'),
		) as Partial<Fixture>;
		if (!manifest.prompt || !Array.isArray(manifest.assertions)) {
			throw new Error(`${entry.name}/task.json needs a prompt and assertions`);
		}
		fixtures.push({
			name: entry.name,
			dir,
			category: manifest.category ?? 'uncategorized',
			prompt: manifest.prompt,
			assertions: manifest.assertions,
		});
	}
	return fixtures;
}

/** Copy the fixture tree into a workspace, leaving the manifest behind. */
async function copyFixture(from: string, to: string): Promise<void> {
	await fs.cp(from, to, {
		recursive: true,
		filter: source => path.basename(source) !== 'task.json',
	});
}

/**
 * Evaluate a fixture's assertions against the finished run. Returns the first
 * failure, or null when every assertion holds.
 */
export async function checkAssertions(
	workspace: string,
	assertions: Assertion[],
	report: JsonReport,
	tree: {before: string; after: string},
): Promise<string | null> {
	for (const assertion of assertions) {
		switch (assertion.kind) {
			case 'file-contains':
			case 'file-not-contains': {
				let content: string;
				try {
					content = await fs.readFile(
						path.join(workspace, assertion.path),
						'utf8',
					);
				} catch {
					return `${assertion.path} is missing`;
				}
				const found = content.includes(assertion.text);
				if (assertion.kind === 'file-contains' && !found) {
					return `${assertion.path} does not contain ${JSON.stringify(assertion.text)}`;
				}
				if (assertion.kind === 'file-not-contains' && found) {
					return `${assertion.path} still contains ${JSON.stringify(assertion.text)}`;
				}
				break;
			}
			case 'final-text-matches': {
				if (!new RegExp(assertion.pattern, 'i').test(report.finalText)) {
					return `final text does not match /${assertion.pattern}/i`;
				}
				break;
			}
			case 'files-unchanged': {
				if (tree.before !== tree.after) {
					return 'files changed during a read-only task';
				}
				break;
			}
			case 'command': {
				try {
					await execFileAsync(assertion.command, assertion.args, {
						cwd: workspace,
						timeout: 60_000,
					});
				} catch (error) {
					const message = (error as Error).message.split('\n')[0];
					return `${assertion.command} ${assertion.args.join(' ')} failed: ${message}`;
				}
				break;
			}
		}
	}
	return null;
}

function failedRun(
	fixture: string,
	durationMs: number,
	failure: string,
): TaskRun {
	return {
		fixture,
		pass: false,
		failure,
		steps: 0,
		inputTokens: 0,
		outputTokens: 0,
		totalTokens: 0,
		costUsd: null,
		durationMs,
	};
}

/** Run one task once, in a throwaway copy of its fixture tree. */
export async function runOnce(options: RunOptions): Promise<TaskRun> {
	const {
		cliPath,
		fixture,
		mode = 'yolo',
		timeoutMs = DEFAULT_RUN_TIMEOUT_MS,
	} = options;
	const workspace = await fs.mkdtemp(
		path.join(
			options.workspaceRoot ?? os.tmpdir(),
			`agent-eval-${fixture.name}-`,
		),
	);

	try {
		await copyFixture(fixture.dir, workspace);
		const before = await hashTree(workspace);

		const args = [
			cliPath,
			'--plain',
			'--json',
			'--trust-directory',
			'--mode',
			mode,
		];
		if (options.provider) args.push('--provider', options.provider);
		if (options.model) args.push('--model', options.model);
		args.push('run', fixture.prompt);

		const startedAt = Date.now();
		let stdout = '';
		let spawnFailure: string | undefined;
		try {
			const result = await execFileAsync('node', args, {
				cwd: workspace,
				timeout: timeoutMs,
				maxBuffer: 64 * 1024 * 1024,
				env: {...process.env, NO_COLOR: '1', FORCE_COLOR: '0'},
			});
			stdout = result.stdout;
		} catch (error) {
			// An error report exits non-zero but still measures the run, so only a
			// missing report counts as a harness failure.
			const failed = error as {stdout?: string; message?: string};
			stdout = failed.stdout ?? '';
			if (!stdout.trim()) {
				spawnFailure = failed.message ?? 'the CLI produced no output';
			}
		}
		const durationMs = Date.now() - startedAt;

		if (spawnFailure) return failedRun(fixture.name, durationMs, spawnFailure);

		let report: JsonReport;
		try {
			report = parseJsonReport(stdout);
		} catch (error) {
			return failedRun(fixture.name, durationMs, (error as Error).message);
		}

		const after = await hashTree(workspace);
		const failure = await checkAssertions(
			workspace,
			fixture.assertions,
			report,
			{before, after},
		);

		const usage = report.usage ?? {};
		let costUsd: number | null = null;
		if (options.getPricing && options.model) {
			try {
				const pricing = await options.getPricing(options.model);
				if (pricing) costUsd = priceTokens(pricing, usage);
			} catch {
				// Cost is best-effort: an offline pricing lookup must not fail a run.
			}
		}

		return {
			fixture: fixture.name,
			pass: failure === null,
			failure: failure ?? undefined,
			steps: report.steps,
			inputTokens: usage.inputTokens ?? 0,
			outputTokens: usage.outputTokens ?? 0,
			totalTokens: usage.totalTokens ?? 0,
			costUsd,
			durationMs,
		};
	} finally {
		await fs.rm(workspace, {recursive: true, force: true});
	}
}

/**
 * Collapse a task's runs into medians and IQRs. Cost is null when no run was
 * priced, so a free local tier reads as "not priced" rather than "$0.00".
 */
export function summarize(fixture: Fixture, runs: TaskRun[]): TaskSummary {
	const priced = runs
		.map(run => run.costUsd)
		.filter((cost): cost is number => cost !== null);
	return {
		fixture: fixture.name,
		category: fixture.category,
		runs: runs.length,
		passed: runs.filter(run => run.pass).length,
		steps: spread(runs.map(run => run.steps)),
		totalTokens: spread(runs.map(run => run.totalTokens)),
		costUsd: priced.length > 0 ? spread(priced) : null,
		durationMs: spread(runs.map(run => run.durationMs)),
		failures: [
			...new Set(
				runs
					.map(run => run.failure)
					.filter((failure): failure is string => Boolean(failure)),
			),
		],
	};
}
