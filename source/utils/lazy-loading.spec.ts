
import {spawnSync} from 'node:child_process';
import test from 'ava';

interface LoadCounts {
	before: number;
	afterImport: number;
	afterUnused: number;
	afterFirstUse: number;
	afterSecondUse: number;
}

function runLoadProbe(
	modulePath: string,
	packageName: string,
	steps: string,
): LoadCounts {
	const script = `
		import {registerHooks} from 'node:module';
		import {resolve} from 'node:path';
		import {pathToFileURL} from 'node:url';

		const seen = new Set();

		registerHooks({
			load(url, context, next) {
				seen.add(url);
				return next(url, context);
			},
		});

		const pattern = new RegExp(
			'node_modules[/\\\\\\\\]' + ${JSON.stringify(packageName)} + '[/\\\\\\\\]'
		);

		const count = () =>
			[...seen].filter(url => pattern.test(url)).length;

		const before = count();

		const module = await import(
			pathToFileURL(resolve(${JSON.stringify(modulePath)})).href
		);

		const afterImport = count();

		${steps}

		console.log(JSON.stringify({
			before,
			afterImport,
			afterUnused,
			afterFirstUse,
			afterSecondUse,
		}));
	`;

	const result = spawnSync(
		process.execPath,
		['--input-type=module', '-e', script],
		{
			cwd: process.cwd(),
			encoding: 'utf8',
		},
	);

	if (result.error) {
		throw result.error;
	}

	if (result.status !== 0) {
		throw new Error(
			`Load probe failed:\n${result.stderr}\n${result.stdout}`,
		);
	}

	const output = result.stdout.trim().split(/\r?\n/).at(-1);

	if (!output) {
		throw new Error('Load probe returned no output');
	}

	return JSON.parse(output) as LoadCounts;
}

test('yaml loads only when nonempty frontmatter is parsed', t => {
	const counts = runLoadProbe(
		'dist/utils/frontmatter.js',
		'yaml',
		`
		module.splitFrontmatter('# Markdown without frontmatter');
		module.parseYamlObject('   ');
		const afterUnused = count();

		module.parseYamlObject('name: test');
		const afterFirstUse = count();

		module.parseYamlObject('enabled: true');
		const afterSecondUse = count();
		`,
	);

	t.is(counts.before, 0);
	t.is(counts.afterImport, 0);
	t.is(counts.afterUnused, 0);
	t.true(counts.afterFirstUse > 0);
	t.is(counts.afterSecondUse, counts.afterFirstUse);
});

test('cli-table3 loads only when a valid table is rendered', t => {
	const counts = runLoadProbe(
		'dist/markdown-parser/table-parser.js',
		'cli-table3',
		`
		const colors = {primary: '#ffffff'};
		module.parseMarkdownTable('Plain text', colors, 80);
		module.parseMarkdownTable('| Invalid | Table |', colors, 80);
		const afterUnused = count();

		const validTable =
			'| Name | Age |\\n| --- | --- |\\n| Ada | 42 |';

		module.parseMarkdownTable(validTable, colors, 80);
		const afterFirstUse = count();

		module.parseMarkdownTable(validTable, colors, 80);
		const afterSecondUse = count();
		`,
	);

	t.is(counts.before, 0);
	t.is(counts.afterImport, 0);
	t.is(counts.afterUnused, 0);
	t.true(counts.afterFirstUse > 0);
	t.is(counts.afterSecondUse, counts.afterFirstUse);
});
