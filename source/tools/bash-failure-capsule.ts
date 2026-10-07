/**
 * Failure capsules for failed bash commands.
 *
 * The model sees at most TRUNCATION_OUTPUT_LIMIT characters of bash output,
 * cut to the head and the tail. Test runners and compilers print the detail
 * of each failure in the middle - between the progress lines and the summary -
 * so a long failing run used to reach the model as setup noise plus "2 failed",
 * with the assertion that mattered cut out.
 *
 * This module recognises the failure output of common runners, keeps only the
 * failing targets and their diagnostics, re-runs the narrowest command that
 * should reproduce the first failure, and formats all of that as a capsule the
 * model gets instead of the cut log. Parsing is deterministic: no model call.
 */

import {existsSync, readFileSync} from 'node:fs';
import {basename, isAbsolute, join, relative} from 'node:path';
import {TRUNCATION_OUTPUT_LIMIT} from '@/constants';
import {shellQuote} from '@/custom-tools/template';
import type {BashExecutionState} from '@/services/bash-executor';
import {truncateToolResult} from '@/utils/truncate-tool-result';

export type FailureRunner = 'jest' | 'vitest' | 'mocha' | 'ava' | 'tsc';

export interface FailingTarget {
	/** As the runner printed it, e.g. "refreshSession › retries once". */
	title: string;
	/** Test or source file, relative to the working directory when possible. */
	file?: string;
	/** file:line[:col] of the failing assertion or error. */
	location?: string;
	/** The test name the way the runner's name filter matches it. */
	nameFilter?: string;
	/** Message, expected/received and diff lines; no stack or code frame. */
	diagnostic: string[];
}

export interface FailureReport {
	runner: FailureRunner;
	failures: FailingTarget[];
	summary?: string;
}

/** Re-runs a command; resolves null when the re-run was skipped. */
export type RerunCommand = (
	command: string,
) => Promise<BashExecutionState | null>;

const MAX_DIAGNOSTIC_LINES = 8;
const MAX_LINE_CHARS = 160;

// CSI sequences (colours, cursor moves) and OSC sequences (hyperlinks).
const ANSI_PATTERN =
	/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

function stripAnsi(text: string): string {
	return text.replace(ANSI_PATTERN, '');
}

function clip(line: string): string {
	const trimmed = line.trim();
	return trimmed.length > MAX_LINE_CHARS
		? `${trimmed.slice(0, MAX_LINE_CHARS - 1)}…`
		: trimmed;
}

