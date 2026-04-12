/**
 * Quality report measurement runner.
 *
 * Collects correctness, performance, stability, and health metrics for the
 * built CLI (`dist/cli.js`). See `agents/2026-04-09-test-all-cli-improvements.md`
 * for the design rationale and how to add new metrics.
 */
import {execFileSync, spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const distCli = path.join(repoRoot, 'dist', 'cli.js');

export type MetricStatus = 'ok' | 'warn' | 'fail';

export interface ExactMetric {
	kind: 'exact';
	value: number | string;
	expected: number | string;
}

export interface NumericMetric {
	kind: 'numeric';
	value: number;
	/** If true, a decrease from baseline is a warning (e.g. tool count dropped). */
	warnOnDecrease?: boolean;
	/** Ratio vs baseline above which WARN is raised (default 1.25). */
	warnRatio?: number;
	/** Ratio vs baseline above which FAIL is raised (default 2.0). */
	failRatio?: number;
}

export interface HashMetric {
	kind: 'hash';
	value: string;
}

export type Metric = ExactMetric | NumericMetric | HashMetric;

export interface MetricGroup {
	[name: string]: Metric;
}

export interface Measurements {
	correctness: MetricGroup;
	performance: MetricGroup;
	stability: MetricGroup;
	health: MetricGroup;
}

/**
 * Runs `dist/cli.js` with the given args, captures exit code and output.
 * Used for correctness checks.
 */
function runCli(args: string[]): {
	exitCode: number;
	stdout: string;
	stderr: string;
} {
	try {
		const stdout = execFileSync('node', [distCli, ...args], {
			encoding: 'utf8',
			stdio: ['pipe', 'pipe', 'pipe'],
			env: {...process.env, NO_COLOR: '1', FORCE_COLOR: '0'},
		});
		return {exitCode: 0, stdout, stderr: ''};
	} catch (error: unknown) {
		const e = error as {
			status?: number;
			stdout?: string | Buffer;
			stderr?: string | Buffer;
		};
		return {
			exitCode: typeof e.status === 'number' ? e.status : 1,
			stdout: e.stdout?.toString() ?? '',
			stderr: e.stderr?.toString() ?? '',
		};
	}
}

/**
 * Runs the CLI under an ESM loader that counts module resolutions, and
 * returns the total count. This is a deterministic proxy for startup cost
 * — identical on every run, machine, and OS — so it works reliably in CI
 * unlike wall-clock timing.
 */
function measureModuleCount(args: string[]): number {
	const loaderPath = path.join(__dirname, 'count-loader.mjs');
	const loaderUrl = new URL(`file://${loaderPath}`).href;
	const countFile = path.join(
		repoRoot,
		'benchmarks',
		`.module-count-${process.pid}-${Date.now()}`,
	);
	try {
		execFileSync(
			'node',
			['--no-warnings', `--experimental-loader=${loaderUrl}`, distCli, ...args],
			{
				stdio: ['pipe', 'pipe', 'pipe'],
				env: {
					...process.env,
					NO_COLOR: '1',
					FORCE_COLOR: '0',
					MODULE_COUNT_FILE: countFile,
				},
			},
		);
	} catch {
		// Ignore — we only care about the count file that was written.
	}

	if (!fs.existsSync(countFile)) return 0;
	const count = Number.parseInt(fs.readFileSync(countFile, 'utf8'), 10);
	fs.unlinkSync(countFile);
	return Number.isFinite(count) ? count : 0;
}

/**
 * Boots the CLI in interactive mode under the counting loader, waits until
 * the module-resolution count has been stable for `stableMs`, then kills the
 * process and returns the final count.
 *
 * This measures the full app graph (Ink, hooks, tool manager, command
 * registry, MCP loader, etc.) rather than just the `--help` fast path.
 * Polling-until-stable keeps the result deterministic regardless of machine
 * speed: we wait for steady state, not a fixed wall-clock window.
 */
/**
 * Same polling-until-stable pattern as `measureInteractiveModuleCount`, but
 * returns both the module count AND the wall-clock time (in ms) from process
 * spawn to the moment the module count reached its final value.
 *
 * The wall-clock number is labelled **approximate** because it's
 * machine-dependent and subject to I/O / scheduler noise. It's not a
 * deterministic metric like module count — it's a sanity check that
 * optimizations translate into real boot-time savings on the local machine.
 */
async function measureInteractiveStartup(
	args: string[] = [],
): Promise<{moduleCount: number; bootMs: number}> {
	const loaderPath = path.join(__dirname, 'count-loader.mjs');
	const loaderUrl = new URL(`file://${loaderPath}`).href;
	const countFile = path.join(
		repoRoot,
		'benchmarks',
		`.module-count-interactive-${process.pid}-${Date.now()}`,
	);

	const child = spawn(
		'node',
		['--no-warnings', `--experimental-loader=${loaderUrl}`, distCli, ...args],
		{
			stdio: ['ignore', 'ignore', 'ignore'],
			env: {
				...process.env,
				NO_COLOR: '1',
				FORCE_COLOR: '0',
				MODULE_COUNT_FILE: countFile,
				CI: '1',
				// NODE_ENV=test makes `loadAllMCPConfigs()` skip the user's
				// global `.mcp.json`, so the benchmark result only reflects
				// nanocoder's own startup cost — not whatever MCP servers
				// the developer happens to have configured on their machine.
				NODE_ENV: 'test',
			},
		},
	);

	const pollMs = 100;
	const stableMs = 1500;
	const hardTimeoutMs = 20000;
	const start = Date.now();
	let lastCount = 0;
	let lastChangeTime = start;

	while (Date.now() - start < hardTimeoutMs) {
		await new Promise(resolve => setTimeout(resolve, pollMs));
		if (fs.existsSync(countFile)) {
			const raw = fs.readFileSync(countFile, 'utf8');
			const current = Number.parseInt(raw, 10) || 0;
			if (current !== lastCount) {
				lastCount = current;
				lastChangeTime = Date.now();
			} else if (lastCount > 0 && Date.now() - lastChangeTime >= stableMs) {
				break;
			}
		}
	}

	child.kill('SIGTERM');
	await new Promise<void>(resolve => {
		const killTimer = setTimeout(() => {
			child.kill('SIGKILL');
			resolve();
		}, 2000);
		child.once('exit', () => {
			clearTimeout(killTimer);
			resolve();
		});
	});

	if (fs.existsSync(countFile)) {
		const raw = fs.readFileSync(countFile, 'utf8');
		const finalCount = Number.parseInt(raw, 10);
		if (Number.isFinite(finalCount)) lastCount = finalCount;
		fs.unlinkSync(countFile);
	}

	const bootMs = lastChangeTime - start;
	return {moduleCount: lastCount, bootMs};
}

// ---------------------------------------------------------------------------
// Diagnostic: explain where module count comes from
// ---------------------------------------------------------------------------

export interface ModuleBreakdown {
	total: number;
	buckets: {
		nodeBuiltins: number;
		firstParty: number;
		nodeModules: number;
	};
	topContributors: Array<{name: string; count: number}>;
	/**
	 * Top first-party `source/<dir>` directories by module count. Lets us
	 * pinpoint which subsystems dominate the [source] bucket so we know
	 * where to target further lazy-loading work.
	 */
	sourceHotspots: Array<{dir: string; count: number}>;
}

export interface ExplainReport {
	help: ModuleBreakdown;
	interactive: ModuleBreakdown;
}

/**
 * Bucket a list of resolved module URLs by top-level package name. Used to
 * answer "which dependency is pulling in the most modules at startup?"
 *
 * - `node:*` specifiers are grouped as `[node:builtins]`
 * - Paths under `node_modules/<pkg>` (or `node_modules/@scope/pkg`) are
 *   grouped under the package name
 * - Paths inside the repo are grouped as `[source]`
 */
function bucketModuleUrls(urls: string[], topN = 20): ModuleBreakdown {
	const groups = new Map<string, number>();
	const sourceGroups = new Map<string, number>();
	const buckets = {nodeBuiltins: 0, firstParty: 0, nodeModules: 0};
	const repoRootPrefix = `file://${repoRoot}/`;
	const distPrefix = `${repoRootPrefix}dist/`;

	for (const url of urls) {
		let key: string;
		if (url.startsWith('node:')) {
			key = '[node:builtins]';
			buckets.nodeBuiltins += 1;
		} else if (url.includes('/node_modules/')) {
			const match = url.match(
				/\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((@[^/]+\/[^/]+)|([^/]+))/,
			);
			key = match ? (match[2] ?? match[3]) : '[unknown]';
			buckets.nodeModules += 1;
		} else if (url.startsWith(repoRootPrefix)) {
			key = '[source]';
			buckets.firstParty += 1;
			// Also bucket by top-level directory under dist/ (the built
			// binary lives there at runtime). Group the CLI entry and any
			// other dist-level files as `<root>`.
			if (url.startsWith(distPrefix)) {
				const rel = url.slice(distPrefix.length);
				const firstSlash = rel.indexOf('/');
				const dir = firstSlash === -1 ? '<root>' : rel.slice(0, firstSlash);
				sourceGroups.set(dir, (sourceGroups.get(dir) ?? 0) + 1);
			}
		} else {
			key = '[other]';
		}
		groups.set(key, (groups.get(key) ?? 0) + 1);
	}

	const topContributors = [...groups.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, topN)
		.map(([name, count]) => ({name, count}));

	const sourceHotspots = [...sourceGroups.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, topN)
		.map(([dir, count]) => ({dir, count}));

	return {total: urls.length, buckets, topContributors, sourceHotspots};
}

/**
 * Spawns the CLI under the diagnostic loader, captures the full list of
 * resolved URLs, and groups them by package. Used by `pnpm test:benchmark
 * --explain` to show where the module-count number comes from.
 */
async function runWithUrlCapture(
	args: string[],
	mode: 'oneshot' | 'interactive',
): Promise<ModuleBreakdown> {
	const loaderPath = path.join(__dirname, 'count-loader.mjs');
	const loaderUrl = new URL(`file://${loaderPath}`).href;
	const urlFile = path.join(
		repoRoot,
		'benchmarks',
		`.module-urls-${mode}-${process.pid}-${Date.now()}`,
	);
	const countFile = `${urlFile}.count`;

	if (mode === 'oneshot') {
		try {
			execFileSync(
				'node',
				[
					'--no-warnings',
					`--experimental-loader=${loaderUrl}`,
					distCli,
					...args,
				],
				{
					stdio: ['pipe', 'pipe', 'pipe'],
					env: {
						...process.env,
						NO_COLOR: '1',
						FORCE_COLOR: '0',
						MODULE_COUNT_FILE: countFile,
						MODULE_URL_FILE: urlFile,
					},
				},
			);
		} catch {
			// Ignore; we only care about the URL log that was written.
		}
	} else {
		const child = spawn(
			'node',
			['--no-warnings', `--experimental-loader=${loaderUrl}`, distCli, ...args],
			{
				stdio: ['ignore', 'ignore', 'ignore'],
				env: {
					...process.env,
					NO_COLOR: '1',
					FORCE_COLOR: '0',
					MODULE_COUNT_FILE: countFile,
					MODULE_URL_FILE: urlFile,
					CI: '1',
					// Keep the user's global MCP config out of the graph
					// so the explain breakdown only reflects nanocoder's own
					// boot cost. Matches `measureInteractiveStartup`.
					NODE_ENV: 'test',
				},
			},
		);

		const pollMs = 100;
		const stableMs = 1500;
		const hardTimeoutMs = 20000;
		const start = Date.now();
		let lastCount = 0;
		let lastChangeTime = start;

		while (Date.now() - start < hardTimeoutMs) {
			await new Promise(resolve => setTimeout(resolve, pollMs));
			if (fs.existsSync(countFile)) {
				const raw = fs.readFileSync(countFile, 'utf8');
				const current = Number.parseInt(raw, 10) || 0;
				if (current !== lastCount) {
					lastCount = current;
					lastChangeTime = Date.now();
				} else if (lastCount > 0 && Date.now() - lastChangeTime >= stableMs) {
					break;
				}
			}
		}

		child.kill('SIGTERM');
		await new Promise<void>(resolve => {
			const killTimer = setTimeout(() => {
				child.kill('SIGKILL');
				resolve();
			}, 2000);
			child.once('exit', () => {
				clearTimeout(killTimer);
				resolve();
			});
		});
	}

	let urls: string[] = [];
	if (fs.existsSync(urlFile)) {
		urls = fs.readFileSync(urlFile, 'utf8').split('\n').filter(Boolean);
		fs.unlinkSync(urlFile);
	}
	if (fs.existsSync(countFile)) fs.unlinkSync(countFile);

	// Deduplicate — the explain breakdown should count unique files loaded,
	// matching the main `interactive_module_count` metric. Otherwise a hot
	// file like `useTheme.js` (imported from ~50 sites) would inflate its
	// bucket by a factor of 50 even though Node only loads it once.
	const uniqueUrls = Array.from(new Set(urls));

	return bucketModuleUrls(uniqueUrls);
}

/**
 * Runs the CLI twice under the diagnostic loader — once for `--help` and
 * once in interactive mode — and returns a breakdown for each path. Used
 * by the `--explain` flag to show where the module-count number comes from.
 */
export async function explain(): Promise<ExplainReport> {
	if (!fs.existsSync(distCli)) {
		throw new Error(
			`dist/cli.js not found at ${distCli}. Run 'pnpm run build' first.`,
		);
	}
	const help = await runWithUrlCapture(['--help'], 'oneshot');
	const interactive = await runWithUrlCapture([], 'interactive');
	return {help, interactive};
}

/**
 * Recursively computes total size and file count of a directory.
 */
function measureDir(dir: string): {bytes: number; files: number} {
	let bytes = 0;
	let files = 0;
	const stack = [dir];
	while (stack.length > 0) {
		const current = stack.pop();
		if (current === undefined) break;
		const entries = fs.readdirSync(current, {withFileTypes: true});
		for (const entry of entries) {
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(full);
			} else if (entry.isFile()) {
				bytes += fs.statSync(full).size;
				files += 1;
			}
		}
	}
	return {bytes, files};
}

