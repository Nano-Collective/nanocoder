import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {CustomToolParseError, parseCustomToolFile} from './parser';

console.log('\ncustom-tools/parser.spec.ts');

let testDir: string;

test.before(() => {
	testDir = join(tmpdir(), `nanocoder-custom-tools-parser-${Date.now()}`);
	mkdirSync(testDir, {recursive: true});
});

test.after.always(() => {
	if (testDir) rmSync(testDir, {recursive: true, force: true});
});

function writeTool(filename: string, contents: string): string {
	const path = join(testDir, filename);
	writeFileSync(path, contents, 'utf-8');
	return path;
}

test('parses a minimal valid custom tool', t => {
	const path = writeTool(
		'minimal.md',
		`---
name: hello
description: Says hello
---
echo hello`,
	);
	const result = parseCustomToolFile(path);
	t.is(result.metadata.name, 'hello');
	t.is(result.metadata.description, 'Says hello');
	t.deepEqual(result.metadata.parameters, {});
	t.is(result.metadata.approval, 'always');
	t.false(result.metadata.readOnly);
	t.is(result.metadata.timeoutMs, 30_000);
	t.is(result.body, 'echo hello');
});

test('parses parameters with all supported constraints', t => {
	const path = writeTool(
		'params.md',
		`---
name: list_pods
description: List pods in a namespace
parameters:
  namespace:
    type: string
    required: true
    description: The namespace
    pattern: '^[a-z0-9-]+$'
    maxLength: 63
  selector:
    type: string
    minLength: 1
  count:
    type: integer
    min: 1
    max: 100
    default: 10
  watch:
    type: boolean
approval: never
read_only: true
timeout_ms: 60000
---
kubectl get pods -n {{ namespace }}`,
	);
	const meta = parseCustomToolFile(path).metadata;
	t.is(meta.approval, 'never');
	t.true(meta.readOnly);
	t.is(meta.timeoutMs, 60_000);
	t.is(meta.parameters.namespace?.type, 'string');
	t.true(meta.parameters.namespace?.required);
	t.is(meta.parameters.namespace?.pattern, '^[a-z0-9-]+$');
	t.is(meta.parameters.namespace?.maxLength, 63);
	t.is(meta.parameters.count?.type, 'integer');
	t.is(meta.parameters.count?.min, 1);
	t.is(meta.parameters.count?.max, 100);
	t.is(meta.parameters.count?.default, 10);
});

test('approval=never implies readOnly=true by default', t => {
	const path = writeTool(
		'readonly-default.md',
		`---
name: safe_tool
description: Safe
approval: never
---
ls`,
	);
	const meta = parseCustomToolFile(path).metadata;
	t.true(meta.readOnly);
});

test('approval=destructive defaults readOnly to false', t => {
	const path = writeTool(
		'destructive.md',
		`---
name: dangerous_tool
description: Mutates state
approval: destructive
---
rm -rf /tmp/foo`,
	);
	const meta = parseCustomToolFile(path).metadata;
	t.is(meta.approval, 'destructive');
	t.false(meta.readOnly);
});

test('throws on missing frontmatter', t => {
	const path = writeTool('no-frontmatter.md', 'echo hi');
	t.throws(() => parseCustomToolFile(path), {
		instanceOf: CustomToolParseError,
	});
});

test('throws on missing name', t => {
	const path = writeTool(
		'no-name.md',
		`---
description: Whatever
---
echo hi`,
	);
	t.throws(() => parseCustomToolFile(path), {message: /name/});
});

test('throws on invalid name (uppercase)', t => {
	const path = writeTool(
		'bad-name.md',
		`---
name: BadName
description: foo
---
echo`,
	);
	t.throws(() => parseCustomToolFile(path), {message: /name/});
});

test('throws on missing description', t => {
	const path = writeTool(
		'no-desc.md',
		`---
name: x
---
echo`,
	);
	t.throws(() => parseCustomToolFile(path), {message: /description/});
});

test('throws on empty body', t => {
	const path = writeTool(
		'empty-body.md',
		`---
name: x
description: Empty body
---
`,
	);
	t.throws(() => parseCustomToolFile(path), {message: /body/});
});

test('throws on invalid parameter type', t => {
	const path = writeTool(
		'bad-param-type.md',
		`---
name: x
description: foo
parameters:
  thing:
    type: object
---
echo`,
	);
	t.throws(() => parseCustomToolFile(path), {message: /type/});
});

test('throws on invalid pattern regex', t => {
	const path = writeTool(
		'bad-pattern.md',
		`---
name: x
description: foo
parameters:
  thing:
    type: string
    pattern: '['
---
echo`,
	);
	t.throws(() => parseCustomToolFile(path), {message: /pattern/});
});

test('throws on timeout_ms over the cap', t => {
	const path = writeTool(
		'long-timeout.md',
		`---
name: x
description: foo
timeout_ms: 600000
---
echo`,
	);
	t.throws(() => parseCustomToolFile(path), {message: /timeout_ms/});
});

test('parses env mapping', t => {
	const path = writeTool(
		'env.md',
		`---
name: x
description: foo
env:
  FOO: bar
  BAZ: qux
---
echo`,
	);
	const meta = parseCustomToolFile(path).metadata;
	t.deepEqual(meta.env, {FOO: 'bar', BAZ: 'qux'});
});
