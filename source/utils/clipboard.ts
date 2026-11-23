/**
 * Clipboard writer with an OSC 52 fallback.
 *
 * `clipboardy` writes to the clipboard of the machine the process runs on. Over
 * SSH, in a container or on a headless box that is either the wrong clipboard
 * or no clipboard at all. Most modern terminals accept the OSC 52 escape
 * sequence, which asks the terminal itself to set the local clipboard, even
 * across SSH. The program cannot see whether the terminal accepted it, so the
 * caller gets back which route was used and words its message accordingly.
 */
import clipboard from 'clipboardy';

export type ClipboardRoute = 'system' | 'osc52';

export type ClipboardDependencies = {
	writeSystem: (text: string) => Promise<void>;
	writeTerminal: (data: string) => void;
	isTerminal: () => boolean;
	env: NodeJS.ProcessEnv;
};

/**
 * Longest base64 payload sent to the terminal. xterm accepts 100,000 bytes and
 * several terminals and multiplexers drop larger sequences without a sound.
 */
export const OSC52_MAX_BASE64_LENGTH = 100_000;

const ESC = '\u001b';
const BEL = '\u0007';

const defaultDependencies: ClipboardDependencies = {
	writeSystem: text => clipboard.write(text),
	writeTerminal: data => {
		process.stdout.write(data);
	},
	isTerminal: () => Boolean(process.stdout.isTTY),
	env: process.env,
};

function isRemoteSession(env: NodeJS.ProcessEnv): boolean {
	return Boolean(env.SSH_TTY || env.SSH_CONNECTION);
}

/**
 * Build the OSC 52 sequence for `text`, wrapped for tmux or GNU screen when
 * running inside one so the multiplexer passes it through to the terminal.
 * Returns `undefined` when the payload is too large to be sent safely.
 */
export function buildOsc52Sequence(
	text: string,
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	const payload = Buffer.from(text, 'utf8').toString('base64');
	if (payload.length > OSC52_MAX_BASE64_LENGTH) {
		return undefined;
	}

	const sequence = `${ESC}]52;c;${payload}${BEL}`;

	if (env.TMUX) {
		// tmux passthrough: every ESC inside the wrapped sequence is doubled.
		return `${ESC}Ptmux;${sequence.replaceAll(ESC, `${ESC}${ESC}`)}${ESC}\\`;
	}
	if (env.STY) {
		return `${ESC}P${sequence}${ESC}\\`;
	}
	return sequence;
}

function sendOsc52(text: string, dependencies: ClipboardDependencies): boolean {
	if (!dependencies.isTerminal()) {
		return false;
	}
	const sequence = buildOsc52Sequence(text, dependencies.env);
	if (sequence === undefined) {
		return false;
	}
	dependencies.writeTerminal(sequence);
	return true;
}

/**
 * Copy `text` to the clipboard.
 *
 * - Over SSH the system clipboard is the remote machine's, so the text is also
 *   sent through OSC 52 and the result is `osc52`, even if the system write
 *   succeeded or failed.
 * - Elsewhere the system clipboard is tried first and OSC 52 is only the
 *   fallback when it fails.
 * - When neither route works, the original system error is thrown.
 */
export async function copyTextToClipboard(
	text: string,
	dependencies: ClipboardDependencies = defaultDependencies,
): Promise<ClipboardRoute> {
	let systemError: unknown;
	let systemWorked = false;
	try {
		await dependencies.writeSystem(text);
		systemWorked = true;
	} catch (error) {
		systemError = error;
	}

	if (isRemoteSession(dependencies.env) || !systemWorked) {
		if (sendOsc52(text, dependencies)) {
			return 'osc52';
		}
	}

	if (systemWorked) {
		return 'system';
	}
	throw systemError;
}
