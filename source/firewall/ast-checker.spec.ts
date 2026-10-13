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

test('detectAnyTypeInjections skips empty oldContent (new file creation)', (t) => {
	const newCode = `export const value: any = 1;`;
	const violations = detectAnyTypeInjections('source/new-file.ts', '', newCode);
	t.is(violations.length, 0);
});

test('detectAnyTypeInjections ignores any in multi-line block comments and template literals', (t) => {
	const oldCode = `const x = 1;`;
	const newCode = `
		/**
		 * @param {any} val - documentation mention
		 */
		/* multi-line comment:
		   x: any
		*/
		const msg = \`value is \${x} : any\`;
		const x = 1;
	`;

	const violations = detectAnyTypeInjections('source/comments.ts', oldCode, newCode);
	t.is(violations.length, 0);
});

test('detectAnyTypeInjections counts any[] exactly once without overlap', (t) => {
	const oldCode = `const list: number[] = [];`;
	const newCode = `const list: any[] = [];`;

	const violations = detectAnyTypeInjections('source/arrays.ts', oldCode, newCode);
	t.is(violations.length, 1);
	t.true(violations[0].message.includes('Injected 1 explicit \'any\''));
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

test('detectExportSignatureModifications detects function parameter type changes', (t) => {
	const oldCode = `export function greet(name: string): string { return name; }`;
	const newCode = `export function greet(name: number): string { return String(name); }`;
	const violations = detectExportSignatureModifications('source/greet.ts', oldCode, newCode);
	t.is(violations.length, 1);
	t.true(violations[0].details?.includes('greet'));
});

test('detectExportSignatureModifications detects function return type changes', (t) => {
	const oldCode = `export function getValue(): string { return 'ok'; }`;
	const newCode = `export function getValue(): number { return 1; }`;
	const violations = detectExportSignatureModifications('source/val.ts', oldCode, newCode);
	t.is(violations.length, 1);
	t.true(violations[0].details?.includes('getValue'));
});

test('detectExportSignatureModifications detects generic type parameter changes', (t) => {
	const oldCode = `export function identity<T extends string>(val: T): T { return val; }`;
	const newCode = `export function identity<T extends number>(val: T): T { return val; }`;
	const violations = detectExportSignatureModifications('source/id.ts', oldCode, newCode);
	t.is(violations.length, 1);
	t.true(violations[0].details?.includes('identity'));
});

test('detectExportSignatureModifications detects interface member changes', (t) => {
	const oldCode = `export interface User { id: string; name: string; }`;
	const newCode = `export interface User { id: string; name: number; }`;
	const violations = detectExportSignatureModifications('source/user.ts', oldCode, newCode);
	t.is(violations.length, 1);
	t.true(violations[0].details?.includes('User'));
});

test('detectExportSignatureModifications detects type alias changes', (t) => {
	const oldCode = `export type ID = string | number;`;
	const newCode = `export type ID = string;`;
	const violations = detectExportSignatureModifications('source/id.ts', oldCode, newCode);
	t.is(violations.length, 1);
	t.true(violations[0].details?.includes('ID'));
});

test('detectExportSignatureModifications detects exported variable type changes', (t) => {
	const oldCode = `export const timeout: number = 5000;`;
	const newCode = `export const timeout: string = '5000';`;
	const violations = detectExportSignatureModifications('source/config.ts', oldCode, newCode);
	t.is(violations.length, 1);
	t.true(violations[0].details?.includes('timeout'));
});

test('detectExportSignatureModifications allows implementation-only changes', (t) => {
	const oldCode = `export function compute(a: number, b: number): number {\n  const sum = a + b;\n  return sum;\n}`;
	const newCode = `export function compute(a: number, b: number): number {\n  return a + b;\n}`;
	const violations = detectExportSignatureModifications('source/compute.ts', oldCode, newCode);
	t.is(violations.length, 0);
});

test('detectExportSignatureModifications detects removal in export { a, b } block', (t) => {
	const oldCode = `function foo() {}\nfunction bar() {}\nexport { foo, bar };`;
	const newCode = `function foo() {}\nfunction bar() {}\nexport { foo };`;
	const violations = detectExportSignatureModifications('source/mod.ts', oldCode, newCode);
	t.is(violations.length, 1);
	t.true(violations[0].details?.includes('bar'));
});

test('detectExportSignatureModifications supports multiline declarations and overloads', (t) => {
	const oldCode = `
export function parse(
	input: string,
	options?: {
		strict: boolean;
	}
): boolean;
export function parse(input: string, options?: any): boolean {
	return true;
}
`;
	const newCode = `
export function parse(
	input: string,
	options?: {
		strict: boolean;
	}
): boolean;
export function parse(input: string, options?: any): boolean {
	const res = Boolean(input);
	return res;
}
`;
	const violations = detectExportSignatureModifications('source/parser.ts', oldCode, newCode);
	t.is(violations.length, 0);
});

test('detectDeletedTestBlocks detects deletion among duplicate test titles', (t) => {
	const oldCode = `
test('parses config', () => {});
test('parses config', () => {});
test('validates schema', () => {});
`;
	const newCode = `
test('parses config', () => {});
test('validates schema', () => {});
`;
	const violations = detectDeletedTestBlocks('source/parser.spec.ts', oldCode, newCode);
	t.is(violations.length, 1);
	t.true(violations[0].message.includes('deletion of 1 test case(s)'));
	t.true(violations[0].details?.includes('"parses config"'));
});

test('detectAnyTypeInjections flags newly injected any even if another any was deleted', (t) => {
	const oldCode = `
function process(a: any, b: number) {
	return b;
}
`;
	const newCode = `
function process(a: string, b: any) {
	return b;
}
`;
	const violations = detectAnyTypeInjections('source/process.ts', oldCode, newCode);
	t.is(violations.length, 1);
	t.true(violations[0].message.includes("Injected 1 explicit 'any'"));
});

