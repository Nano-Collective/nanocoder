import * as vscode from 'vscode';
import type {ChatWebviewProvider} from './chat-webview-provider';

/** Most output sent to the model. The end is kept: that is where the error is. */
export const MAX_TERMINAL_OUTPUT_CHARS = 8000;
const FIX_ACTION = 'Fix with Nanocoder';
const MAX_NOTICE_COMMAND_CHARS = 80;
// The shell's exit code when the user stops a command with Ctrl+C.
const SIGINT_EXIT_CODE = 130;

// Terminal output carries colours and the shell integration's own markers.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching escape sequences is the point
const ESCAPE_SEQUENCES =
	/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-Z\\-_]/g;

export function cleanTerminalOutput(raw: string): string {
	const text = raw.replace(ESCAPE_SEQUENCES, '').replace(/\r\n?/g, '\n').trim();
	return text.length > MAX_TERMINAL_OUTPUT_CHARS
		? text.slice(-MAX_TERMINAL_OUTPUT_CHARS)
		: text;
}

export function buildTerminalErrorPrompt(error: {
	commandLine: string;
	exitCode: number;
	cwd?: string;
	output: string;
}): string {
	const lines = [
		`A command I ran in the terminal failed with exit code ${error.exitCode}. Find the cause and fix it.`,
		'',
		`Command: ${error.commandLine}`,
	];
	if (error.cwd) {
		lines.push(`Working directory: ${error.cwd}`);
	}
	lines.push(
		'',
		'Output:',
		'```',
		error.output || '(no output captured)',
		'```',
	);
	return lines.join('\n');
}

/**
 * `execution.read()` only yields what is written after it is first called, so
 * the stream has to be drained from the moment the command starts. Only the
 * tail is kept, with room for the escape sequences cleaned out afterwards.
 */
async function collectTail(stream: AsyncIterable<string>): Promise<string> {
	let tail = '';
	try {
		for await (const chunk of stream) {
			tail = (tail + chunk).slice(-MAX_TERMINAL_OUTPUT_CHARS * 4);
		}
	} catch {
		// The terminal went away mid-command; use what arrived.
	}
	return tail;
}

/**
 * Offers a "Fix with Nanocoder" action when a command fails in an integrated
 * terminal, and sends the command and its output to the chat when taken. Needs
 * the terminal's shell integration to report exit codes; without it no
 * execution events fire and nothing is offered.
 */
export function registerTerminalErrorWatcher(
	chatProvider: Pick<ChatWebviewProvider, 'sendPrompt'>,
): vscode.Disposable {
	const outputs = new Map<vscode.TerminalShellExecution, Promise<string>>();

	const started = vscode.window.onDidStartTerminalShellExecution(event => {
		if (
			vscode.workspace
				.getConfiguration('nanocoder')
				.get<boolean>('terminalErrors', true)
		) {
			outputs.set(event.execution, collectTail(event.execution.read()));
		}
	});

	const ended = vscode.window.onDidEndTerminalShellExecution(async event => {
		const output = outputs.get(event.execution);
		outputs.delete(event.execution);
		const {exitCode} = event;
		if (
			!output ||
			exitCode === undefined ||
			exitCode === 0 ||
			exitCode === SIGINT_EXIT_CODE
		) {
			return;
		}

		const commandLine = event.execution.commandLine.value;
		const shown =
			commandLine.length > MAX_NOTICE_COMMAND_CHARS
				? `${commandLine.slice(0, MAX_NOTICE_COMMAND_CHARS)}...`
				: commandLine;
		const choice = await vscode.window.showWarningMessage(
			`Nanocoder: "${shown}" failed with exit code ${exitCode}.`,
			FIX_ACTION,
		);
		if (choice === FIX_ACTION) {
			await chatProvider.sendPrompt(
				buildTerminalErrorPrompt({
					commandLine,
					exitCode,
					cwd: event.execution.cwd?.fsPath,
					output: cleanTerminalOutput(await output),
				}),
			);
		}
	});

	return vscode.Disposable.from(started, ended);
}
