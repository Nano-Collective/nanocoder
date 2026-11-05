import test from 'ava';
import {
	findMatchingBrace,
	findSyntaxIsland,
} from './island-extractor';

test('findMatchingBrace finds matching closing brace across nested scopes', (t) => {
	const code = '{ if (true) { const x = "{ ignored }"; } }';
	const closeIndex = findMatchingBrace(code, 0);
	t.is(closeIndex, code.length - 1);
});

test('findMatchingBrace skips braces in comments and strings', (t) => {
	const code = `{
		// { line comment }
		/* { block comment } */
		const str = "{ string }";
		return str;
	}`;
	const closeIndex = findMatchingBrace(code, 0);
	t.is(closeIndex, code.length - 1);
});

test('findSyntaxIsland extracts standard function declaration', (t) => {
	const source = `
import { foo } from 'bar';

export async function calculateTotal(items: number[]): Promise<number> {
	let sum = 0;
	for (const item of items) {
		sum += item;
	}
	return sum;
}

export function sibling() {}
`;

	const result = findSyntaxIsland(source, 'calculateTotal');
	t.true(result.found);
	t.truthy(result.island);
	t.is(result.island?.name, 'calculateTotal');
	t.is(result.island?.kind, 'function');
	t.true(result.island?.signature.includes('export async function calculateTotal'));
	t.true(result.island?.originalBody.includes('sum += item;'));
});

test('findSyntaxIsland extracts arrow function expression', (t) => {
	const source = `
export const processUser = async (user: User): Promise<boolean> => {
	if (!user.active) {
		return false;
	}
	return true;
};
`;

	const result = findSyntaxIsland(source, 'processUser');
	t.true(result.found);
	t.is(result.island?.name, 'processUser');
	t.is(result.island?.kind, 'arrow');
	t.true(result.island?.originalBody.includes('return true;'));
});

test('findSyntaxIsland extracts class method', (t) => {
	const source = `
class UserManager {
	private db: Database;

	public async findById(id: string): Promise<User | null> {
		return this.db.users.get(id);
	}
}
`;

	const result = findSyntaxIsland(source, 'findById');
	t.true(result.found);
	t.is(result.island?.name, 'findById');
	t.is(result.island?.kind, 'method');
	t.true(result.island?.originalBody.includes('this.db.users.get(id)'));
});

test('findSyntaxIsland ignores symbols appearing inside comments and strings', (t) => {
	const source = `
// export function targetFunc() { return 'comment'; }
/* const targetFunc = () => { return 'block'; }; */
const desc = "function targetFunc() { return 'str'; }";

export function targetFunc(value: string): string {
	return value.toUpperCase();
}
`;

	const result = findSyntaxIsland(source, 'targetFunc');
	t.true(result.found);
	t.is(result.island?.kind, 'function');
	t.true(result.island?.originalBody.includes('value.toUpperCase()'));
});

test('findSyntaxIsland does not match control flow expressions as methods', (t) => {
	const source = `
function outer() {
	if (calculate(5)) {
		console.log('in if');
	}
	while (calculate(10)) {
		break;
	}
}

class MathHelper {
	calculate(n: number): number {
		return n * 2;
	}
}
`;

	const result = findSyntaxIsland(source, 'calculate');
	t.true(result.found);
	t.is(result.island?.kind, 'method');
	t.true(result.island?.originalBody.includes('return n * 2;'));
});

test('findSyntaxIsland extracts class declaration and methods in generic class', (t) => {
	const source = `
export class DataStore<T> extends BaseStore implements IStore<T> {
	private items: Map<string, T> = new Map();

	public async get<K extends string>(key: K): Promise<T | undefined> {
		return this.items.get(key);
	}
}
`;

	const classResult = findSyntaxIsland(source, 'DataStore');
	t.true(classResult.found);
	t.is(classResult.island?.kind, 'class');
	t.true(classResult.island?.originalBody.includes('private items: Map<string, T>'));

	const methodResult = findSyntaxIsland(source, 'get');
	t.true(methodResult.found);
	t.is(methodResult.island?.kind, 'method');
	t.true(methodResult.island?.originalBody.includes('this.items.get(key)'));
});

test('findSyntaxIsland extracts generic arrow function', (t) => {
	const source = `
export const wrapValue = async <T>(val: T): Promise<{ data: T }> => {
	return { data: val };
};
`;

	const result = findSyntaxIsland(source, 'wrapValue');
	t.true(result.found);
	t.is(result.island?.kind, 'arrow');
	t.true(result.island?.originalBody.includes('return { data: val };'));
});

test('findSyntaxIsland returns error for non-existent symbol', (t) => {
	const source = `function hello() { return 'world'; }`;
	const result = findSyntaxIsland(source, 'nonExistent');
	t.false(result.found);
	t.truthy(result.error);
});
