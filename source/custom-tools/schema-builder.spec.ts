import test from 'ava';
import type {CustomToolMetadata} from '@/types/custom-tools';
import {buildJsonSchema, buildValidator} from './schema-builder';

console.log('\ncustom-tools/schema-builder.spec.ts');

function meta(
	params: CustomToolMetadata['parameters'],
): CustomToolMetadata {
	return {
		name: 'x',
		description: 'x',
		parameters: params,
		approval: 'never',
		readOnly: true,
		timeoutMs: 1000,
	};
}

test('buildJsonSchema collects required fields', t => {
	const schema = buildJsonSchema(
		meta({
			a: {type: 'string', required: true},
			b: {type: 'string'},
		}),
	);
	t.deepEqual(schema.required.sort(), ['a']);
	t.is(schema.properties.a?.type, 'string');
});

test('buildJsonSchema maps min/max to minimum/maximum', t => {
	const schema = buildJsonSchema(
		meta({n: {type: 'integer', min: 1, max: 10}}),
	);
	t.is(schema.properties.n?.minimum, 1);
	t.is(schema.properties.n?.maximum, 10);
});

test('validator: missing required parameter', async t => {
	const v = buildValidator(meta({x: {type: 'string', required: true}}));
	const result = await v({});
	t.deepEqual(result, {
		valid: false,
		error: '⚒ Missing required parameter: x',
	});
});

test('validator: optional parameter omitted is fine', async t => {
	const v = buildValidator(meta({x: {type: 'string'}}));
	t.deepEqual(await v({}), {valid: true});
});

test('validator: wrong type', async t => {
	const v = buildValidator(meta({n: {type: 'number'}}));
	const result = await v({n: 'abc'});
	t.true(!result.valid && result.error.includes('wrong type'));
});

test('validator: integer rejects floats', async t => {
	const v = buildValidator(meta({n: {type: 'integer'}}));
	const result = await v({n: 1.5});
	t.false(result.valid);
});

test('validator: enum violation', async t => {
	const v = buildValidator(
		meta({color: {type: 'string', enum: ['red', 'green', 'blue']}}),
	);
	const result = await v({color: 'purple'});
	t.true(!result.valid && result.error.includes('must be one of'));
});

test('validator: pattern violation', async t => {
	const v = buildValidator(
		meta({slug: {type: 'string', pattern: '^[a-z]+$'}}),
	);
	t.false((await v({slug: 'Has-Dashes'})).valid);
	t.true((await v({slug: 'lower'})).valid);
});

test('validator: minLength / maxLength', async t => {
	const v = buildValidator(
		meta({s: {type: 'string', minLength: 2, maxLength: 4}}),
	);
	t.false((await v({s: 'a'})).valid);
	t.false((await v({s: 'abcde'})).valid);
	t.true((await v({s: 'abc'})).valid);
});

test('validator: min / max', async t => {
	const v = buildValidator(
		meta({n: {type: 'integer', min: 1, max: 5}}),
	);
	t.false((await v({n: 0})).valid);
	t.false((await v({n: 6})).valid);
	t.true((await v({n: 3})).valid);
});

test('validator: array item type', async t => {
	const v = buildValidator(
		meta({items: {type: 'array', items: {type: 'string'}}}),
	);
	t.false((await v({items: ['a', 1]})).valid);
	t.true((await v({items: ['a', 'b']})).valid);
});

test('validator: extra unknown params silently dropped', async t => {
	const v = buildValidator(meta({x: {type: 'string'}}));
	t.true((await v({x: 'ok', extra: 'whatever'})).valid);
});
