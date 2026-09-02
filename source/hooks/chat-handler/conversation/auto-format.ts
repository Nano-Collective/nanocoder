import {type ChildProcess, spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {extname, isAbsolute, resolve} from 'node:path';
import {shellQuote} from '@/custom-tools/template';
import type {AutoFormatConfig, AutoFormatFormatterConfig} from '@/types/config';
import type {ToolCall, ToolResult} from '@/types/core';
import {collectEditedPaths} from './auto-diagnostics';

export interface AutoFormatOutcome {
	path: string;
	command: string;
	success: boolean;
	error?: string;
}

function matchFormatter(
	path: string,
	formatters: AutoFormatFormatterConfig[],
): AutoFormatFormatterConfig | undefined {
	const ext = extname(path).slice(1).toLowerCase();
	if (!ext) return undefined;
	return formatters.find(formatter =>
		formatter.extensions.some(
			configured => configured.replace(/^\./, '').toLowerCase() === ext,
		),
	);
}

function pickShell(): string {
	if (process.platform === 'win32') return process.env.ComSpec || 'cmd.exe';
	return existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh';
}

function isWindowsCmd(shell: string): boolean {
	const name = shell.replaceAll('\\', '/').split('/').pop() ?? '';
	return /^cmd(\.exe)?$/i.test(name);
}

/**
 * Run one formatter command to completion. Resolves on a zero exit, rejects
 * otherwise (non-zero exit, spawn failure, or timeout) — the caller treats
 * every rejection the same way: log and move on, never surface to the model.
 */
function runFormatterCommand(
	command: string,
	cwd: string,
	timeoutMs: number,
): Promise<void> {
	return new Promise((resolvePromise, rejectPromise) => {
		const shell = pickShell();
		const args = isWindowsCmd(shell)
			? ['/d', '/s', '/c', command]
			: ['-c', command];
		let child: ChildProcess;
		try {
			child = spawn(shell, args, {cwd, stdio: 'ignore'});
		} catch (error) {
			rejectPromise(error instanceof Error ? error : new Error(String(error)));
			return;
		}

		let settled = false;
		const timer = setTimeout(() => {
			settled = true;
			child.kill('SIGTERM');
			setTimeout(() => {
				if (!child.killed) child.kill('SIGKILL');
			}, 1_000).unref();
			rejectPromise(new Error(`timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		timer.unref();

		child.on('error', error => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			rejectPromise(error);
		});

		child.on('close', code => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (code !== 0) {
				rejectPromise(new Error(`exited with code ${code}`));
				return;
			}
			resolvePromise();
		});
	});
}

/**
 * Run configured formatters against every file successfully touched by an
 * edit tool (`write_file`, `string_replace`) this turn. Silent on success;
 * every failure (no match, non-zero exit, timeout, missing binary) is
 * captured as an outcome instead of thrown, so a misconfigured or missing
 * formatter never interrupts the conversation.
 */
export async function runAutoFormat(
	toolCalls: ToolCall[],
	results: ToolResult[],
	config: AutoFormatConfig | undefined,
	cwd: string,
): Promise<AutoFormatOutcome[]> {
	if (!config?.enabled || config.formatters.length === 0) return [];

	const editedPaths = collectEditedPaths(toolCalls, results);
	if (editedPaths.length === 0) return [];

	const outcomes: AutoFormatOutcome[] = [];

	for (const path of editedPaths) {
		const formatter = matchFormatter(path, config.formatters);
		if (!formatter) continue;

		const absolutePath = isAbsolute(path) ? path : resolve(cwd, path);
		const command = formatter.command.replaceAll(
			'{file}',
			shellQuote(absolutePath),
		);

		try {
			await runFormatterCommand(command, cwd, config.timeoutMs);
			outcomes.push({path, command: formatter.command, success: true});
		} catch (error) {
			outcomes.push({
				path,
				command: formatter.command,
				success: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return outcomes;
}
