import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';

import {buildRepoMap, DEFAULT_REPO_MAP_TOKENS} from './index';

console.log('\nrepo-map/index.spec.ts');

let counter = 0;

function createRepo(files: Record<string, string>): string {
	counter += 1;
	const root = join(
		tmpdir(),
		`nanocoder-repomap-${process.pid}-${Date.now()}-${counter}`,
	);
	mkdirSync(root, {recursive: true});
	for (const [relative, content] of Object.entries(files)) {
		const absolute = join(root, relative);
		mkdirSync(join(absolute, '..'), {recursive: true});
		writeFileSync(absolute, content);
	}
	return root;
}

function cleanup(root: string): void {
	rmSync(root, {recursive: true, force: true});
}

test.serial('ranks the most-referenced file first', async t => {
	const root = createRepo({
		'core.ts': 'export function sharedHelper() {\n\treturn 1;\n}\n',
		'a.ts': 'import {sharedHelper} from "./core";\nsharedHelper();\n',
		'b.ts': 'import {sharedHelper} from "./core";\nsharedHelper();\n',
		'c.ts': 'import {sharedHelper} from "./core";\nsharedHelper();\n',
	});

	try {
		const map = await buildRepoMap(root);
		t.is(map.files[0].path, 'core.ts');
		t.true(map.files[0].symbols.includes('sharedHelper'));
		t.true(map.files[0].rank > 0);
	} finally {
		cleanup(root);
	}
});

test.serial('orders a file symbols by cross-file reference weight', async t => {
	const root = createRepo({
		'lib.ts':
			'export function rarelyUsed() {}\nexport function heavilyUsed() {}\n',
		'user.ts':
			'import {heavilyUsed} from "./lib";\nheavilyUsed();\nheavilyUsed();\nheavilyUsed();\n',
	});

	try {
		const map = await buildRepoMap(root);
		const lib = map.files.find(file => file.path === 'lib.ts');
		t.truthy(lib);
		t.is(lib?.symbols[0], 'heavilyUsed');
		t.true(lib?.symbols.includes('rarelyUsed'));
	} finally {
		cleanup(root);
	}
});

test.serial('splits weight when a symbol is defined in several files', async t => {
	const root = createRepo({
		'one.ts': 'export function ambiguous() {}\n',
		'two.ts': 'export function ambiguous() {}\n',
		'only.ts': 'export function unique() {}\n',
		'user.ts':
			'import {ambiguous} from "./one";\nimport {unique} from "./only";\nambiguous();\nunique();\n',
	});

	try {
		const map = await buildRepoMap(root);
		const one = map.files.find(file => file.path === 'one.ts');
		const two = map.files.find(file => file.path === 'two.ts');
		const only = map.files.find(file => file.path === 'only.ts');
		t.truthy(one);
		t.truthy(only);
		t.is(one?.rank, two?.rank);
		t.true((only?.rank ?? 0) > (one?.rank ?? 0));
	} finally {
		cleanup(root);
	}
});

test.serial('ignores self-references when ranking', async t => {
	const root = createRepo({
		'lonely.ts':
			'export function loop() {\n\tloop();\n\tloop();\n\tloop();\n}\n',
		'other.ts': 'export const other = 1;\n',
	});

	try {
		const map = await buildRepoMap(root);
		const lonely = map.files.find(file => file.path === 'lonely.ts');
		const other = map.files.find(file => file.path === 'other.ts');
		t.is(lonely?.rank, other?.rank);
	} finally {
		cleanup(root);
	}
});

test.serial('returns an empty map for a repo with no source files', async t => {
	const root = createRepo({'README.md': '# hello\n', 'data.json': '{}\n'});

	try {
		const map = await buildRepoMap(root);
		t.deepEqual(map.files, []);
		t.is(map.scannedFiles, 0);
		t.is(map.totalSymbols, 0);
		t.false(map.truncated);
	} finally {
		cleanup(root);
	}
});

test.serial('skips files that define no symbols', async t => {
	const root = createRepo({
		'empty.ts': '\n\n',
		'real.ts': 'export function realThing() {}\n',
	});

	try {
		const map = await buildRepoMap(root);
		t.is(map.scannedFiles, 2);
		t.deepEqual(
			map.files.map(file => file.path),
			['real.ts'],
		);
	} finally {
		cleanup(root);
	}
});

test.serial('respects .gitignore and default ignore directories', async t => {
	const root = createRepo({
		'.gitignore': 'secret/\n',
		'secret/hidden.ts': 'export function hiddenSymbol() {}\n',
		'node_modules/dep/index.ts': 'export function depSymbol() {}\n',
		'kept.ts': 'export function keptSymbol() {}\n',
	});

	try {
		const map = await buildRepoMap(root);
		t.is(map.scannedFiles, 1);
		t.deepEqual(
			map.files.map(file => file.path),
			['kept.ts'],
		);
	} finally {
		cleanup(root);
	}
});

