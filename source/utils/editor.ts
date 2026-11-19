import {spawnSync} from 'node:child_process';

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

export function openInEditor(filePath: string): void {
	const [editor, ...args] = editorArgs(getEditor());
	if (!editor) throw new Error('Empty editor command');
	const wasRaw = process.stdin.isRaw;
	try {
		if (wasRaw) process.stdin.setRawMode(false);
		if (process.stdout.isTTY) process.stdout.write('\x1B[?25h');
		const result = spawnSync(editor, [...args, filePath], {stdio: 'inherit'});
		if (result.error) throw result.error;
		if (result.status !== 0) {
			throw new Error(
				`Editor exited with ${result.signal ?? `status ${result.status}`}`,
			);
		}
	} finally {
		if (wasRaw) process.stdin.setRawMode(true);
		if (process.stdout.isTTY) process.stdout.write('\x1B[?25l');
	}
}
