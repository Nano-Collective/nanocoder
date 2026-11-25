import {readFileSync} from 'node:fs';
import path from 'node:path';
import {getAppConfig} from '@/config/index';
import {getProjectRoot} from '@/services/session-cwd';
import {isFileMutationTool} from '@/tools/runtime/tool-approval';
import type {Message, ToolCall, ToolResult} from '@/types/core';

/**
 * Evidence that a turn's edits were verified. `nanocoder.verify.required`
 * names commands that must exit 0 after the last edit; when the model tries to
 * finish without that, the loop sends it back to run them. Built once per user
 * turn, so it is a per-task ledger.
 */

/** Times a turn may be sent back before the model can finish unverified. */
const MAX_REJECTIONS = 2;

/** The package.json scripts `required: "auto"` looks for. */
const AUTO_SCRIPTS = ['test', 'typecheck', 'lint'];

const INTERNAL_PREFIX = '<nanocoder-internal-verification>';

/** Leading `VAR=value` assignments, so `CI=1 pnpm test` still runs `pnpm test`. */
const ENV_PREFIX = '^(?:[A-Za-z_]\\w*=\\S*\\s+)*';

interface ParsedCommand {
	/** The parts joined by `&&`, so `cd app && pnpm test` is two commands. */
	segments: string[];
	/**
	 * A pipe, `;`, newline or background `&` outside quotes can hide the real
	 * exit code (`pnpm test | tail` exits 0 whatever the tests did). A `|` or
	 * `;` inside quotes, `&&` and a redirect such as `2>&1` do not.
	 */
	masksExitStatus: boolean;
}

/** Split a bash command on unquoted `&&` and note whether it masks its exit code. */
function parseCommand(command: string): ParsedCommand {
	const segments: string[] = [];
	let current = '';
	let quote: string | null = null;
	let masksExitStatus = false;

	for (let i = 0; i < command.length; i++) {
		const char = command[i];
		if (quote) {
			current += char;
			if (char === '\\' && quote === '"') {
				current += command[++i] ?? '';
			} else if (char === quote) {
				quote = null;
			}
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			current += char;
			continue;
		}
		if (char === '\\') {
			current += char + (command[++i] ?? '');
			continue;
		}
		if (char === '&' && command[i + 1] === '&') {
			segments.push(current);
			current = '';
			i++;
			continue;
		}
		if (char === '|' || char === ';' || char === '\n') {
			masksExitStatus = true;
		} else if (
			char === '&' &&
			command[i - 1] !== '>' &&
			command[i - 1] !== '<' &&
			command[i + 1] !== '>'
		) {
			masksExitStatus = true;
		}
		current += char;
	}
	segments.push(current);

	return {
		segments: segments.map(segment => segment.trim()).filter(Boolean),
		masksExitStatus,
	};
}

interface RequiredEvidence {
	label: string;
	/** Matches the start of one `&&` segment, so `echo pnpm test` never counts. */
	matches: RegExp;
}

interface EvidenceEntry {
	command: string;
	segments: string[];
	masksExitStatus: boolean;
	exitCode: number | null;
	at: string;
	/** Order among edits and commands; later than `lastEditSeq` means fresh. */
	seq: number;
}

export interface CompletionLedger {
	required: RequiredEvidence[];
	entries: EvidenceEntry[];
	/** Position of the latest successful edit, 0 when nothing was edited. */
	lastEditSeq: number;
	seq: number;
	rejections: number;
}

