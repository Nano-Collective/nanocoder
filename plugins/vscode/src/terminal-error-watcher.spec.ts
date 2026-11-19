import test from 'ava';
import * as vscode from 'vscode';
import {
	buildTerminalErrorPrompt,
	cleanTerminalOutput,
	MAX_TERMINAL_OUTPUT_CHARS,
	registerTerminalErrorWatcher,
} from './terminal-error-watcher';

const {__test} = vscode as unknown as {__test: any};

const FIX_ACTION = 'Fix with Nanocoder';

test.beforeEach(() => {
	__test.reset();
});

function fakeExecution(
	chunks: string[],
	commandLine = 'pnpm test',
	cwd?: string,
) {
	const execution = {
		reads: 0,
		ended: false,
		commandLine: {value: commandLine},
		cwd: cwd ? vscode.Uri.file(cwd) : undefined,
		// Like the real API: only output written after `read()` is first called
		// comes through, so a stream opened once the command ended is empty.
		read() {
			execution.reads++;
			const live = !execution.ended;
			return (async function* () {
				if (!live) return;
				for (const chunk of chunks) yield chunk;
			})();
		},
	};
	return execution;
}

/** Runs one command through the listeners, as the terminal would. */
async function runCommand(
	execution: ReturnType<typeof fakeExecution>,
	exitCode: number | undefined,
) {
	await Promise.all(
		__test.terminalListeners.start.map((l: any) => l({execution})),
	);
	execution.ended = true;
	await Promise.all(
		__test.terminalListeners.end.map((l: any) => l({execution, exitCode})),
	);
}

function watch() {
	const sent: string[] = [];
	registerTerminalErrorWatcher({
		sendPrompt: async (text: string) => {
			sent.push(text);
		},
	});
	return sent;
}

test('cleanTerminalOutput removes colours and shell integration markers', t => {
	const raw =
		'\u001b]633;C\u0007\u001b[31mError:\u001b[0m boom\r\n\u001b]633;D;1\u001b\\done';
	t.is(cleanTerminalOutput(raw), 'Error: boom\ndone');
});

test('cleanTerminalOutput removes the whole range of CSI sequences', t => {
	const raw =
		'\u001b[?25l\u001b[38;2;10;20;30mrgb\u001b[2K\u001b[1;31;4m!\u001b[0m\u001b[3 q';
	t.is(cleanTerminalOutput(raw), 'rgb!');
});

test('cleanTerminalOutput removes OSC links and titles, with either terminator', t => {
	const raw =
		'\u001b]8;;https://example.test\u0007click\u001b]8;;\u0007 \u001b]0;title\u001b\\here';
	t.is(cleanTerminalOutput(raw), 'click here');
});

test('cleanTerminalOutput removes charset and other multi-byte escapes', t => {
	t.is(cleanTerminalOutput('\u001b(Bhello\u001b#8 world'), 'hello world');
});

test('cleanTerminalOutput drops an OSC that was cut off before its terminator', t => {
	t.is(
		cleanTerminalOutput('failed\n\u001b]0;window title never ended'),
		'failed',
	);
});

test('cleanTerminalOutput never leaves an escape character behind', t => {
	t.notRegex(cleanTerminalOutput('a\u001b b\u001b[31m c\u001b'), /\u001b/);
});

test('cleanTerminalOutput keeps the end of long output, where the error is', t => {
	const cleaned = cleanTerminalOutput(
		`${'x'.repeat(MAX_TERMINAL_OUTPUT_CHARS + 500)}FINAL ERROR`,
	);
	t.is(cleaned.length, MAX_TERMINAL_OUTPUT_CHARS);
	t.true(cleaned.endsWith('FINAL ERROR'));
});

test('buildTerminalErrorPrompt names the command, exit code, directory and output', t => {
	const prompt = buildTerminalErrorPrompt({
		commandLine: 'pnpm build',
		exitCode: 2,
		cwd: '/repo',
		output: 'TS2304: Cannot find name',
	});
	t.regex(prompt, /exit code 2/);
	t.regex(prompt, /Command: pnpm build/);
	t.regex(prompt, /Working directory: \/repo/);
	t.regex(prompt, /```\nTS2304: Cannot find name\n```/);
});

test('buildTerminalErrorPrompt leaves out an unknown directory and says when there was no output', t => {
	const prompt = buildTerminalErrorPrompt({
		commandLine: 'make',
		exitCode: 1,
		output: '',
	});
	t.notRegex(prompt, /Working directory/);
	t.regex(prompt, /\(no output captured\)/);
});

test('a failed command offers the fix and sends the cleaned output when taken', async t => {
	const sent = watch();
	__test.messageChoice = FIX_ACTION;
	// The escape sequence is split across two chunks, as a stream can deliver it.
	const execution = fakeExecution(
		['npm ERR! \u001b[3', '1mfailed\u001b[0m\n'],
		'npm test',
		'/repo',
	);

	await runCommand(execution, 1);

	t.is(__test.shownMessages.length, 1);
	t.is(__test.shownMessages[0].kind, 'warning');
	t.regex(
		__test.shownMessages[0].message,
		/"npm test" failed with exit code 1/,
	);
	t.is(sent.length, 1);
	t.regex(sent[0], /Command: npm test/);
	t.regex(sent[0], /exit code 1/);
	t.regex(sent[0], /Working directory: \/repo/);
	t.regex(sent[0], /npm ERR! failed/);
	t.notRegex(sent[0], /\u001b/);
});

test('dismissing the notification sends nothing', async t => {
	const sent = watch();
	await runCommand(fakeExecution(['boom']), 1);
	t.is(__test.shownMessages.length, 1);
	t.deepEqual(sent, []);
});

test('success, Ctrl+C and an unknown exit code are not offered', async t => {
	const sent = watch();
	__test.messageChoice = FIX_ACTION;
	await runCommand(fakeExecution(['ok']), 0);
	await runCommand(fakeExecution(['^C']), 130);
	await runCommand(fakeExecution(['?']), undefined);
	t.deepEqual(__test.shownMessages, []);
	t.deepEqual(sent, []);
});

test('turning the setting off stops reading output and offering the fix', async t => {
	const sent = watch();
	__test.messageChoice = FIX_ACTION;
	__test.configuration = (_section: string, key: string, fallback: unknown) =>
		key === 'terminalErrors' ? false : fallback;
	const execution = fakeExecution(['boom']);

	await runCommand(execution, 1);

	t.is(execution.reads, 0);
	t.deepEqual(__test.shownMessages, []);
	t.deepEqual(sent, []);
});

test('a long command line is shortened in the notification but sent whole', async t => {
	const sent = watch();
	__test.messageChoice = FIX_ACTION;
	const commandLine = `node ${'a'.repeat(200)}`;

	await runCommand(fakeExecution(['boom'], commandLine), 1);

	t.true(__test.shownMessages[0].message.length < 150);
	t.regex(__test.shownMessages[0].message, /\.\.\./);
	t.regex(sent[0], new RegExp(`Command: ${commandLine}`));
});
