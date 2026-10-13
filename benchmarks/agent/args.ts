import * as path from 'node:path';
import {parseArgs} from 'node:util';
import {DEFAULT_RUNS_PER_TASK} from './harness';

export interface RunnerOptions {
	cliPath: string;
	runs: number;
	model?: string;
	provider?: string;
	fixture?: string;
	outPath: string;
}

export type ParsedRunnerArgs =
	| {help: true}
	| {help: false; options: RunnerOptions};

export const RUNNER_USAGE = `Usage: pnpm run test:agent-eval -- [options]

Run the agent evaluation benchmark. This starts real model runs; --help does not.

Options:
  --cli <path>       CLI entry to measure (default: dist/cli.js)
  --runs <n>         Runs per fixture (default: ${DEFAULT_RUNS_PER_TASK})
  --model <name>     Model passed to the CLI
  --provider <name>  Provider passed to the CLI
  --fixture <name>   Run one fixture only
  --out <path>       Results file (default: benchmarks/agent/results.json)
  -h, --help         Show this help`;

export function parseRunnerArgs(
	argv: string[],
	defaults: {cliPath: string; outPath: string},
): ParsedRunnerArgs {
	// pnpm forwards the separator in `pnpm run <script> -- --help` to the
	// script, while callers that invoke `tsx` directly omit it.
	const args = argv[0] === '--' ? argv.slice(1) : argv;
	const {values} = parseArgs({
		args,
		options: {
			help: {type: 'boolean', short: 'h'},
			cli: {type: 'string'},
			runs: {type: 'string'},
			model: {type: 'string'},
			provider: {type: 'string'},
			fixture: {type: 'string'},
			out: {type: 'string'},
		},
		allowPositionals: false,
		strict: true,
	});

	if (values.help) return {help: true};

	const runs = Number(values.runs ?? DEFAULT_RUNS_PER_TASK);
	if (!Number.isInteger(runs) || runs < 1) {
		throw new Error('--runs must be a positive integer');
	}

	return {
		help: false,
		options: {
			cliPath: path.resolve(values.cli ?? defaults.cliPath),
			runs,
			model: values.model ?? process.env.NANOCODER_AGENT_EVAL_MODEL,
			provider: values.provider ?? process.env.NANOCODER_AGENT_EVAL_PROVIDER,
			fixture: values.fixture,
			outPath: path.resolve(values.out ?? defaults.outPath),
		},
	};
}
