#!/usr/bin/env node
/**
 * Agent evaluation runner (Phase 0 of #1197).
 *
 * Usage:
 *   pnpm run test:agent-eval
 *   pnpm run test:agent-eval -- --model qwen3:8b --provider ollama
 *   pnpm run test:agent-eval -- --fixture single-file-edit --runs 1
 *
 * Deliberately outside `test:all`: it needs real model calls and takes minutes
 * per run. Point `--cli` at another checkout's `dist/cli.js` to measure a
 * released tag with this same harness.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import {getModelPricing} from '../../source/models/index';
import {
	DEFAULT_RUNS_PER_TASK,
	FIXTURE_PACK_ID,
	type Fixture,
	hashTree,
	loadFixtures,
	runOnce,
	summarize,
	type TaskRun,
	type TaskSummary,
} from './harness';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const fixturesDir = path.join(__dirname, 'fixtures');

interface Options {
	cliPath: string;
	runs: number;
	model?: string;
	provider?: string;
	fixture?: string;
	outPath: string;
}

function parseArgs(argv: string[]): Options {
	const value = (flag: string): string | undefined => {
		const index = argv.indexOf(flag);
		return index === -1 ? undefined : argv[index + 1];
	};
	const runs = Number(value('--runs') ?? DEFAULT_RUNS_PER_TASK);
	if (!Number.isInteger(runs) || runs < 1) {
		throw new Error('--runs must be a positive integer');
	}
	return {
		cliPath: path.resolve(
			value('--cli') ?? path.join(repoRoot, 'dist', 'cli.js'),
		),
		runs,
		model: value('--model') ?? process.env.NANOCODER_AGENT_EVAL_MODEL,
		provider: value('--provider') ?? process.env.NANOCODER_AGENT_EVAL_PROVIDER,
		fixture: value('--fixture'),
		outPath: path.resolve(
			value('--out') ?? path.join(__dirname, 'results.json'),
		),
	};
}

function formatSpread(spread: {median: number; iqr: number}): string {
	const round = (value: number) =>
		Number.isInteger(value) ? String(value) : value.toFixed(1);
	return `${round(spread.median)} ±${round(spread.iqr)}`;
}

function printTable(summaries: TaskSummary[]): void {
	const rows = summaries.map(summary => [
		summary.fixture,
		`${summary.passed}/${summary.runs}`,
		formatSpread(summary.steps),
		formatSpread(summary.totalTokens),
		summary.costUsd ? `$${summary.costUsd.median.toFixed(4)}` : '—',
		`${(summary.durationMs.median / 1000).toFixed(1)}s`,
	]);
	const header = ['task', 'pass', 'steps', 'tokens', 'cost', 'time'];
	const widths = header.map((cell, column) =>
		Math.max(cell.length, ...rows.map(row => row[column].length)),
	);
	const line = (cells: string[]) =>
		cells.map((cell, column) => cell.padEnd(widths[column])).join('  ');

	console.log(line(header));
	console.log(widths.map(width => '-'.repeat(width)).join('  '));
	for (const row of rows) console.log(line(row));

	for (const summary of summaries) {
		for (const failure of summary.failures) {
			console.log(`  ${summary.fixture}: ${failure}`);
		}
	}
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));

	try {
		await fs.access(options.cliPath);
	} catch {
		throw new Error(
			`no CLI at ${options.cliPath} — run \`pnpm run build\` or pass --cli`,
		);
	}

	const all = await loadFixtures(fixturesDir);
	const fixtures: Fixture[] = options.fixture
		? all.filter(fixture => fixture.name === options.fixture)
		: all;
	if (fixtures.length === 0) {
		throw new Error(`no fixture named ${options.fixture}`);
	}

	const summaries: TaskSummary[] = [];
	for (const fixture of fixtures) {
		const runs: TaskRun[] = [];
		for (let run = 1; run <= options.runs; run++) {
			process.stderr.write(`${fixture.name} ${run}/${options.runs}\n`);
			runs.push(
				await runOnce({
					cliPath: options.cliPath,
					fixture,
					model: options.model,
					provider: options.provider,
					getPricing: getModelPricing,
				}),
			);
		}
		summaries.push(summarize(fixture, runs));
	}

	printTable(summaries);

	// Every result records what produced it, so a fixture edit or a model swap
	// can never be mistaken for a change in the agent loop.
	const results = {
		generatedAt: new Date().toISOString(),
		cliPath: options.cliPath,
		model: options.model ?? null,
		provider: options.provider ?? null,
		runsPerTask: options.runs,
		fixturePackId: FIXTURE_PACK_ID,
		fixtureSetHash: await hashTree(fixturesDir),
		tasks: summaries,
	};
	await fs.writeFile(options.outPath, `${JSON.stringify(results, null, 2)}\n`);
	console.log(`\nwrote ${path.relative(repoRoot, options.outPath)}`);
}

main().catch((error: unknown) => {
	console.error(`agent-eval: ${(error as Error).message}`);
	process.exit(1);
});