/**
 * Count entries in a flat array literal found in a source file. Used to
 * count tools and commands without importing React-laden modules.
 *
 * The function locates `identifier = [` or `identifier: ... = [` in `source`
 * and counts top-level array entries, ignoring comments and spread operators
 * that invoke helper functions.
 */
function countArrayEntries(
	source: string,
	pattern: RegExp,
	{includeSpreads = false}: {includeSpreads?: boolean} = {},
): number {
	const match = source.match(pattern);
	if (!match) {
		throw new Error(`Could not locate array matching ${pattern} in source`);
	}
	const startIdx = (match.index ?? 0) + match[0].length;
	let depth = 1;
	let end = -1;
	for (let i = startIdx; i < source.length; i++) {
		const ch = source[i];
		if (ch === '[') depth++;
		else if (ch === ']') {
			depth--;
			if (depth === 0) {
				end = i;
				break;
			}
		}
	}
	if (end === -1) throw new Error('Unterminated array literal');
	const body = source.slice(startIdx, end);

	// Strip line and block comments before counting.
	const stripped = body
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/\/\/[^\n]*/g, '');

	// Split on top-level commas only — track bracket/brace/paren depth and
	// string/template-literal state so we don't count commas inside nested
	// object literals (e.g. `[{name: 'a', description: 'b'}, {...}]`).
	const rawEntries: string[] = [];
	let current = '';
	let bracketDepth = 0;
	let parenDepth = 0;
	let braceDepth = 0;
	let inString: '"' | "'" | '`' | null = null;

	for (let i = 0; i < stripped.length; i++) {
		const ch = stripped[i];
		const prev = i > 0 ? stripped[i - 1] : '';
		if (inString) {
			current += ch;
			if (ch === inString && prev !== '\\') inString = null;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === '`') {
			inString = ch;
			current += ch;
			continue;
		}
		if (ch === '[') bracketDepth++;
		else if (ch === ']') bracketDepth--;
		else if (ch === '(') parenDepth++;
		else if (ch === ')') parenDepth--;
		else if (ch === '{') braceDepth++;
		else if (ch === '}') braceDepth--;
		else if (
			ch === ',' &&
			bracketDepth === 0 &&
			parenDepth === 0 &&
			braceDepth === 0
		) {
			const trimmed = current.trim();
			if (trimmed) rawEntries.push(trimmed);
			current = '';
			continue;
		}
		current += ch;
	}
	const tail = current.trim();
	if (tail) rawEntries.push(tail);

	if (includeSpreads) return rawEntries.length;
	// Exclude spread helpers like `...getFileOpTools()` — we count those separately.
	return rawEntries.filter(e => !e.startsWith('...')).length;
}