function normalizeFile(file: string, cwd: string): string {
	const withoutDot = file.replace(/^\.\//u, '');
	if (!isAbsolute(withoutDot)) return withoutDot;
	const relativePath = relative(cwd, withoutDot);
	return relativePath.startsWith('..') ? withoutDot : relativePath;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** Quote a shell argument only when it needs it, so flags stay readable. */
function quoteArg(value: string): string {
	return /^[\w./:=@%+,-]+$/u.test(value) ? value : shellQuote(value);
}

// --- shared body handling ---------------------------------------------------

const CODE_FRAME_LINE = /^\s*>?\s*\d+\s*[|:](?:\s|$)/u;
const CARET_LINE = /^\s*\|/u;
const STACK_LINE = /^\s*(?:at\s|❯\s|›\s)/u;
const SEPARATOR_LINE = /^\s*[⎯─]+/u;
const STACK_LOCATION =
	/((?:[A-Za-z]:)?[^\s()]+\.[cm]?[jt]sx?):(\d+)(?::(\d+))?\)?\s*$/u;

/**
 * Split a failure body into the lines worth keeping and the first location
 * that points into the project (not node_modules or Node internals).
 */
function summarizeBody(
	body: string[],
	cwd: string,
): {diagnostic: string[]; location?: string; locationFile?: string} {
	const diagnostic: string[] = [];
	let location: string | undefined;
	let locationFile: string | undefined;
	for (const line of body) {
		if (STACK_LINE.test(line)) {
			const match = STACK_LOCATION.exec(line);
			if (
				!location &&
				match?.[1] &&
				!match[1].includes('node_modules') &&
				!match[1].startsWith('node:')
			) {
				locationFile = normalizeFile(match[1], cwd);
				location = [locationFile, match[2], match[3]].filter(Boolean).join(':');
			}
			continue;
		}
		if (
			!line.trim() ||
			CODE_FRAME_LINE.test(line) ||
			CARET_LINE.test(line) ||
			SEPARATOR_LINE.test(line)
		) {
			continue;
		}
		if (diagnostic.length < MAX_DIAGNOSTIC_LINES) diagnostic.push(clip(line));
	}
	return {diagnostic, location, locationFile};
}

function dedupe(failures: FailingTarget[]): FailingTarget[] {
	const seen = new Set<string>();
	return failures.filter(failure => {
		const key = `${failure.file ?? ''}\0${failure.title}\0${failure.location ?? ''}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

// --- runner parsers -----------------------------------------------------------

function parseJest(lines: string[], cwd: string): FailureReport | null {
	const failures: FailingTarget[] = [];
	let summary: string | undefined;
	let file: string | undefined;
	let current: {title: string; file?: string; body: string[]} | undefined;

	const flush = () => {
		if (!current) return;
		const {diagnostic, location} = summarizeBody(current.body, cwd);
		const suiteFailed = current.title === 'Test suite failed to run';
		failures.push({
			title: current.title,
			file: current.file,
			location,
			nameFilter: suiteFailed
				? undefined
				: current.title.split(' › ').join(' '),
			diagnostic,
		});
		current = undefined;
	};

	for (const line of lines) {
		const suite = /^(FAIL|PASS)\s+(\S+)/u.exec(line);
		if (suite?.[2]) {
			flush();
			file = suite[1] === 'FAIL' ? normalizeFile(suite[2], cwd) : undefined;
			continue;
		}
		const title = /^ {2}● (.+)$/u.exec(line);
		if (title?.[1] && title[1].trim() !== 'Console') {
			flush();
			current = {title: title[1].trim(), file, body: []};
			continue;
		}
		if (/^(?:Test Suites|Tests|Snapshots|Time):/u.test(line)) {
			flush();
			if (line.startsWith('Tests:'))
				summary = line.trim().replace(/\s+/gu, ' ');
			continue;
		}
		current?.body.push(line);
	}
	flush();

	return failures.length > 0
		? {runner: 'jest', failures: dedupe(failures), summary}
		: null;
}

function parseVitest(lines: string[], cwd: string): FailureReport | null {
	const failures: FailingTarget[] = [];
	let summary: string | undefined;
	let current: FailingTarget | undefined;
	let body: string[] = [];

	const flush = () => {
		if (!current) return;
		const {diagnostic, location} = summarizeBody(body, cwd);
		failures.push({...current, location, diagnostic});
		current = undefined;
		body = [];
	};

	for (const line of lines) {
		const test = /^\s*FAIL\s+(\S+)\s+>\s+(.+)$/u.exec(line);
		const suite = /^\s*FAIL\s+(\S+)\s+\[ .+ \]$/u.exec(line);
		if (test?.[1] && test[2]) {
			flush();
			const parts = test[2].trim().split(/\s+>\s+/u);
			current = {
				title: parts.join(' > '),
				file: normalizeFile(test[1], cwd),
				nameFilter: parts.join(' '),
				diagnostic: [],
			};
			continue;
		}
		if (suite?.[1]) {
			flush();
			current = {
				title: 'Test file failed to run',
				file: normalizeFile(suite[1], cwd),
				diagnostic: [],
			};
			continue;
		}
		if (/^\s*Tests\s+.*\bfailed\b/u.test(line)) {
			summary = line.trim().replace(/\s+/gu, ' ');
			continue;
		}
		if (current && SEPARATOR_LINE.test(line)) {
			flush();
			continue;
		}
		if (current) body.push(line);
	}
	flush();

	return failures.length > 0
		? {runner: 'vitest', failures: dedupe(failures), summary}
		: null;
}

function parseMocha(lines: string[], cwd: string): FailureReport | null {
	const failingIndex = lines.findIndex(line => /^\s+\d+ failing\b/u.test(line));
	if (failingIndex === -1) return null;

	const passing = lines
		.slice(0, failingIndex)
		.reverse()
		.find(line => /^\s+\d+ passing\b/u.test(line));
	const summary = [passing?.trim(), lines[failingIndex]?.trim()]
		.filter(Boolean)
		.join(', ');

	const failures: FailingTarget[] = [];
	const rest = lines.slice(failingIndex + 1);
	for (let index = 0; index < rest.length; index++) {
		const header = /^\s+\d+\) (.+)$/u.exec(rest[index] ?? '');
		if (!header?.[1]) continue;

		// The title runs over the header and the lines below it up to the first
		// blank line; the last part ends in ":".
		const titleParts = [header[1].trim()];
		let cursor = index + 1;
		while (cursor < rest.length && rest[cursor]?.trim()) {
			titleParts.push((rest[cursor] ?? '').trim());
			cursor++;
		}
		const lastPart = titleParts.length - 1;
		titleParts[lastPart] = (titleParts[lastPart] ?? '').replace(/:$/u, '');

		// A failure ends with its stack; the first blank line after it closes
		// the body, so trailing output (npm notices, wrapper scripts) stays out.
		const body: string[] = [];
		let sawStack = false;
		while (cursor < rest.length && !/^\s+\d+\) /u.test(rest[cursor] ?? '')) {
			const line = rest[cursor] ?? '';
			if (sawStack && !line.trim()) break;
			if (STACK_LINE.test(line)) sawStack = true;
			body.push(line);
			cursor++;
		}
		index = cursor - 1;

		const {diagnostic, location, locationFile} = summarizeBody(body, cwd);
		failures.push({
			title: titleParts.join(' '),
			file: locationFile,
			location,
			nameFilter: titleParts.join(' '),
			diagnostic,
		});
	}

	return failures.length > 0
		? {runner: 'mocha', failures: dedupe(failures), summary}
		: null;
}

/**
 * AVA prefixes a test title with the file's path segments (without the
 * extension), trimmed to what is needed to tell files apart. Strip the
 * longest suffix of the file's segments that the title starts with.
 */
function avaTestName(title: string, file: string): string {
	const segments = file
		.replace(/\.(?:spec|test)\.[cm]?[jt]sx?$/u, '')
		.replace(/\.[cm]?[jt]sx?$/u, '')
		.split('/');
	for (let take = segments.length; take > 0; take--) {
		const prefix = `${segments.slice(-take).join(' › ')} › `;
		if (title.startsWith(prefix)) return title.slice(prefix.length);
	}
	return title;
}

function parseAva(lines: string[], cwd: string): FailureReport | null {
	const summaryLine = lines.find(line => /^\s+\d+ tests? failed\b/u.test(line));
	const failures: FailingTarget[] = [];
	const isBlockStart = (index: number) =>
		/^ {2}\S/u.test(lines[index] ?? '') &&
		!/^ {2}[✔✘─›]/u.test(lines[index] ?? '') &&
		!lines[index + 1]?.trim() &&
		/^ {2}\S+\.[cm]?[jt]sx?:\d+$/u.test(lines[index + 2] ?? '');

	for (let index = 0; index < lines.length; index++) {
		if (!isBlockStart(index)) continue;
		const title = (lines[index] ?? '').trim();
		const fileLine = (lines[index + 2] ?? '').trim();
		const separator = fileLine.lastIndexOf(':');
		const file = normalizeFile(fileLine.slice(0, separator), cwd);

		const body: string[] = [];
		let cursor = index + 3;
		while (
			cursor < lines.length &&
			!isBlockStart(cursor) &&
			!/^ {2}─\s*$/u.test(lines[cursor] ?? '')
		) {
			body.push(lines[cursor] ?? '');
			cursor++;
		}
		index = cursor - 1;

		const name = avaTestName(title, file);
		const {diagnostic, location} = summarizeBody(body, cwd);
		failures.push({
			title,
			file,
			location: location ?? `${file}:${fileLine.slice(separator + 1)}`,
			// --match treats "*" as a wildcard and a leading "!" as negation.
			nameFilter: /[*]|^!/u.test(name) ? undefined : name,
			diagnostic,
		});
	}

	if (failures.length === 0 && summaryLine) {
		for (const line of lines) {
			const failed = /^\s*✘ \[fail\]: (.+)$/u.exec(line);
			if (failed?.[1]) failures.push({title: failed[1].trim(), diagnostic: []});
		}
	}

	return failures.length > 0
		? {runner: 'ava', failures: dedupe(failures), summary: summaryLine?.trim()}
		: null;
}

function parseTsc(lines: string[], cwd: string): FailureReport | null {
	const failures: FailingTarget[] = [];
	for (const line of lines) {
		const match =
			/^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/u.exec(line) ??
			/^(.+?):(\d+):(\d+) - error (TS\d+): (.+)$/u.exec(line);
		if (!match?.[1]) continue;
		const file = normalizeFile(match[1].trim(), cwd);
		failures.push({
			title: `${match[4]} ${clip(match[5] ?? '')}`,
			file,
			location: `${file}:${match[2]}:${match[3]}`,
			diagnostic: [],
		});
	}
	if (failures.length === 0) return null;
	const found = lines.find(line => /^Found \d+ errors?\b/u.test(line));
	return {
		runner: 'tsc',
		failures: dedupe(failures),
		summary:
			found?.trim() ??
			`${failures.length} TypeScript error${failures.length === 1 ? '' : 's'}`,
	};
}

const PARSERS = [parseVitest, parseJest, parseMocha, parseAva, parseTsc];

/**
 * Recognise a failed run's output. Null when no known runner format matches,
 * in which case the caller keeps the ordinary head-and-tail truncation.
 */
export function parseFailureReport(
	output: string,
	cwd: string,
): FailureReport | null {
	const lines = stripAnsi(output).replace(/\r/gu, '').split('\n');
	for (const parse of PARSERS) {
		const report = parse(lines, cwd);
		if (report) return report;
	}
	return null;
}

// --- narrow re-run command ------------------------------------------------------

const RUNNER_BINARIES: Partial<Record<FailureRunner, string[]>> = {
	jest: ['jest'],
	vitest: ['vitest'],
	mocha: ['mocha', '_mocha'],
	ava: ['ava'],
};

/** Anything a shell would treat as more than one plain command. */
const SHELL_SYNTAX = /[;&|<>`$(){}\\\n]/u;

function tokenize(command: string): string[] | null {
	if (SHELL_SYNTAX.test(command)) return null;
	const singleQuotes = command.split("'").length - 1;
	const doubleQuotes = command.split('"').length - 1;
	if (singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0) return null;
	return (command.match(/'[^']*'|"[^"]*"|[^\s'"]+/gu) ?? []).map(token =>
		token.replace(/^(['"])(.*)\1$/u, '$2'),
	);
}

/** The program a simple command runs, past env assignments and launchers. */
function invokedProgram(tokens: string[]): string | undefined {
	let index = 0;
	while (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(tokens[index] ?? '')) index++;
	const first = tokens[index];
	const second = tokens[index + 1];
	if (first === 'npx' || first === 'bunx') {
		index++;
	} else if (
		(first === 'pnpm' || first === 'yarn') &&
		(second === 'exec' || second === 'dlx')
	) {
		index += 2;
	}
	while (tokens[index]?.startsWith('-')) index++;
	const program = tokens[index];
	return program ? basename(program) : undefined;
}

/** Package-manager invocations of a package.json script. */
function packageScript(
	tokens: string[],
): {script: string; argsNeedSeparator: boolean} | null {
	const [manager, first, second] = tokens;
	if (manager === 'npm') {
		if (first === 'test' || first === 't') {
			return {script: 'test', argsNeedSeparator: true};
		}
		if ((first === 'run' || first === 'run-script') && second) {
			return {script: second, argsNeedSeparator: true};
		}
		return null;
	}
	if (manager === 'pnpm' || manager === 'yarn' || manager === 'bun') {
		if (first === 'run' && second) {
			return {script: second, argsNeedSeparator: false};
		}
		if (manager !== 'bun' && first && !first.startsWith('-')) {
			return {script: first, argsNeedSeparator: false};
		}
	}
	return null;
}

function readPackageScript(cwd: string, script: string): string | undefined {
	const packageJsonPath = join(cwd, 'package.json');
	if (!existsSync(packageJsonPath)) return undefined;
	try {
		const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
		const scripts =
			parsed && typeof parsed === 'object' && 'scripts' in parsed
				? (parsed as {scripts?: Record<string, unknown>}).scripts
				: undefined;
		const body = scripts?.[script];
		return typeof body === 'string' ? body : undefined;
	} catch {
		return undefined;
	}
}

function narrowArgs(runner: FailureRunner, target: FailingTarget): string[] {
	// A path that starts with "-" would be read by the runner as a flag.
	const fileArgs =
		target.file && !target.file.startsWith('-') ? [target.file] : [];
	if (!target.nameFilter) return fileArgs;
	switch (runner) {
		case 'jest':
		case 'vitest':
			return [...fileArgs, '-t', escapeRegExp(target.nameFilter)];
		case 'mocha':
			return [...fileArgs, '--grep', escapeRegExp(target.nameFilter)];
		case 'ava':
			return [...fileArgs, '--match', target.nameFilter];
		default:
			return fileArgs;
	}
}

/**
 * The original command narrowed to the first failing target, or null when it
 * cannot be narrowed safely. Only a plain invocation of the runner that
 * produced the output qualifies - directly, through npx / pnpm exec / yarn
 * exec, or through a package.json script whose body is itself a plain
 * invocation of that runner. Anything with pipes, chaining, redirects or
 * substitutions is left alone, so the re-run is always a subset of what the
 * original command already ran.
 */
export function buildNarrowCommand(
	command: string,
	report: FailureReport,
	cwd: string,
): string | null {
	const binaries = RUNNER_BINARIES[report.runner];
	const target = report.failures[0];
	if (!binaries || !target) return null;

	const trimmed = command.trim();
	const tokens = tokenize(trimmed);
	if (!tokens) return null;

	let argsNeedSeparator = false;
	const program = invokedProgram(tokens);
	if (!program || !binaries.includes(program)) {
		const script = packageScript(tokens);
		if (!script) return null;
		const body = readPackageScript(cwd, script.script);
		const bodyTokens = body ? tokenize(body.trim()) : null;
		const scriptProgram = bodyTokens ? invokedProgram(bodyTokens) : undefined;
		if (!scriptProgram || !binaries.includes(scriptProgram)) return null;
		argsNeedSeparator = script.argsNeedSeparator && !tokens.includes('--');
	}

	const args = narrowArgs(report.runner, target);
	// Don't repeat a file the command already names.
	const extraArgs =
		target.file && tokens.includes(target.file)
			? args.filter(arg => arg !== target.file)
			: args;
	if (extraArgs.length === 0) return null;
	return [
		trimmed,
		...(argsNeedSeparator ? ['--'] : []),
		...extraArgs.map(quoteArg),
	].join(' ');
}

// --- capsule ------------------------------------------------------------------

function describeRerun(rerun: BashExecutionState | null | undefined): string[] {
	if (!rerun) return [];
	if (rerun.error !== null) {
		return [`Re-ran it on its own: could not finish (${rerun.error}).`];
	}
	if ((rerun.exitCode ?? 0) !== 0) {
		return [`Re-ran it on its own: still fails (exit ${rerun.exitCode}).`];
	}
	return [
		'Re-ran it on its own: it passed, so the failure depends on other tests or is flaky.',
	];
}

function formatTarget(index: number, target: FailingTarget): string {
	// A compiler error is fully described by where it is and what it says.
	if (target.diagnostic.length === 0 && target.location) {
		return `${index}) ${target.location} ${target.title}`;
	}
	const lines = [`${index}) ${target.title}`];
	if (target.location) lines.push(`   at ${target.location}`);
	else if (target.file) lines.push(`   in ${target.file}`);
	for (const line of target.diagnostic) lines.push(`   ${line}`);
	return lines.join('\n');
}

export function formatFailureCapsule(options: {
	result: BashExecutionState;
	report: FailureReport;
	narrowCommand: string | null;
	rerun?: BashExecutionState | null;
	originalLength: number;
}): string {
	const {result, report, narrowCommand, rerun, originalLength} = options;
	const count = report.failures.length;
	const noun =
		report.runner === 'tsc' ? (count === 1 ? 'error' : 'errors') : 'failing';
	const header = [
		...(result.exitCode !== null ? [`EXIT_CODE: ${result.exitCode}`] : []),
		`FAILURE CAPSULE (${report.runner}): ${count} ${noun}. Distilled from ${originalLength} characters of output; only the failures are kept.`,
		`Reproduce: ${narrowCommand ?? result.command}`,
		...describeRerun(rerun),
	].join('\n');
	const footer = report.summary ? `\nSummary: ${report.summary}` : '';
	const separator = report.runner === 'tsc' ? '\n' : '\n\n';

	// Keep whole targets while they fit; the model can re-run for the rest.
	const blocks: string[] = [];
	let used = header.length + footer.length;
	for (const [index, target] of report.failures.entries()) {
		const block = `${index === 0 ? '\n\n' : separator}${formatTarget(index + 1, target)}`;
		const more = `\n\n+${count - index} more ${report.runner === 'tsc' ? 'errors' : 'failing'} (not shown).`;
		if (used + block.length + more.length > TRUNCATION_OUTPUT_LIMIT) {
			blocks.push(more);
			break;
		}
		blocks.push(block);
		used += block.length;
	}

	return truncateToolResult(
		`${header}${blocks.join('')}${footer}`,
		TRUNCATION_OUTPUT_LIMIT,
	);
}

/**
 * The capsule for a failed run, or null when the output isn't recognised.
 * `rerun` runs the narrowed command; leave it out to only distill.
 */
export async function buildFailureCapsule(
	result: BashExecutionState,
	options: {cwd: string; originalLength: number; rerun?: RerunCommand},
): Promise<string | null> {
	const report = parseFailureReport(
		`${result.fullOutput}\n${result.stderr}`,
		options.cwd,
	);
	if (!report) return null;

	const narrowCommand = buildNarrowCommand(result.command, report, options.cwd);
	let rerun: BashExecutionState | null = null;
	if (narrowCommand && options.rerun) {
		try {
			rerun = await options.rerun(narrowCommand);
		} catch {
			rerun = null;
		}
	}

	return formatFailureCapsule({
		result,
		report,
		narrowCommand,
		rerun,
		originalLength: options.originalLength,
	});
}