test.serial('skips unsupported extensions and files above the byte cap', async t => {
	const root = createRepo({
		'big.ts': `export function bigSymbol() {}\n${'// '.repeat(200)}\n`,
		'small.ts': 'export function smallSymbol() {}\n',
		'notes.txt': 'function notCode() {}\n',
	});

	try {
		const map = await buildRepoMap(root, {maxFileBytes: 120});
		t.is(map.scannedFiles, 1);
		t.is(map.files[0].path, 'small.ts');
	} finally {
		cleanup(root);
	}
});

test.serial('stops scanning at maxFiles and reports truncation', async t => {
	const root = createRepo({
		'a.ts': 'export function aSymbol() {}\n',
		'b.ts': 'export function bSymbol() {}\n',
		'c.ts': 'export function cSymbol() {}\n',
	});

	try {
		const map = await buildRepoMap(root, {maxFiles: 2});
		t.is(map.scannedFiles, 2);
		t.true(map.truncated);
	} finally {
		cleanup(root);
	}
});

test.serial('truncates when the token budget is exhausted', async t => {
	const root = createRepo({
		'one.ts': 'export function oneSymbolHere() {}\n',
		'two.ts': 'export function twoSymbolHere() {}\n',
		'three.ts': 'export function threeSymbolHere() {}\n',
	});

	try {
		const map = await buildRepoMap(root, {maxTokens: 10});
		t.is(map.scannedFiles, 3);
		t.true(map.files.length < 3);
		t.true(map.truncated);
	} finally {
		cleanup(root);
	}
});

test.serial('caps the symbols listed per file', async t => {
	const definitions = Array.from(
		{length: 20},
		(_, index) => `export function symbolNumber${index}() {}`,
	).join('\n');
	const root = createRepo({'many.ts': `${definitions}\n`});

	try {
		const map = await buildRepoMap(root, {maxSymbolsPerFile: 3});
		t.is(map.files[0].symbols.length, 3);
		t.is(map.totalSymbols, 20);
	} finally {
		cleanup(root);
	}
});

test.serial('ignores definitions and references inside comments and strings', async t => {
	const root = createRepo({
		'real.ts': 'export function realOnly() {}\n',
		'noise.ts':
			'// export function commentedOut() {}\n/* export function blockedOut() {} */\nexport const text = "export function stringOut() {}";\nexport const ref = "realOnly realOnly realOnly";\n',
	});

	try {
		const map = await buildRepoMap(root);
		const noise = map.files.find(file => file.path === 'noise.ts');
		t.truthy(noise);
		t.false(noise?.symbols.includes('commentedOut'));
		t.false(noise?.symbols.includes('blockedOut'));
		t.false(noise?.symbols.includes('stringOut'));
		t.is(map.files.find(file => file.path === 'real.ts')?.rank, noise?.rank);
	} finally {
		cleanup(root);
	}
});

test.serial('indexes files written with CRLF line endings', async t => {
	const root = createRepo({
		'crlf.ts': 'export function crlfSymbol() {}\r\nexport const crlfConst = 1;\r\n',
		'plain.c': 'int crlf_start(void)\r\n{\r\n\treturn 0;\r\n}\r\n',
	});

	try {
		const map = await buildRepoMap(root);
		const symbolsFor = (path: string) =>
			map.files.find(file => file.path === path)?.symbols ?? [];
		t.true(symbolsFor('crlf.ts').includes('crlfSymbol'));
		t.true(symbolsFor('crlf.ts').includes('crlfConst'));
		t.true(symbolsFor('plain.c').includes('crlf_start'));
	} finally {
		cleanup(root);
	}
});

test.serial('indexes only exported javascript symbols', async t => {
	const root = createRepo({
		'mod.ts':
			'export function exportedFn() {}\nfunction privateFn() {}\nconst privateConst = 1;\nexport const exportedConst = 2;\nexport interface ExportedShape {}\n',
	});

	try {
		const map = await buildRepoMap(root);
		const symbols = map.files[0].symbols;
		t.true(symbols.includes('exportedFn'));
		t.true(symbols.includes('exportedConst'));
		t.true(symbols.includes('ExportedShape'));
		t.false(symbols.includes('privateFn'));
		t.false(symbols.includes('privateConst'));
	} finally {
		cleanup(root);
	}
});

test.serial('links files only through names they actually import', async t => {
	const root = createRepo({
		'target.ts': 'export function collide() {}\n',
		'importer.ts': 'import {collide} from "./target";\ncollide();\n',
		'shadow.ts': 'function collide() {}\ncollide();\ncollide();\ncollide();\n',
	});

	try {
		const map = await buildRepoMap(root);
		const target = map.files.find(file => file.path === 'target.ts');
		const importer = map.files.find(file => file.path === 'importer.ts');
		t.truthy(target);
		t.is(importer, undefined);
		t.true((target?.rank ?? 0) > 1 / 3);
	} finally {
		cleanup(root);
	}
});

