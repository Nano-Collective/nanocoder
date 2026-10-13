import test from 'ava';
import {
	detectAnyTypeInjections,
	detectDeletedTestBlocks,
	detectExportSignatureModifications,
} from './ast-checker';

test('detectAnyTypeInjections flags newly introduced any type annotations', (t) => {
	const oldCode = `
		function greet(name: string): string {
			return 'Hello, ' + name;
		}
	`;

	const newCode = `
		function greet(name: any): string {
			return 'Hello, ' + name;
		}
	`;

	const violations = detectAnyTypeInjections('source/greet.ts', oldCode, newCode);
	t.is(violations.length, 1);
	t.is(violations[0].rule, 'block_any_types');
	t.true(violations[0].message.includes('Injected 1 explicit \'any\''));
});

test('detectAnyTypeInjections ignores existing any types if not increased', (t) => {
	const oldCode = `
		function greet(data: any): any {
			return data;
		}
	`;

	const newCode = `
		function greet(data: any): any {
			const x = 1;
			return data;
		}
	`;

	const violations = detectAnyTypeInjections('source/greet.ts', oldCode, newCode);
	t.is(violations.length, 0);
});

test('detectAnyTypeInjections skips non-js/ts files', (t) => {
	const oldCode = `hello`;
	const newCode = `hello: any`;

	const violations = detectAnyTypeInjections('source/doc.md', oldCode, newCode);
	t.is(violations.length, 0);
});

test('detectDeletedTestBlocks flags removal of test cases in test files', (t) => {
	const oldTest = `
		test('adds two numbers', (t) => {
			t.is(1 + 1, 2);
		});

		test('subtracts two numbers', (t) => {
			t.is(2 - 1, 1);
		});
	`;

	const newTest = `
		test('adds two numbers', (t) => {
			t.is(1 + 1, 2);
		});
	`;

	const violations = detectDeletedTestBlocks('source/math.spec.ts', oldTest, newTest);
	t.is(violations.length, 1);
	t.is(violations[0].rule, 'protect_test_cases');
	t.true(violations[0].message.includes('deletion of 1 test case(s)'));
	t.true(violations[0].details?.includes('"subtracts two numbers"'));
});

test('detectDeletedTestBlocks ignores addition or modification of non-test files', (t) => {
	const oldFile = `
		function test(a, b) {}
	`;
	const newFile = `
		function test() {}
	`;

	const violations = detectDeletedTestBlocks('source/math.ts', oldFile, newFile);
	t.is(violations.length, 0);
});

test('detectExportSignatureModifications detects removal of exported functions and types', (t) => {
	const oldCode = `
		export function calculateTotal(price: number): number {
			return price * 1.1;
		}
		export interface ItemConfig {
			id: string;
		}
	`;

	const newCode = `
		export function calculateTotal(price: number): number {
			return price * 1.1;
		}
	`;

	const violations = detectExportSignatureModifications('source/pricing.ts', oldCode, newCode);
	t.is(violations.length, 1);
	t.is(violations[0].rule, 'preserve_export_signatures');
	t.true(violations[0].details?.includes('ItemConfig'));
});

test('detectExportSignatureModifications ignores new exports or test files', (t) => {
	const oldCode = `
		export function a() {}
	`;
	const newCode = `
		export function a() {}
		export function b() {}
	`;

	const violations = detectExportSignatureModifications('source/math.ts', oldCode, newCode);
	t.is(violations.length, 0);

	const testViolations = detectExportSignatureModifications('source/math.spec.ts', oldCode, '');
	t.is(testViolations.length, 0);
});
