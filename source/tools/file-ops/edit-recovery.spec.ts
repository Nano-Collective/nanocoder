import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {join, relative} from 'node:path';
import test from 'ava';
import {processToolUse, setToolRegistryGetter} from '@/message-handler';
import type {EditRecoveryPayload} from '@/utils/edit-recovery';
import {clearReadTracker, markFileSeen} from '@/utils/read-tracker';
import {withValidation} from '@/utils/tool-validation';
import {diffEditTool} from './diff-edit';
import {stringReplaceTool} from './string-replace';

let directory: string;
test.beforeEach(async () => {
	directory = await mkdtemp(join(process.cwd(), '.edit-recovery-test-'));
	clearReadTracker();
});
test.afterEach.always(async () => {
	await rm(directory, {recursive: true, force: true});
	clearReadTracker();
	setToolRegistryGetter(() => ({}));
});

function recoveryFrom(message: string): EditRecoveryPayload {
	return JSON.parse(message.split('Edit recovery evidence (JSON):\n')[1]);
}

test('validated string_replace returns evidence through processToolUse and exact retry succeeds', async t => {
	const file = join(directory, 'example.ts');
	const path = relative(process.cwd(), file);
	const original = 'function run() {\n\n\tstart();\n}\n';
	await writeFile(file, original);
	markFileSeen(file);
	const execute = stringReplaceTool.tool.execute!;
	setToolRegistryGetter(() => ({
		string_replace: withValidation(args => execute(args, {toolCallId: 'test', messages: []}), stringReplaceTool.validator),
	}));
	const failed = await processToolUse({
		id: 'failed',
		function: {name: 'string_replace', arguments: {path, old_str: 'function run() {\n  start();\n}', new_str: 'function run() {\n\tfinish();\n}'}},
	});
	t.true(failed.isError);
	t.is(await readFile(file, 'utf8'), original);
	const recovery = recoveryFrom(failed.content);
	t.is(recovery.status, 'candidate_found');
	t.is(recovery.candidates[0].actualText, original.slice(0, -1));
	const retried = await processToolUse({
		id: 'retry',
		function: {name: 'string_replace', arguments: {path, old_str: recovery.candidates[0].actualText, new_str: 'function run() {\n\tfinish();\n}'}},
	});
	t.falsy(retried.isError);
	t.is(await readFile(file, 'utf8'), 'function run() {\n\tfinish();\n}\n');
});

test('direct string_replace execution also supplies recovery without writing', async t => {
	const file = join(directory, 'direct.ts');
	const original = '\tconst first = 1;';
	await writeFile(file, original);
	const error = await t.throwsAsync(() => stringReplaceTool.tool.execute!({path: file, old_str: '  const first = 1;', new_str: 'wrong'}, {toolCallId: 'test', messages: []}));
	t.is(recoveryFrom(error!.message).candidates[0].actualText, original);
	t.is(await readFile(file, 'utf8'), original);
});

test('diff_edit reports the failing block and never applies earlier valid blocks', async t => {
	const file = join(directory, 'multiple.ts');
	const path = relative(process.cwd(), file);
	const original = 'const first = 1;\n\tconst second = 2;\n';
	await writeFile(file, original);
	markFileSeen(file);
	const block = (search: string, replacement: string) => ['<<<<<<< SEARCH', search, '=======', replacement, '>>>>>>> REPLACE'].join('\n');
	const diff = block('const first = 1;', 'const first = 3;') + '\n' + block('  const second = 2;', 'const second = 4;');
	const validation = await diffEditTool.validator!({path, diff});
	t.false(validation.valid);
	if (validation.valid) return;
	const recovery = recoveryFrom(validation.error);
	t.is(recovery.blockNumber, 2);
	t.is(recovery.candidates[0].actualText, '\tconst second = 2;');
	await t.throwsAsync(() => diffEditTool.tool.execute!({path, diff}, {toolCallId: 'test', messages: []}), {message: /Edit recovery evidence/});
	t.is(await readFile(file, 'utf8'), original);
	await diffEditTool.tool.execute!({path, diff: block('const first = 1;', 'const first = 3;') + '\n' + block(recovery.candidates[0].actualText!, 'const second = 4;')}, {toolCallId: 'test', messages: []});
	t.is(await readFile(file, 'utf8'), 'const first = 3;\nconst second = 4;\n');
});

test('read-before-edit guard rejects unseen files without disclosing recovery', async t => {
	const file = join(directory, 'unseen.ts');
	await writeFile(file, '\tconst first = 1;');
	const validation = await stringReplaceTool.validator!({path: relative(process.cwd(), file), old_str: ' const first = 1;', new_str: 'wrong'});
	t.false(validation.valid);
	if (!validation.valid) {
		t.regex(validation.error, /must read/);
		t.false(validation.error.includes('Edit recovery evidence'));
	}
});