/**
 * Count CLI flags/commands by parsing `--help` output. Counts lines under the
 * "Options:" and "Commands:" sections.
 */
function countHelpEntries(helpText: string): number {
	const lines = helpText.split('\n');
	let inSection = false;
	let count = 0;
	for (const line of lines) {
		const trimmed = line.trim();
		if (/^(Options|Commands):$/.test(trimmed)) {
			inSection = true;
			continue;
		}
		if (inSection) {
			if (trimmed === '') {
				inSection = false;
				continue;
			}
			// Lines starting with - or a lowercase word are entries.
			if (/^(-|[a-z])/.test(trimmed)) count += 1;
		}
	}
	return count;
}

function sha256(input: string): string {
	return createHash('sha256').update(input).digest('hex').slice(0, 12);
}

/**
 * Count test files and AVA test cases across the source tree.
 * Test case counting is a regex heuristic — good enough for drift detection.
 */
function countTests(): {files: number; cases: number} {
	const testFiles: string[] = [];
	const stack = [path.join(repoRoot, 'source')];
	while (stack.length > 0) {
		const current = stack.pop();
		if (current === undefined) break;
		for (const entry of fs.readdirSync(current, {withFileTypes: true})) {
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(full);
			} else if (/\.spec\.(ts|tsx)$/.test(entry.name)) {
				testFiles.push(full);
			}
		}
	}

	let cases = 0;
	// Matches: test('name', ...), test.serial('name', ...), test.skip(...), etc.
	const testRegex = /(?:^|\s)test(?:\.[a-z]+)?\s*\(/g;
	for (const file of testFiles) {
		const content = fs.readFileSync(file, 'utf8');
		const matches = content.match(testRegex);
		if (matches) cases += matches.length;
	}
	return {files: testFiles.length, cases};
}

