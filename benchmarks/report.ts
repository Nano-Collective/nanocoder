#!/usr/bin/env node
/**
 * Quality report runner.
 *
 * Usage:
 *   pnpm test:benchmark          — run the report, compare to baseline
 *   pnpm test:benchmark:update   — overwrite baseline with current values
 *
 * See `agents/2026-04-09-test-all-cli-improvements.md` for design rationale.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
	type ExplainReport,
	explain,
	type Measurements,
	type Metric,
	type MetricGroup,
	type MetricStatus,
	type ModuleBreakdown,
	measure,
} from './measure';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baselinePath = path.join(__dirname, 'baseline.json');
const reportPath = path.join(__dirname, 'report.json');

interface ComparedMetric {
	name: string;
	category: string;
	status: MetricStatus;
	display: string;
	baselineDisplay: string;
	value: number | string;
	baseline?: number | string;
	ratio?: number;
}

interface ReportSummary {
	ok: number;
	warn: number;
	fail: number;
}

interface JsonReport {
	generatedAt: string;
	summary: ReportSummary;
	metrics: Record<string, Record<string, unknown>>;
}

const DEFAULT_WARN_RATIO = 1.25;
const DEFAULT_FAIL_RATIO = 2.0;

function formatNumber(value: number, key: string): string {
	if (key.endsWith('_bytes')) {
		if (value > 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)}MB`;
		if (value > 1024) return `${(value / 1024).toFixed(1)}KB`;
		return `${value}B`;
	}
	if (key.endsWith('_ms') || key.endsWith('_ms_approx')) return `${value}ms`;
	return String(value);
}

function compareMetric(
	name: string,
	category: string,
	current: Metric,
	baseline: Metric | undefined,
): ComparedMetric {
	if (current.kind === 'exact') {
		const ok = current.value === current.expected;
		return {
			name,
			category,
			status: ok ? 'ok' : 'fail',
			display: String(current.value),
			baselineDisplay: `expected ${current.expected}`,
			value: current.value,
			baseline: current.expected,
		};
	}

	if (current.kind === 'hash') {
		const baseValue =
			baseline && baseline.kind === 'hash' ? baseline.value : undefined;
		const ok = baseValue === undefined || baseValue === current.value;
		return {
			name,
			category,
			status: ok ? 'ok' : 'warn',
			display: current.value,
			baselineDisplay: baseValue ?? '—',
			value: current.value,
			baseline: baseValue,
		};
	}

	// numeric
	const warnRatio = current.warnRatio ?? DEFAULT_WARN_RATIO;
	const failRatio = current.failRatio ?? DEFAULT_FAIL_RATIO;
	const warnOnDecrease = current.warnOnDecrease ?? false;
	const baseValue =
		baseline && baseline.kind === 'numeric' ? baseline.value : undefined;

	let status: MetricStatus = 'ok';
	let ratio: number | undefined;

	if (baseValue !== undefined && baseValue > 0) {
		ratio = current.value / baseValue;
		if (ratio >= failRatio) status = 'fail';
		else if (ratio >= warnRatio) status = 'warn';
		else if (warnOnDecrease && current.value < baseValue) status = 'warn';
	}

	return {
		name,
		category,
		status,
		display: formatNumber(current.value, name),
		baselineDisplay:
			baseValue !== undefined ? formatNumber(baseValue, name) : '—',
		value: current.value,
		baseline: baseValue,
		ratio,
	};
}

function compareAll(
	current: Measurements,
	baseline: Measurements | null,
): ComparedMetric[] {
	const results: ComparedMetric[] = [];
	const categories: Array<keyof Measurements> = [
		'correctness',
		'performance',
		'stability',
		'health',
	];
	for (const category of categories) {
		const group: MetricGroup = current[category];
		const baseGroup: MetricGroup | undefined = baseline?.[category];
		for (const [name, metric] of Object.entries(group)) {
			results.push(compareMetric(name, category, metric, baseGroup?.[name]));
		}
	}
	return results;
}

const STATUS_LABEL: Record<MetricStatus, string> = {
	ok: 'OK',
	warn: 'WARN',
	fail: 'FAIL',
};

const CATEGORY_TITLES: Record<string, string> = {
	correctness: 'Correctness',
	performance: 'Performance',
	stability: 'Stability',
	health: 'Health',
};

function printReport(results: ComparedMetric[]): ReportSummary {
	const summary: ReportSummary = {ok: 0, warn: 0, fail: 0};
	const width = 72;
	const line = '═'.repeat(width);

	console.log('');
	console.log('CLI Quality Report');
	console.log(line);

	const grouped = new Map<string, ComparedMetric[]>();
	for (const r of results) {
		if (!grouped.has(r.category)) grouped.set(r.category, []);
		grouped.get(r.category)?.push(r);
		summary[r.status] += 1;
	}

	for (const [category, entries] of grouped) {
		console.log('');
		console.log(CATEGORY_TITLES[category] ?? category);
		for (const entry of entries) {
			const name = entry.name.padEnd(28);
			const value = entry.display.padEnd(14);
			const baseline = `(baseline: ${entry.baselineDisplay})`.padEnd(30);
			const status = STATUS_LABEL[entry.status];
			console.log(`  ${name}${value}${baseline} ${status}`);
		}
	}

	console.log('');
	console.log(line);
	const total = summary.ok + summary.warn + summary.fail;
	console.log(
		`  ${total} checks: ${summary.ok} OK, ${summary.warn} WARN, ${summary.fail} FAIL`,
	);
	console.log('');
	return summary;
}

function toJsonReport(
	results: ComparedMetric[],
	summary: ReportSummary,
): JsonReport {
	const metrics: Record<string, Record<string, unknown>> = {};
	for (const r of results) {
		if (!metrics[r.category]) metrics[r.category] = {};
		metrics[r.category][r.name] = {
			value: r.value,
			baseline: r.baseline,
			ratio: r.ratio,
			status: r.status,
		};
	}
	return {
		generatedAt: new Date().toISOString(),
		summary,
		metrics,
	};
}

function serializeBaseline(m: Measurements): string {
	return `${JSON.stringify(m, null, 2)}\n`;
}

function loadBaseline(): Measurements | null {
	if (!fs.existsSync(baselinePath)) return null;
	try {
		return JSON.parse(fs.readFileSync(baselinePath, 'utf8')) as Measurements;
	} catch (error) {
		console.warn(`Failed to parse baseline.json: ${error}`);
		return null;
	}
}

function printBreakdown(label: string, breakdown: ModuleBreakdown): void {
	console.log('');
	console.log(label);
	console.log(`  total modules: ${breakdown.total}`);
	console.log(
		`  ${breakdown.buckets.nodeBuiltins} node: builtins | ` +
			`${breakdown.buckets.firstParty} first-party | ` +
			`${breakdown.buckets.nodeModules} node_modules`,
	);
	console.log('');
	console.log('  top contributors:');
	for (const entry of breakdown.topContributors) {
		console.log(`    ${String(entry.count).padStart(5)}  ${entry.name}`);
	}
	if (breakdown.sourceHotspots.length > 0) {
		console.log('');
		console.log('  first-party hotspots (source/<dir>):');
		for (const entry of breakdown.sourceHotspots) {
			console.log(`    ${String(entry.count).padStart(5)}  ${entry.dir}`);
		}
	}
}

function printExplain(report: ExplainReport): void {
	const width = 72;
	const line = '═'.repeat(width);
	console.log('');
	console.log('Module count breakdown');
	console.log(line);
	printBreakdown('--help', report.help);
	console.log('');
	printBreakdown('interactive (steady state)', report.interactive);
	console.log('');
	console.log(line);
}

async function main() {
	const update = process.argv.includes('--update');
	const explainMode = process.argv.includes('--explain');

	if (explainMode) {
		console.log('Diagnosing module graph...');
		const report = await explain();
		printExplain(report);
		const jsonPath = path.join(__dirname, 'explain.json');
		fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
		console.log(
			`Diagnostic written to ${path.relative(process.cwd(), jsonPath)}`,
		);
		return;
	}

	console.log('Running CLI quality measurements...');
	const current = await measure();

	if (update) {
		fs.writeFileSync(baselinePath, serializeBaseline(current));
		console.log(
			`Baseline updated: ${path.relative(process.cwd(), baselinePath)}`,
		);
		return;
	}

	const baseline = loadBaseline();
	if (!baseline) {
		console.warn(
			'No baseline found. Run `pnpm run benchmark:update` to create one.',
		);
	}

	const results = compareAll(current, baseline);
	const summary = printReport(results);

	const jsonReport = toJsonReport(results, summary);
	fs.writeFileSync(reportPath, `${JSON.stringify(jsonReport, null, 2)}\n`);

	if (summary.fail > 0) {
		process.exit(1);
	}
}

main().catch(error => {
	console.error('Benchmark failed:', error);
	process.exit(1);
});