interface EvidenceStatus {
	label: string;
	ok: boolean;
	detail: string;
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The command at the start of a segment, as a whole word run: `pnpm test`
 * matches `pnpm test -- x` and `CI=1 pnpm test`, not `pnpm test:all` or
 * `echo pnpm test`.
 */
function commandPattern(command: string): RegExp {
	const words = command.trim().split(/\s+/).map(escapeRegExp).join('\\s+');
	// `command` is the user's own `nanocoder.verify.required` entry, not
	// attacker input. Every word goes through escapeRegExp and is joined by a
	// fixed `\s+`; the rest is a fixed prefix and lookahead with no nested
	// quantifiers over the same characters, so ReDoS is not reachable.
	// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
	return new RegExp(`${ENV_PREFIX}${words}(?![\\w:./-])`);
}

function detectPackageManager(root: string): string {
	for (const [lockfile, manager] of [
		['pnpm-lock.yaml', 'pnpm'],
		['yarn.lock', 'yarn'],
		['bun.lock', 'bun'],
		['bun.lockb', 'bun'],
	] as const) {
		try {
			readFileSync(path.join(root, lockfile));
			return manager;
		} catch {
			// Not this package manager.
		}
	}
	return 'npm';
}

function detectRequired(root: string): RequiredEvidence[] {
	let scripts: Record<string, unknown>;
	try {
		const parsed = JSON.parse(
			readFileSync(path.join(root, 'package.json'), 'utf8'),
		) as {scripts?: Record<string, unknown>};
		scripts = parsed.scripts ?? {};
	} catch {
		return [];
	}

	const manager = detectPackageManager(root);
	return AUTO_SCRIPTS.filter(name => typeof scripts[name] === 'string').map(
		name => ({
			label: name === 'test' ? `${manager} test` : `${manager} run ${name}`,
			// `name` is one of the fixed AUTO_SCRIPTS entries (test, typecheck,
			// lint), never user input, so the pattern is effectively a constant.
			// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
			matches: new RegExp(
				`${ENV_PREFIX}(?:npm|pnpm|yarn|bun)\\s+(?:run\\s+)?${name}(?![\\w:./-])`,
			),
		}),
	);
}

export function createCompletionLedger(): CompletionLedger {
	let required: RequiredEvidence[] = [];
	try {
		const configured = getAppConfig().verify?.required;
		if (configured === 'auto') {
			required = detectRequired(getProjectRoot());
		} else if (configured) {
			required = configured.map(command => ({
				label: command.trim(),
				matches: commandPattern(command),
			}));
		}
	} catch {
		// Unreadable config leaves completion evidence off, as if unset.
	}
	return {required, entries: [], lastEditSeq: 0, seq: 0, rejections: 0};
}

function commandOf(toolCall: ToolCall): string {
	let args: unknown = toolCall.function.arguments;
	if (typeof args === 'string') {
		try {
			args = JSON.parse(args);
		} catch {
			return '';
		}
	}
	const command = (args as {command?: unknown} | null)?.command;
	return typeof command === 'string' ? command : '';
}

/**
 * Note one finished tool call. An edit makes earlier evidence stale; an
 * execute_bash run is kept with its exit code, which is parsed from the
 * result because a non-zero exit is not always flagged as an error.
 */
export function recordToolOutcome(
	ledger: CompletionLedger,
	toolCall: ToolCall,
	result: ToolResult,
): void {
	if (ledger.required.length === 0) return;

	const name = toolCall.function.name;
	if (isFileMutationTool(name)) {
		if (!result.isError && !result.content.startsWith('Error')) {
			ledger.lastEditSeq = ++ledger.seq;
		}
		return;
	}
	if (name !== 'execute_bash') return;

	const exit = /^EXIT_CODE: (-?\d+)/.exec(result.content);
	const command = commandOf(toolCall);
	ledger.entries.push({
		command,
		...parseCommand(command),
		exitCode: exit ? Number(exit[1]) : null,
		at: new Date().toISOString(),
		seq: ++ledger.seq,
	});
}

function checkEvidence(ledger: CompletionLedger): EvidenceStatus[] {
	return ledger.required.map(({label, matches}) => {
		const runs = ledger.entries.filter(entry =>
			entry.segments.some(segment => matches.test(segment)),
		);
		const fresh = runs.find(
			entry =>
				entry.exitCode === 0 &&
				entry.seq > ledger.lastEditSeq &&
				!entry.masksExitStatus,
		);
		if (fresh) return {label, ok: true, detail: 'exit 0'};

		const last = runs[runs.length - 1];
		if (!last) return {label, ok: false, detail: 'not run'};
		if (last.seq < ledger.lastEditSeq) {
			return {label, ok: false, detail: 'not run since your last edit'};
		}
		return {
			label,
			ok: false,
			detail:
				last.exitCode === 0
					? 'its exit code was hidden by a pipe, `;` or `||`'
					: `last run exited ${last.exitCode ?? 'without an exit code'}`,
		};
	});
}

/**
 * A message sending the model back to verify, or null when the turn may end:
 * nothing was edited, the evidence is fresh, or it was already sent back
 * `MAX_REJECTIONS` times.
 */
export function takeEvidenceRejection(
	ledger: CompletionLedger,
): Message | null {
	if (ledger.lastEditSeq === 0 || ledger.rejections >= MAX_REJECTIONS) {
		return null;
	}
	const missing = checkEvidence(ledger).filter(status => !status.ok);
	if (missing.length === 0) return null;

	ledger.rejections++;
	return {
		role: 'user',
		content:
			`${INTERNAL_PREFIX}\n` +
			'You changed files but have not verified them since your last edit. You must run each command below and fix any failure before finishing:\n' +
			`${missing.map(status => `- \`${status.label}\` (${status.detail})`).join('\n')}\n` +
			'Run each command on its own so its exit code is reported (no pipes, `;` or `||`). ' +
			'Once they pass, reply with only a concise confirmation and do not repeat your previous answer.\n' +
			'</nanocoder-internal-verification>',
	};
}

export function isEvidenceRejectionMessage(message: Message): boolean {
	return message.role === 'user' && message.content.startsWith(INTERNAL_PREFIX);
}

/** One line for the final response, or null when no evidence was required. */
export function formatVerificationSummary(
	ledger: CompletionLedger,
): string | null {
	if (ledger.lastEditSeq === 0 || ledger.required.length === 0) return null;
	return `Verification: ${checkEvidence(ledger)
		.map(
			status => `${status.ok ? '✓' : '✗'} ${status.label} (${status.detail})`,
		)
		.join(' · ')}`;
}