/**
 * Count audit vulnerabilities. Returns -1 if audit cannot be run (e.g. offline).
 */
function countAuditVulnerabilities(): number {
	try {
		const out = execFileSync(
			'pnpm',
			['audit', '--audit-level=high', '--json'],
			{
				encoding: 'utf8',
				stdio: ['pipe', 'pipe', 'pipe'],
				cwd: repoRoot,
			},
		);
		const parsed = JSON.parse(out);
		const meta = parsed?.metadata?.vulnerabilities ?? {};
		return (meta.high ?? 0) + (meta.critical ?? 0);
	} catch (error: unknown) {
		const e = error as {stdout?: string | Buffer};
		if (e.stdout) {
			try {
				const parsed = JSON.parse(e.stdout.toString());
				const meta = parsed?.metadata?.vulnerabilities ?? {};
				return (meta.high ?? 0) + (meta.critical ?? 0);
			} catch {
				return -1;
			}
		}
		return -1;
	}
}

/**
 * Measures time from process spawn to first stdout output — the moment
 * the user sees *something* on screen. Run without the ESM counting
 * loader so there's no instrumentation overhead. Takes the median of
 * `samples` runs.
 */
async function measureTimeToFirstRender(samples = 3): Promise<number> {
	const results: number[] = [];

	for (let i = 0; i < samples; i++) {
		const result = await new Promise<number>(resolve => {
			const start = Date.now();
			const child = spawn('node', [distCli], {
				stdio: ['ignore', 'pipe', 'pipe'],
				env: {
					...process.env,
					NO_COLOR: '1',
					FORCE_COLOR: '0',
					CI: '1',
					NODE_ENV: 'test',
				},
			});

			let resolved = false;
			const onData = () => {
				if (!resolved) {
					resolved = true;
					const elapsed = Date.now() - start;
					child.kill('SIGTERM');
					resolve(elapsed);
				}
			};

			child.stdout.once('data', onData);
			child.stderr.once('data', onData);

			// Safety timeout
			setTimeout(() => {
				if (!resolved) {
					resolved = true;
					child.kill('SIGKILL');
					resolve(Date.now() - start);
				}
			}, 15000);
		});

		results.push(result);
	}

	results.sort((a, b) => a - b);
	return results[Math.floor(results.length / 2)];
}