test.serial('does not treat property access as a reference', async t => {
	const root = createRepo({
		'api.ts': 'export function fetchData() {}\n',
		'noise.ts':
			'import {fetchData} from "./api";\nconst client = {};\nclient.fetchData();\nclient.fetchData();\n',
		'plain.ts': 'export const plain = 1;\n',
	});

	try {
		const map = await buildRepoMap(root);
		const api = map.files.find(file => file.path === 'api.ts');
		const plain = map.files.find(file => file.path === 'plain.ts');
		t.truthy(api);
		t.true((api?.rank ?? 0) > (plain?.rank ?? 0));
	} finally {
		cleanup(root);
	}
});

test.serial('resolves python imports through from-import bindings', async t => {
	const root = createRepo({
		'helpers.py': 'def build_widget():\n\treturn 1\n',
		'app.py': 'from helpers import build_widget\n\nbuild_widget()\n',
		'idle.py': 'def unused_widget():\n\treturn 2\n',
	});

	try {
		const map = await buildRepoMap(root);
		const helpers = map.files.find(file => file.path === 'helpers.py');
		const idle = map.files.find(file => file.path === 'idle.py');
		t.true((helpers?.rank ?? 0) > (idle?.rank ?? 0));
	} finally {
		cleanup(root);
	}
});

test.serial('keeps python hash comments out of the index', async t => {
	const root = createRepo({
		'mod.py': '# def commentedDef():\nclass RealClass:\n\tdef real_method(self):\n\t\treturn 1\n',
	});

	try {
		const map = await buildRepoMap(root);
		t.true(map.files[0].symbols.includes('RealClass'));
		t.true(map.files[0].symbols.includes('real_method'));
		t.false(map.files[0].symbols.includes('commentedDef'));
	} finally {
		cleanup(root);
	}
});

test.serial('extracts definitions across supported languages', async t => {
	const root = createRepo({
		'svc.go': 'package main\n\nfunc RunServer() {}\n\ntype Options struct{}\n',
		'lib.rs': 'pub fn run_task() {}\n\npub struct TaskOptions {}\n',
		'App.java': 'public class AppRunner {\n\tpublic void execute() {}\n}\n',
		'model.rb': 'class RecordModel\n\tdef persist\n\tend\nend\n',
		'page.php': '<?php\nfunction render_page() {}\nclass PageBuilder {}\n',
		'core.c': '#include <stdio.h>\n\nstruct CoreState;\n\nint core_start(int argc)\n{\n\treturn argc;\n}\n',
	});

	try {
		const map = await buildRepoMap(root, {maxTokens: 4096});
		const symbolsFor = (path: string) =>
			map.files.find(file => file.path === path)?.symbols ?? [];

		t.true(symbolsFor('svc.go').includes('RunServer'));
		t.true(symbolsFor('svc.go').includes('Options'));
		t.true(symbolsFor('lib.rs').includes('run_task'));
		t.true(symbolsFor('lib.rs').includes('TaskOptions'));
		t.true(symbolsFor('App.java').includes('AppRunner'));
		t.true(symbolsFor('model.rb').includes('RecordModel'));
		t.true(symbolsFor('model.rb').includes('persist'));
		t.true(symbolsFor('page.php').includes('render_page'));
		t.true(symbolsFor('page.php').includes('PageBuilder'));
		t.true(symbolsFor('core.c').includes('core_start'));
	} finally {
		cleanup(root);
	}
});

test.serial('converges on a reference cycle and keeps ranks normalised', async t => {
	const root = createRepo({
		'alpha.ts':
			'import {betaFn} from "./beta";\nexport function alphaFn() {\n\tbetaFn();\n}\n',
		'beta.ts':
			'import {gammaFn} from "./gamma";\nexport function betaFn() {\n\tgammaFn();\n}\n',
		'gamma.ts':
			'import {alphaFn} from "./alpha";\nexport function gammaFn() {\n\talphaFn();\n}\n',
	});

	try {
		const map = await buildRepoMap(root);
		t.is(map.files.length, 3);
		const total = map.files.reduce((sum, file) => sum + file.rank, 0);
		t.true(Math.abs(total - 1) < 1e-3);
		for (const file of map.files) {
			t.true(Number.isFinite(file.rank));
			t.true(file.rank > 0);
		}
	} finally {
		cleanup(root);
	}
});

test.serial('produces a stable ordering across runs', async t => {
	const root = createRepo({
		'a.ts': 'export function sameA() {}\n',
		'b.ts': 'export function sameB() {}\n',
		'c.ts': 'export function sameC() {}\n',
	});

	try {
		const first = await buildRepoMap(root);
		const second = await buildRepoMap(root);
		t.deepEqual(
			first.files.map(file => file.path),
			second.files.map(file => file.path),
		);
		t.deepEqual(
			first.files.map(file => file.path),
			['a.ts', 'b.ts', 'c.ts'],
		);
	} finally {
		cleanup(root);
	}
});

test.serial('rejects when the directory does not exist', async t => {
	await t.throwsAsync(buildRepoMap(join(tmpdir(), 'nanocoder-repomap-missing')));
});

test.serial('exposes a 1024 token default budget', t => {
	t.is(DEFAULT_REPO_MAP_TOKENS, 1024);
});
