import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {clearAppConfig, reloadAppConfig} from '@/config/index';
import {processToolUse, setToolRegistryGetter} from '@/message-handler';
import {
	resetSessionCwd,
	setProjectRoot,
	setSessionCwd,
} from '@/services/session-cwd';
import type {HooksConfig} from '@/types/config';
import type {ToolCall} from '@/types/core';
import {formatWrittenFile, getConfiguredFormatters} from './formatters';

console.log(`\nformatters.spec.ts`);

const testDir = realpathSync(tmpdir()) + `/nanocoder-formatters-${Date.now()}`;
const originalCwd = process.cwd();
const originalConfigDir = process.env.NANOCODER_CONFIG_DIR;

/** Write an isolated project config holding just these blocks, and reload. */
function withConfig(nanocoder: {
	formatters?: unknown[];
	hooks?: HooksConfig;
}): void {
	writeFileSync(
		join(testDir, 'agents.config.json'),
		JSON.stringify({nanocoder}),
		'utf-8',
	);
	reloadAppConfig();
}

// Portable formatter bodies: `sh -c` on POSIX, `cmd /c` on Windows, so the
// file is reached through node rather than `$FILE` vs `%FILE%`.
const node = (script: string) => `node -e "${script}"`;
const UPPERCASE = node(
	"const f=require('fs');const p=process.env.FILE;f.writeFileSync(p,f.readFileSync(p,'utf8').toUpperCase())",
);

function writeSource(name: string, content: string): string {
	const path = join(testDir, name);
	writeFileSync(path, content, 'utf-8');
	return path;
}

test.before(() => {
	mkdirSync(testDir, {recursive: true});
	process.env.NANOCODER_CONFIG_DIR = join(testDir, 'no-global-config');
	process.chdir(testDir);
	setProjectRoot(testDir);
	setSessionCwd(testDir);
});

test.after.always(() => {
	process.chdir(originalCwd);
	resetSessionCwd();
	if (originalConfigDir === undefined) {
		delete process.env.NANOCODER_CONFIG_DIR;
	} else {
		process.env.NANOCODER_CONFIG_DIR = originalConfigDir;
	}
	clearAppConfig();
	if (existsSync(testDir)) rmSync(testDir, {recursive: true, force: true});
});

test.serial('formats a matching file and tells the model', async t => {
	withConfig({
		formatters: [{name: 'upper', match: ['**/*.ts'], command: UPPERCASE}],
	});
	const path = writeSource('a.ts', 'const x = 1;\n');

	const content = await formatWrittenFile('write_file', {path: 'a.ts'}, 'ok');

	t.is(readFileSync(path, 'utf-8'), 'CONST X = 1;\n');
	t.is(content, 'ok\n\nNote: a.ts was reformatted by upper. Re-read it before editing it again.');
});

test.serial('leaves files outside the globs alone', async t => {
	withConfig({formatters: [{match: '**/*.ts', command: UPPERCASE}]});
	const path = writeSource('b.go', 'package main\n');

	const content = await formatWrittenFile(
		'string_replace',
		{path: 'b.go'},
		'ok',
	);

	t.is(readFileSync(path, 'utf-8'), 'package main\n');
	t.is(content, 'ok');
});

test.serial('ignores tools that do not write file contents', async t => {
	withConfig({formatters: [{match: ['**/*.ts'], command: UPPERCASE}]});
	const path = writeSource('c.ts', 'read me\n');

	const content = await formatWrittenFile('read_file', {path: 'c.ts'}, 'ok');

	t.is(readFileSync(path, 'utf-8'), 'read me\n');
	t.is(content, 'ok');
});

test.serial('adds no note when the formatter changed nothing', async t => {
	withConfig({formatters: [{match: ['**/*.ts'], command: UPPERCASE}]});
	writeSource('d.ts', 'ALREADY CLEAN\n');

	t.is(await formatWrittenFile('diff_edit', {path: 'd.ts'}, 'ok'), 'ok');
});

test.serial('a failing formatter leaves the edit as written', async t => {
	withConfig({
		formatters: [{match: ['**/*.ts'], command: node('process.exit(2)')}],
	});
	const path = writeSource('e.ts', 'as written\n');

	const content = await formatWrittenFile('write_file', {path: 'e.ts'}, 'ok');

	t.is(readFileSync(path, 'utf-8'), 'as written\n');
	t.is(content, 'ok');
});

test.serial('drops entries without a command or a match list', t => {
	withConfig({
		formatters: [
			{match: ['**/*.ts']},
			{command: 'true'},
			{match: [], command: 'true'},
			{match: '**/*.md', command: 'true'},
		],
	});

	t.deepEqual(getConfiguredFormatters(), [
		{match: ['**/*.md'], command: 'true'},
	]);
});

const writeCall = (path: string): ToolCall => ({
	id: 'call-1',
	function: {name: 'write_file', arguments: {path, content: 'x'}},
});

test.serial('processToolUse formats before post-tool-use hooks run', async t => {
	const path = writeSource('f.ts', 'lower\n');
	setToolRegistryGetter(() => ({write_file: async () => 'wrote f.ts'}));
	withConfig({
		formatters: [{match: ['**/*.ts'], command: UPPERCASE}],
		hooks: {
			'post-tool-use': [
				{
					command: node(
						"process.stdout.write(require('fs').readFileSync(process.env.NANOCODER_FILE,'utf8'))",
					),
				},
			],
		},
	});

	const result = await processToolUse(writeCall('f.ts'));

	t.is(readFileSync(path, 'utf-8'), 'LOWER\n');
	t.true(result.content.includes('f.ts was reformatted'));
	// The hook saw the formatted file, not the one the handler wrote.
	t.true(result.content.includes('<hook-output event="post-tool-use">\nLOWER'));
});

test.serial('processToolUse does not format after a failed write', async t => {
	const path = writeSource('g.ts', 'untouched\n');
	setToolRegistryGetter(() => ({
		write_file: async () => {
			throw new Error('disk full');
		},
	}));
	withConfig({formatters: [{match: ['**/*.ts'], command: UPPERCASE}]});

	const result = await processToolUse(writeCall('g.ts'));

	t.true(result.isError);
	t.is(readFileSync(path, 'utf-8'), 'untouched\n');
});