export async function measure(): Promise<Measurements> {
	if (!fs.existsSync(distCli)) {
		throw new Error(
			`dist/cli.js not found at ${distCli}. Run 'pnpm run build' first.`,
		);
	}

	// Correctness ------------------------------------------------------------
	const helpResult = runCli(['--help']);
	const versionResult = runCli(['--version']);

	// Performance ------------------------------------------------------------
	// All performance metrics are deterministic: module-resolution counts from
	// an ESM loader hook + static dist/ size. Wall-clock timing is intentionally
	// avoided — it's flaky on shared CI runners and the module count is a more
	// honest signal for "is startup getting more expensive?" anyway.
	const helpModuleCount = measureModuleCount(['--help']);
	const versionModuleCount = measureModuleCount(['--version']);
	// Run the interactive measurement three times and take the median wall-
	// clock boot number; the module count is deterministic so we only keep
	// the first one.
	const interactiveRuns = [
		await measureInteractiveStartup(),
		await measureInteractiveStartup(),
		await measureInteractiveStartup(),
	];
	const interactiveModuleCount = interactiveRuns[0].moduleCount;
	const bootSamples = interactiveRuns.map(r => r.bootMs).sort((a, b) => a - b);
	const interactiveBootMsMedian = bootSamples[1];
	// Time from spawn to first stdout byte — what the user actually perceives.
	const firstRenderMs = await measureTimeToFirstRender();
	const distStats = measureDir(path.join(repoRoot, 'dist'));

	// Stability --------------------------------------------------------------
	const toolsIndex = fs.readFileSync(
		path.join(repoRoot, 'source/tools/index.ts'),
		'utf8',
	);
	const staticToolCount = countArrayEntries(
		toolsIndex,
		/const\s+staticTools[^=]*=\s*\[/,
	);
	// Resolve spread helpers manually.
	const fileOpsIndex = fs.readFileSync(
		path.join(repoRoot, 'source/tools/file-ops/index.ts'),
		'utf8',
	);
	const fileOpsCount = countArrayEntries(fileOpsIndex, /(?:return|=)\s*\[/);
	const gitIndex = fs.readFileSync(
		path.join(repoRoot, 'source/tools/git/index.ts'),
		'utf8',
	);
	// Git tools array includes core tools plus conditional PR tool (counted once).
	const gitCount = countArrayEntries(gitIndex, /tools[^=]*=\s*\[/) + 1;
	const toolCount = staticToolCount + fileOpsCount + gitCount;

	// Built-in commands: prefer the lazy registry if present (current
	// layout), else fall back to the old eager `commandRegistry.register(
	// [...])` call in `useAppInitialization.tsx`. The fallback keeps the
	// benchmark runnable on older checkouts that predate the lazy refactor.
	const lazyRegistryPath = path.join(
		repoRoot,
		'source/commands/lazy-registry.ts',
	);
	let commandCount: number;
	if (fs.existsSync(lazyRegistryPath)) {
		const lazyRegistry = fs.readFileSync(lazyRegistryPath, 'utf8');
		commandCount = countArrayEntries(lazyRegistry, /lazyCommands[^=]*=\s*\[/, {
			includeSpreads: true,
		});
	} else {
		const appInit = fs.readFileSync(
			path.join(repoRoot, 'source/hooks/useAppInitialization.tsx'),
			'utf8',
		);
		commandCount = countArrayEntries(appInit, /commandRegistry\.register\(\[/, {
			includeSpreads: true,
		});
	}

	const cliFlagCount = countHelpEntries(helpResult.stdout);
	const helpHash = sha256(helpResult.stdout);

	const testCounts = countTests();

	// Health -----------------------------------------------------------------
	const auditCount = countAuditVulnerabilities();

	const measurements: Measurements = {
		correctness: {
			help_exit_code: {kind: 'exact', value: helpResult.exitCode, expected: 0},
			version_exit_code: {
				kind: 'exact',
				value: versionResult.exitCode,
				expected: 0,
			},
		},
		performance: {
			help_module_count: {
				kind: 'numeric',
				value: helpModuleCount,
				warnOnDecrease: false,
			},
			version_module_count: {
				kind: 'numeric',
				value: versionModuleCount,
				warnOnDecrease: false,
			},
			interactive_module_count: {
				kind: 'numeric',
				value: interactiveModuleCount,
				warnOnDecrease: false,
			},
			// Approximate wall-clock boot time — median of 3 samples, machine-
			// dependent, not a CI-safe metric. Included as a sanity check that
			// module-count improvements translate into real user-visible boot
			// savings. Do not rely on this number for drift detection across
			// environments.
			interactive_boot_ms_approx: {
				kind: 'numeric',
				value: interactiveBootMsMedian,
				warnOnDecrease: false,
			},
			// Time from spawn to first stdout byte — what the user sees.
			// Measured without the ESM loader so there's no instrumentation
			// overhead. Median of 3 runs.
			first_render_ms_approx: {
				kind: 'numeric',
				value: firstRenderMs,
				warnOnDecrease: false,
			},
			dist_size_bytes: {kind: 'numeric', value: distStats.bytes},
			dist_file_count: {
				kind: 'numeric',
				value: distStats.files,
				warnOnDecrease: false,
			},
		},
		stability: {
			cli_flag_count: {
				kind: 'numeric',
				value: cliFlagCount,
				warnOnDecrease: true,
			},
			tool_count: {
				kind: 'numeric',
				value: toolCount,
				warnOnDecrease: true,
			},
			command_count: {
				kind: 'numeric',
				value: commandCount,
				warnOnDecrease: true,
			},
			help_hash: {kind: 'hash', value: helpHash},
		},
		health: {
			test_file_count: {
				kind: 'numeric',
				value: testCounts.files,
				warnOnDecrease: true,
			},
			test_case_count: {
				kind: 'numeric',
				value: testCounts.cases,
				warnOnDecrease: true,
			},
			audit_high_vulns: {
				kind: 'numeric',
				value: auditCount,
			},
		},
	};

	return measurements;
}
