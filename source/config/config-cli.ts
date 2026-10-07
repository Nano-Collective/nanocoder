/**
 * CLI surface for `nanocoder config <show|diff|list>`.
 *
 * Follows the same shape as `daemon/cli.ts`: each handler returns an
 * `{exitCode, output}` pair and the wiring in `cli.tsx` decides which stream
 * to print it on. Rendering is plain text with no ANSI colour so the output
 * pipes into a file or a bug report unchanged.
 */

import {basename} from 'node:path';
import {
	type EffectiveConfig,
	type EffectiveConfigEntry,
	findEntries,
	resolveEffectiveConfig,
	selectOverrides,
} from '@/config/effective-config';

export interface ConfigCliResult {
	exitCode: 0 | 1;
	output: string;
}

export type ConfigCliCommand = 'show' | 'diff' | 'list';

const CONFIG_CLI_COMMANDS: readonly ConfigCliCommand[] = [
	'show',
	'diff',
	'list',
];

const CONFIG_CLI_USAGE = `Usage: nanocoder config <command> [key] [--json]

Commands:
  list                 Show every resolved setting and the layer it came from
  show [key]           Show one setting (or a whole block) in detail.
                       With no key, identical to "list".
  diff                 Show only what your config files change, plus the
                       values they shadow

Options:
  --json               Emit machine-readable JSON instead of a table

Examples:
  nanocoder config list
  nanocoder config show nanocoder.autoCompact.threshold
  nanocoder config show autoCompact
  nanocoder config diff --json`;

const MAX_VALUE_WIDTH = 60;

/** Render a resolved value as a single line, truncated for table use. */
function formatValue(value: unknown, maxWidth = MAX_VALUE_WIDTH): string {
	if (value === undefined) return '(unset)';
	const text = typeof value === 'string' ? value : JSON.stringify(value);
	if (text === undefined) return '(unset)';
	const oneLine = text.replace(/\s+/g, ' ');
	return oneLine.length > maxWidth
		? `${oneLine.slice(0, maxWidth - 1)}…`
		: oneLine;
}

/** Short label for the SOURCE column; full paths live in the layer header. */
function shortOrigin(origin: string): string {
	return origin.includes('/') || origin.includes('\\')
		? basename(origin)
		: origin;
}

