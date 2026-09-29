import type {collectStorageReport} from './diagnostics.js';

const STORAGE_USAGE = `Usage: nanocoder storage [--format json]

Inspect sessions, artifacts, timeline, and checkpoints (read-only).

Options:
  --format json   Print one JSON report to stdout and exit (no TTY needed)
  -h, --help      Show this help

Interactive controls: Up/Down select, Enter open, Esc back, q or Ctrl+C exit.`;

/** The storage command accepts no chat/runtime flags or positional arguments. */
export function parseStorageArgs(
	args: readonly string[],
): {mode: 'help' | 'interactive' | 'json'} | {error: string} {
	if (args.length === 0) return {mode: 'interactive'};
	if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
		return {mode: 'help'};
	}
	if (
		(args.length === 2 && args[0] === '--format' && args[1] === 'json') ||
		(args.length === 1 && args[0] === '--format=json')
	) {
		return {mode: 'json'};
	}
	return {
		error: `Invalid storage arguments: ${args.join(' ')}\n${STORAGE_USAGE}`,
	};
}

export async function runStorageCli(
	args: readonly string[],
	options: {
		isTTY?: boolean;
		collect?: typeof collectStorageReport;
		stdout?: (text: string) => void;
		stderr?: (text: string) => void;
	} = {},
): Promise<number> {
	const out = options.stdout ?? (text => process.stdout.write(text));
	const error = options.stderr ?? (text => process.stderr.write(text));
	const parsed = parseStorageArgs(args);
	if ('error' in parsed) {
		error(`${parsed.error}\n`);
		return 1;
	}
	if (parsed.mode === 'help') {
		out(`${STORAGE_USAGE}\n`);
		return 0;
	}
	if (
		parsed.mode === 'interactive' &&
		!(options.isTTY ?? (process.stdin.isTTY && process.stdout.isTTY))
	) {
		error(
			'Storage view requires an interactive terminal (TTY). Use `nanocoder storage --format json` instead.\n',
		);
		return 1;
	}
	try {
		const collect =
			options.collect ??
			(await import('./diagnostics.js')).collectStorageReport;
		if (parsed.mode === 'interactive') error('Scanning Nanocoder storage...\n');
		const report = await collect();
		if (parsed.mode === 'json') {
			out(`${JSON.stringify(report)}\n`);
			return 0;
		}
		// Only the interactive path imports React and Ink. Render inline so Ink
		// owns raw-mode lifecycle and restores the terminal on exit or failure.
		const [{createElement}, {render}, {StorageApp}] = await Promise.all([
			import('react'),
			import('ink'),
			import('./storage-app.js'),
		]);
		// The inspector owns its own screen, independent of the chat application.
		// Always restore the previous terminal contents, even if Ink throws.
		out('\x1B[?1049h\x1B[2J\x1B[H');
		const restoreScreen = () => out('\x1B[?1049l');
		const signals = ['SIGTERM', 'SIGHUP'] as const;
		const onSignal = (signal: 'SIGTERM' | 'SIGHUP') => {
			restoreScreen();
			process.exit(128 + (signal === 'SIGTERM' ? 15 : 1));
		};
		const handlers = signals.map(signal => {
			const handler = () => onSignal(signal);
			process.once(signal, handler);
			return {signal, handler};
		});
		try {
			const app = render(createElement(StorageApp, {report}), {
				exitOnCtrlC: false,
			});
			try {
				await app.waitUntilExit();
			} finally {
				app.unmount();
			}
		} finally {
			for (const {signal, handler} of handlers) process.off(signal, handler);
			restoreScreen();
		}
		return 0;
	} catch (cause) {
		error(
			`Storage diagnostics failed: ${cause instanceof Error ? cause.message : String(cause)}\n`,
		);
		return 1;
	}
}
