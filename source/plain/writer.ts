import {EOL} from 'node:os';

// Re-checked on each call so tests can flip env vars without re-importing.
function ansiEnabled(): boolean {
	if (process.env.NO_COLOR) return false;
	if (process.env.FORCE_COLOR) return true;
	return Boolean(process.stdout.isTTY);
}

const COLOR_CODES = {
	reset: '\x1b[0m',
	dim: '\x1b[2m',
	bold: '\x1b[1m',
	red: '\x1b[31m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	blue: '\x1b[34m',
	magenta: '\x1b[35m',
	cyan: '\x1b[36m',
	gray: '\x1b[90m',
} as const;

export type ColorName = keyof typeof COLOR_CODES;

export function color(name: ColorName, text: string): string {
	if (!ansiEnabled()) return text;
	return `${COLOR_CODES[name]}${text}${COLOR_CODES.reset}`;
}

export function write(chunk: string): void {
	process.stdout.write(chunk);
}

export function writeLine(line = ''): void {
	process.stdout.write(line + EOL);
}

export function writeError(line: string): void {
	process.stderr.write(color('red', line) + EOL);
}

export function writeStatus(line: string): void {
	process.stderr.write(color('gray', `[plain] ${line}`) + EOL);
}

export function writeBoot(provider: string, model: string, mode: string): void {
	const summary = `nanocoder · ${provider} · ${model} · ${mode}`;
	process.stderr.write(color('cyan', summary) + EOL);
}

export function isAnsiEnabled(): boolean {
	return ansiEnabled();
}
