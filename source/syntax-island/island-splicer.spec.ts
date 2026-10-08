import test from 'ava';
import { findSyntaxIsland } from './island-extractor';
import {
	spliceSyntaxIsland,
	validateDelimiterBalance,
} from './island-splicer';

test('validateDelimiterBalance verifies well-formed delimiters', (t) => {
	t.true(validateDelimiterBalance('const a = [1, 2, { b: (3 + 4) }];').valid);
	t.false(validateDelimiterBalance('const a = [1, 2, { b: (3 + 4) };').valid);
	t.false(validateDelimiterBalance('const a = (1 + 2;').valid);
});

test('spliceSyntaxIsland reconstructs file while keeping outer scaffolding locked', (t) => {
	const original = `import { logger } from './logger';

export function authenticate(token: string): boolean {
	if (!token) return false;
	return token === 'secret';
}

export const VERSION = '1.0.0';
`;

	const extraction = findSyntaxIsland(original, 'authenticate');
	t.true(extraction.found);

	const newBody = `
	if (!token) {
		logger.warn('missing token');
		return false;
	}
	return token.startsWith('valid_');
`;

	const result = spliceSyntaxIsland(original, extraction.island!, newBody);
	t.true(result.success);
	t.truthy(result.newContent);

	// Verify outer scaffolding is byte-identical
	t.true(result.newContent?.startsWith(`import { logger } from './logger';\n\nexport function authenticate(token: string): boolean {`));
	t.true(result.newContent?.endsWith(`}\n\nexport const VERSION = '1.0.0';\n`));
	t.true(result.newContent?.includes(`logger.warn('missing token');`));
});

test('spliceSyntaxIsland un-wraps outer braces if model included them', (t) => {
	const original = `function add(a: number, b: number): number { return a + b; }`;
	const extraction = findSyntaxIsland(original, 'add');
	t.true(extraction.found);

	const newBody = `{
		return (a + b) * 2;
	}`;

	const result = spliceSyntaxIsland(original, extraction.island!, newBody);
	t.true(result.success);
	t.true(result.newContent?.includes('return (a + b) * 2;'));
	t.false(result.newContent?.includes('{{'));
});

test('spliceSyntaxIsland rejects syntactically invalid replacement body', (t) => {
	const original = `function test() { return 1; }`;
	const extraction = findSyntaxIsland(original, 'test');
	t.true(extraction.found);

	const brokenBody = `if (true { return 1;`;
	const result = spliceSyntaxIsland(original, extraction.island!, brokenBody);
	t.false(result.success);
	t.truthy(result.error);
});

test('spliceSyntaxIsland rejects expression bracket mismatch like return (foo + bar]', (t) => {
	const original = `export function calculate(foo: number, bar: number): number { return foo + bar; }`;
	const extraction = findSyntaxIsland(original, 'calculate');
	t.true(extraction.found);

	const malformedBody = `return (foo + bar];`;
	const result = spliceSyntaxIsland(original, extraction.island!, malformedBody);
	t.false(result.success);
	t.truthy(result.error);
	t.true(result.error?.includes('syntax') || result.error?.includes('Expected'));
});

test('spliceSyntaxIsland correctly validates and splices TypeScript class method', (t) => {
	const original = `
class Service {
	public async execute<T>(payload: T): Promise<T> {
		return payload;
	}
}
`;
	const extraction = findSyntaxIsland(original, 'execute');
	t.true(extraction.found);

	const validBody = `
		const timestamp: number = Date.now();
		console.log('executing at', timestamp);
		return payload;
`;
	const result = spliceSyntaxIsland(original, extraction.island!, validBody);
	t.true(result.success);
	t.truthy(result.newContent);
	t.true(result.newContent?.includes('const timestamp: number = Date.now();'));
});
