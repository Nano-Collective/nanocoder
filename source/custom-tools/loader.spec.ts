import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {CustomToolLoader} from './loader';

console.log('\ncustom-tools/loader.spec.ts');

let projectRoot: string;
let configDir: string;
let projectToolsDir: string;
let personalToolsDir: string;

test.before(() => {
	const root = join(tmpdir(), `nanocoder-custom-tools-loader-${Date.now()}`);
	projectRoot = join(root, 'project');
	configDir = join(root, 'config');
	projectToolsDir = join(projectRoot, '.nanocoder', 'tools');
	personalToolsDir = join(configDir, 'tools');
	mkdirSync(projectToolsDir, {recursive: true});
	mkdirSync(personalToolsDir, {recursive: true});
	process.env.NANOCODER_CONFIG_DIR = configDir;
});

test.after.always(() => {
	delete process.env.NANOCODER_CONFIG_DIR;
	if (projectRoot)
		rmSync(join(projectRoot, '..'), {recursive: true, force: true});
});

function writeFile(dir: string, name: string, contents: string) {
	writeFileSync(join(dir, name), contents, 'utf-8');
}

function clearDir(dir: string) {
	rmSync(dir, {recursive: true, force: true});
	mkdirSync(dir, {recursive: true});
}

test.serial('loads tools from both directories', t => {
	clearDir(projectToolsDir);
	clearDir(personalToolsDir);

	writeFile(
		personalToolsDir,
		'a.md',
		`---
name: personal_a
description: personal a
---
echo a`,
	);
	writeFile(
		projectToolsDir,
		'b.md',
		`---
name: project_b
description: project b
---
echo b`,
	);
	const loader = new CustomToolLoader(projectRoot);
	const result = loader.load();
	const names = result.tools.map(t => t.metadata.name).sort();
	t.deepEqual(names, ['personal_a', 'project_b']);
	t.is(result.errors.length, 0);
});

test.serial('project tools shadow personal tools by name', t => {
	clearDir(projectToolsDir);
	clearDir(personalToolsDir);

	writeFile(
		personalToolsDir,
		'same.md',
		`---
name: same_name
description: personal
---
echo personal`,
	);
	writeFile(
		projectToolsDir,
		'same.md',
		`---
name: same_name
description: project
---
echo project`,
	);
	const loader = new CustomToolLoader(projectRoot);
	const {tools} = loader.load();
	t.is(tools.length, 1);
	t.is(tools[0]?.source, 'project');
	t.is(tools[0]?.metadata.description, 'project');
});

test.serial('duplicate name in same dir keeps first and reports error', t => {
	clearDir(projectToolsDir);
	clearDir(personalToolsDir);

	writeFile(
		projectToolsDir,
		'first.md',
		`---
name: dup
description: first
---
echo first`,
	);
	writeFile(
		projectToolsDir,
		'second.md',
		`---
name: dup
description: second
---
echo second`,
	);
	const loader = new CustomToolLoader(projectRoot);
	const {tools, errors} = loader.load();
	t.is(tools.length, 1);
	t.is(errors.length, 1);
	t.regex(errors[0]?.error ?? '', /Duplicate tool name/);
});

test.serial('malformed file is skipped and reported', t => {
	clearDir(projectToolsDir);
	clearDir(personalToolsDir);

	writeFile(projectToolsDir, 'good.md', `---
name: good
description: good
---
echo`);
	writeFile(projectToolsDir, 'bad.md', `no frontmatter here`);

	const loader = new CustomToolLoader(projectRoot);
	const {tools, errors} = loader.load();
	const names = tools.map(t => t.metadata.name);
	t.deepEqual(names, ['good']);
	t.is(errors.length, 1);
});

test.serial('ignores non-md files', t => {
	clearDir(projectToolsDir);
	clearDir(personalToolsDir);

	writeFile(projectToolsDir, 'tool.ts', `export default {};`);
	writeFile(projectToolsDir, 'tool.md', `---
name: real_tool
description: r
---
echo`);
	const loader = new CustomToolLoader(projectRoot);
	const {tools} = loader.load();
	t.is(tools.length, 1);
	t.is(tools[0]?.metadata.name, 'real_tool');
});
