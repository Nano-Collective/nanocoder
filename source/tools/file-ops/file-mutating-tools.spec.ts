import test from 'ava';
import {fileMutationPaths, isFileMutatingTool} from './file-mutating-tools';

console.log('\nfile-mutating-tools.spec.ts');

test('every built-in file editor is a file-mutating tool', t => {
	for (const name of [
		'write_file',
		'string_replace',
		'diff_edit',
		'lsp_format_document',
		'file_op',
	]) {
		t.true(isFileMutatingTool(name), name);
	}
	t.false(isFileMutatingTool('read_file'));
	t.false(isFileMutatingTool('execute_bash'));
});

test('fileMutationPaths reads path and the legacy file_path', t => {
	t.deepEqual(fileMutationPaths('write_file', {path: 'a.ts'}), ['a.ts']);
	t.deepEqual(fileMutationPaths('write_file', {file_path: 'b.ts'}), ['b.ts']);
	t.deepEqual(fileMutationPaths('read_file', {path: 'a.ts'}), []);
	t.deepEqual(fileMutationPaths('write_file', undefined), []);
});

test('fileMutationPaths follows what each file_op operation changes', t => {
	t.deepEqual(
		fileMutationPaths('file_op', {operation: 'delete', path: 'a.ts'}),
		['a.ts'],
	);
	t.deepEqual(
		fileMutationPaths('file_op', {
			operation: 'move',
			path: 'a.ts',
			destination: 'b.ts',
		}),
		['a.ts', 'b.ts'],
	);
	t.deepEqual(
		fileMutationPaths('file_op', {
			operation: 'copy',
			path: 'a.ts',
			destination: 'b.ts',
		}),
		['b.ts'],
	);
	t.deepEqual(
		fileMutationPaths('file_op', {operation: 'mkdir', path: 'd'}),
		[],
	);
});
