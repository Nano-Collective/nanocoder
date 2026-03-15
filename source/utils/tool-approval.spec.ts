import test from 'ava';
import {createFileToolApproval} from './tool-approval';

// We need to mock the dependencies. Since AVA doesn't have built-in mocking
// for module imports, we test the function's return type and basic contract.

test('returns a function', t => {
	const approvalFn = createFileToolApproval('write_file');
	t.is(typeof approvalFn, 'function');
});

test('returned function returns a boolean', t => {
	const approvalFn = createFileToolApproval('write_file');
	const result = approvalFn();
	t.is(typeof result, 'boolean');
});

test('different tool names produce independent functions', t => {
	const fn1 = createFileToolApproval('write_file');
	const fn2 = createFileToolApproval('delete_file');
	t.not(fn1, fn2);
});
