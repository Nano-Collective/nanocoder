import {spawnSync} from 'node:child_process';
import {resolveBinaryOnPath} from '@/tools/git/utils';

/** The editor ran but exited abnormally (as opposed to failing to launch). */
export class EditorExitError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'EditorExitError';
	}
}

export function getEditor(): string {
	return (
		process.env.VISUAL ||
		process.env.EDITOR ||
		(process.env.TERM_PROGRAM === 'vscode'
			? 'code --wait'
			: process.platform === 'win32'
				? 'notepad'
				: 'nano')
	);
}

/** Split quoted editor arguments without evaluating shell expressions. */
export function editorArgs(command: string): string[] {
	const args: string[] = [];
	let word = '';
	let quote = '';
	let started = false;
	for (let i = 0; i < command.length; i++) {
		const char = command.charAt(i);
		const next = command[i + 1];
		if (
			char === '\\' &&
			quote !== "'" &&
			next !== undefined &&
			(next === quote || next === '"' || next === "'" || /\s/.test(next))
		) {
			word += next;
			i++;
			started = true;
		} else if (quote) {
			if (char === quote) quote = '';
			else word += char;
		} else if (char === '"' || char === "'") {
			quote = char;
			started = true;
		} else if (/\s/.test(char)) {
			if (started) args.push(word);
			word = '';
			started = false;
		} else {
			word += char;
			started = true;
		}
	}
	if (quote) throw new Error('Unclosed quote in editor command');
	if (started) args.push(word);
	if (!args[0]) throw new Error('Empty editor command');
	return args;
}

/**
 * Build the command to spawn. On Windows the editor is resolved through
 * PATHEXT (`code` -> `code.cmd`); Node >= 22 refuses to spawn `.cmd`/`.bat`
 * without a shell, so those run through cmd.exe with every argument quoted.
 * Arguments cmd.exe would still interpret inside quotes are rejected.
 */
export function buildEditorCommand(
	editor: string,
	args: string[],
	platform: NodeJS.Platform = process.platform,
	resolve: (name: string) => string | undefined = resolveBinaryOnPath,
): {command: string; args: string[]; verbatim: boolean} {
	if (platform !== 'win32') return {command: editor, args, verbatim: false};
	const resolved = resolve(editor) ?? editor;
	if (!/\.(cmd|bat)$/i.test(resolved)) {
		return {command: resolved, args, verbatim: false};
	}
	for (const part of [resolved, ...args]) {
		if (/["%\r\n]/.test(part)) {
			throw new Error(
				`Cannot launch ${resolved} through cmd.exe because an argument contains " or %. Set EDITOR to an .exe instead.`,
			);
		}
	}
	const line = [resolved, ...args].map(part => `"${part}"`).join(' ');
	return {
		command: process.env.ComSpec || 'cmd.exe',
		args: ['/d', '/s', '/c', `"${line}"`],
		verbatim: true,
	};
}

export function openInEditor(filePath: string): void {
	const [editor, ...args] = editorArgs(getEditor());
	if (!editor) throw new Error('Empty editor command');
	const wasRaw = process.stdin.isRaw;
	try {
		if (wasRaw) process.stdin.setRawMode(false);
		if (process.stdout.isTTY) process.stdout.write('\x1B[?25h');
		const launch = buildEditorCommand(editor, [...args, filePath]);
		const result = spawnSync(launch.command, launch.args, {
			stdio: 'inherit',
			windowsVerbatimArguments: launch.verbatim,
		});
		if (result.error) throw result.error;
		if (result.status !== 0) {
			throw new EditorExitError(
				`Editor exited with ${result.signal ?? `status ${result.status}`}; changes may not be saved`,
			);
		}
	} finally {
		if (wasRaw) process.stdin.setRawMode(true);
		if (process.stdout.isTTY) process.stdout.write('\x1B[?25l');
	}
}