function pad(text: string, width: number): string {
	return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function renderTable(rows: string[][], headers: string[]): string[] {
	const widths = headers.map((header, index) =>
		Math.max(header.length, ...rows.map(row => (row[index] ?? '').length)),
	);
	const line = (cells: string[]) =>
		cells
			.map((cell, index) =>
				index === cells.length - 1 ? cell : pad(cell, widths[index] as number),
			)
			.join('  ')
			.trimEnd();
	return [line(headers), ...rows.map(line)];
}

function renderLayerHeader(config: EffectiveConfig): string[] {
	const lines = [
		'Effective configuration',
		`  working directory  ${config.cwd}`,
		`  config directory   ${config.configDir}`,
		'',
		'Layers (lowest precedence first)',
	];

	const rows = config.layers.map(layer => {
		const status = layer.error
			? `unreadable: ${layer.error}`
			: layer.skipped
				? `skipped: ${layer.skipped}`
				: layer.exists
					? 'present'
					: 'missing';
		return [`  ${layer.layer}`, layer.origin, status];
	});
	rows.push([
		'  env',
		'NANOCODER_* environment variables',
		'highest precedence',
	]);
	lines.push(...renderTable(rows, ['  LAYER', 'SOURCE', 'STATUS']));
	return lines;
}

function renderEntryRows(entries: EffectiveConfigEntry[]): string[][] {
	return entries.map(entry => [
		entry.shadowed.length > 0 ? `${entry.key} *` : entry.key,
		formatValue(entry.value),
		entry.layer,
		shortOrigin(entry.origin),
	]);
}

function renderList(config: EffectiveConfig): string {
	const lines = [...renderLayerHeader(config), ''];

	if (config.entries.length === 0) {
		lines.push('No settings resolved. Every value is a built-in default.');
		return lines.join('\n');
	}

	lines.push(
		...renderTable(renderEntryRows(config.entries), [
			'KEY',
			'VALUE',
			'LAYER',
			'SOURCE',
		]),
	);

	if (config.entries.some(entry => entry.shadowed.length > 0)) {
		lines.push(
			'',
			'* also set in a lower-precedence layer. Run "nanocoder config show <key>" for details.',
		);
	}
	return lines.join('\n');
}

/**
 * Explain, in one sentence, why the losing layers lost. The block rule is the
 * one worth spelling out: a project file that sets a single field of a block
 * discards the global file's whole block, not just that field.
 */
function resolutionNote(entry: EffectiveConfigEntry): string {
	switch (entry.rule) {
		case 'block':
			return `How this is decided: "${entry.block}" is taken as a whole block from one file — the project file first, then the global one. Anything that file leaves out uses the built-in default. It is not filled in from the other file.`;
		case 'closest-file':
			return 'How this is decided: preferences come from one file only — the project file if it exists, otherwise the global one. The other file is ignored completely.';
		case 'merge-by-name':
			return 'How this is decided: these are matched up by name. An environment variable wins, then the project file, then the global one. Only an entry with the same name gets replaced.';
		case 'env':
			return `How this is decided: the ${entry.origin} environment variable beats every config file for this setting.`;
	}
}

function renderDetail(
	entry: EffectiveConfigEntry,
	includeNote: boolean,
): string[] {
	const lines = [
		entry.key,
		`  value    ${formatValue(entry.value, 200)}`,
		`  layer    ${entry.layer}`,
		`  source   ${entry.origin}`,
	];
	if (entry.hasDefault) {
		lines.push(`  default  ${formatValue(entry.defaultValue, 200)}`);
	}
	if (entry.redacted) {
		lines.push('  note     credential values are redacted');
	}

	if (entry.shadowed.length > 0) {
		lines.push('', '  Ignored values (set, but not in effect):');
		lines.push(
			...renderTable(
				entry.shadowed.map(shadow => [
					`    ${shadow.layer}`,
					shadow.origin,
					formatValue(shadow.value),
				]),
				['    LAYER', 'SOURCE', 'VALUE'],
			),
		);
	}

	if (includeNote) lines.push('', `  ${resolutionNote(entry)}`);
	return lines;
}

function renderShow(config: EffectiveConfig, key: string): ConfigCliResult {
	const matches = findEntries(config, key);
	if (matches.length === 0) {
		return {
			exitCode: 1,
			output: `No configuration key matching "${key}".\nRun "nanocoder config list" to see every resolved key.`,
		};
	}

	const notes = new Set(matches.map(resolutionNote));
	const shared = notes.size === 1 ? [...notes][0] : undefined;
	const blocks = matches.map(entry =>
		renderDetail(entry, shared === undefined).join('\n'),
	);
	const output = blocks.join('\n\n');
	return {
		exitCode: 0,
		output: shared === undefined ? output : `${output}\n\n${shared}`,
	};
}

/** Why a shadowed value is not in effect, phrased per resolution rule. */
function shadowReason(entry: EffectiveConfigEntry): string {
	if (entry.rule === 'block' && entry.block) {
		const winner =
			entry.blockOrigin === undefined
				? 'a higher-priority file'
				: `${shortOrigin(entry.blockOrigin)} (${entry.blockLayer})`;
		return entry.layer === 'default'
			? `${winner} sets the "${entry.block}" block but not this field, so the default is used`
			: `${winner} sets the whole "${entry.block}" block`;
	}
	if (entry.rule === 'closest-file') {
		return `${shortOrigin(entry.origin)} (${entry.layer}) is the file being used`;
	}
	return `replaced by the one in ${shortOrigin(entry.origin)} (${entry.layer})`;
}

function renderDiff(config: EffectiveConfig): string {
	const overrides = selectOverrides(config);
	const lines = [...renderLayerHeader(config), ''];

	const inEffect = overrides.filter(entry => entry.layer !== 'default');
	if (inEffect.length === 0) {
		lines.push(
			'Overrides in effect: none. Every setting is a built-in default.',
		);
	} else {
		lines.push('Overrides in effect');
		lines.push(
			...renderTable(
				inEffect.map(entry => [
					`  ${entry.key}`,
					formatValue(entry.value),
					entry.layer,
					shortOrigin(entry.origin),
					entry.hasDefault ? formatValue(entry.defaultValue, 24) : '',
				]),
				['  KEY', 'VALUE', 'LAYER', 'SOURCE', 'DEFAULT'],
			),
		);
	}

	const shadowRows = overrides.flatMap(entry =>
		entry.shadowed.map(shadow => [
			`  ${entry.key}`,
			formatValue(shadow.value),
			shadow.layer,
			shortOrigin(shadow.origin),
			shadowReason(entry),
		]),
	);

	lines.push('');
	if (shadowRows.length === 0) {
		lines.push('Ignored values: none. No layer is shadowing another.');
	} else {
		lines.push('Ignored values (set, but not in effect)');
		lines.push(
			...renderTable(shadowRows, [
				'  KEY',
				'VALUE',
				'LAYER',
				'SOURCE',
				'REASON',
			]),
		);
	}

	return lines.join('\n');
}

/**
 * Run a `nanocoder config` subcommand. `args` are the arguments after the
 * subcommand name.
 */
export function runConfigCli(
	command: string | undefined,
	args: readonly string[] = [],
	options?: {cwd?: string; configDir?: string},
): ConfigCliResult {
	if (command === undefined || command === '--help' || command === '-h') {
		return {exitCode: 0, output: CONFIG_CLI_USAGE};
	}

	if (!(CONFIG_CLI_COMMANDS as readonly string[]).includes(command)) {
		return {
			exitCode: 1,
			output: `Unknown config command "${command}".\n\n${CONFIG_CLI_USAGE}`,
		};
	}

	const json = args.includes('--json');
	const positional = args.filter(arg => !arg.startsWith('-'));
	const config = resolveEffectiveConfig(options);

	if (command === 'diff') {
		if (json) {
			return {
				exitCode: 0,
				output: JSON.stringify(
					{...config, entries: selectOverrides(config)},
					null,
					2,
				),
			};
		}
		return {exitCode: 0, output: renderDiff(config)};
	}

	const key = command === 'show' ? positional[0] : undefined;
	if (key !== undefined) {
		const matches = findEntries(config, key);
		if (json) {
			return {
				exitCode: matches.length === 0 ? 1 : 0,
				output: JSON.stringify({...config, entries: matches}, null, 2),
			};
		}
		return renderShow(config, key);
	}

	if (json) {
		return {exitCode: 0, output: JSON.stringify(config, null, 2)};
	}
	return {exitCode: 0, output: renderList(config)};
}
