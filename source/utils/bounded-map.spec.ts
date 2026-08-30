import test from 'ava';
import {BoundedMap} from './bounded-map';

test('BoundedMap - basic set and get operations', t => {
	const map = new BoundedMap<string, number>();

	map.set('a', 1);
	map.set('b', 2);
	map.set('c', 3);

	t.is(map.get('a'), 1);
	t.is(map.get('b'), 2);
	t.is(map.get('c'), 3);
	t.is(map.get('nonexistent'), undefined);
});

test('BoundedMap - has() method', t => {
	const map = new BoundedMap<string, number>();

	map.set('a', 1);

	t.true(map.has('a'));
	t.false(map.has('nonexistent'));
});

test('BoundedMap - has() returns true for an existing undefined value', t => {
	const map = new BoundedMap<string, undefined>();

	map.set('key', undefined);

	t.true(map.has('key'));
	t.false(map.has('missing'));
});

test('BoundedMap - delete() method', t => {
	const map = new BoundedMap<string, number>();

	map.set('a', 1);
	map.set('b', 2);

	t.true(map.delete('a'));
	t.false(map.has('a'));
	t.true(map.has('b'));
	t.false(map.delete('nonexistent'));
});

test('BoundedMap - clear() method', t => {
	const map = new BoundedMap<string, number>();

	map.set('a', 1);
	map.set('b', 2);
	map.set('c', 3);

	t.is(map.size, 3);
	map.clear();
	t.is(map.size, 0);
	t.false(map.has('a'));
});

test('BoundedMap - enforces max size limit', t => {
	const map = new BoundedMap<string, number>({maxSize: 3});

	map.set('a', 1);
	map.set('b', 2);
	map.set('c', 3);
	t.is(map.size, 3);

	// Adding 4th element should evict oldest ('a')
	map.set('d', 4);
	t.is(map.size, 3);
	t.false(map.has('a')); // Oldest entry evicted
	t.true(map.has('b'));
	t.true(map.has('c'));
	t.true(map.has('d'));
});

test('BoundedMap - evicts oldest entry first', t => {
	const map = new BoundedMap<string, number>({maxSize: 2});

	map.set('first', 1);
	map.set('second', 2);
	map.set('third', 3);

	// 'first' should be evicted
	t.false(map.has('first'));
	t.true(map.has('second'));
	t.true(map.has('third'));
});

test('BoundedMap - updating existing key does not trigger eviction', t => {
	const map = new BoundedMap<string, number>({maxSize: 2});

	map.set('a', 1);
	map.set('b', 2);

	// Update existing key
	map.set('a', 10);

	// Should still have both entries
	t.is(map.size, 2);
	t.is(map.get('a'), 10);
	t.is(map.get('b'), 2);
});

test('BoundedMap - TTL causes entries to expire', async t => {
	const map = new BoundedMap<string, number>({
		maxSize: 100,
		ttl: 50, // 50ms TTL
	});

	map.set('a', 1);
	t.is(map.get('a'), 1);

	// Wait for TTL to expire
	await new Promise(resolve => setTimeout(resolve, 60));

	// Entry should be expired
	t.is(map.get('a'), undefined);
	t.false(map.has('a'));
});

test('BoundedMap - entries within TTL are accessible', async t => {
	const map = new BoundedMap<string, number>({
		maxSize: 100,
		ttl: 100, // 100ms TTL
	});

	map.set('a', 1);

	// Wait less than TTL
	await new Promise(resolve => setTimeout(resolve, 50));

	// Entry should still be accessible
	t.is(map.get('a'), 1);
	t.true(map.has('a'));
});

test('BoundedMap - keys() returns non-expired keys', async t => {
	const map = new BoundedMap<string, number>({
		maxSize: 100,
		ttl: 50, // 50ms TTL
	});

	map.set('a', 1);
	map.set('b', 2);

	await new Promise(resolve => setTimeout(resolve, 60));

	map.set('c', 3); // Add after expiration

	const keys = Array.from(map.keys());
	t.deepEqual(keys, ['c']);
});

test('BoundedMap - values() returns non-expired values', async t => {
	const map = new BoundedMap<string, number>({
		maxSize: 100,
		ttl: 50,
	});

	map.set('a', 1);
	map.set('b', 2);

	await new Promise(resolve => setTimeout(resolve, 60));

	map.set('c', 3);

	const values = Array.from(map.values());
	t.deepEqual(values, [3]);
});

test('BoundedMap - entries() returns non-expired entries', async t => {
	const map = new BoundedMap<string, number>({
		maxSize: 100,
		ttl: 50,
	});

	map.set('a', 1);
	map.set('b', 2);

	await new Promise(resolve => setTimeout(resolve, 60));

	map.set('c', 3);

	const entries = Array.from(map.entries());
	t.deepEqual(entries, [['c', 3]]);
});

test('BoundedMap - forEach iterates over non-expired entries', async t => {
	const map = new BoundedMap<string, number>({
		maxSize: 100,
		ttl: 50,
	});

	map.set('a', 1);
	map.set('b', 2);

	await new Promise(resolve => setTimeout(resolve, 60));

	map.set('c', 3);

	const entries: Array<[string, number]> = [];
	map.forEach((value, key) => {
		entries.push([key, value]);
	});

	t.deepEqual(entries, [['c', 3]]);
});

test('BoundedMap - is iterable', t => {
	const map = new BoundedMap<string, number>();

	map.set('a', 1);
	map.set('b', 2);
	map.set('c', 3);

	const entries = Array.from(map);
	t.deepEqual(entries, [
		['a', 1],
		['b', 2],
		['c', 3],
	]);
});

test('BoundedMap - getRawSize() returns size including expired entries', async t => {
	const map = new BoundedMap<string, number>({
		maxSize: 100,
		ttl: 50,
	});

	map.set('a', 1);
	map.set('b', 2);

	await new Promise(resolve => setTimeout(resolve, 60));

	// Entries are expired but not yet cleaned up
	t.is(map.getRawSize(), 2);

	// Accessing keys() triggers cleanup
	Array.from(map.keys());
	t.is(map.getRawSize(), 0);
});

test('BoundedMap - throws error if maxSize is 0 or negative', t => {
	t.throws(
		() => {
			new BoundedMap({maxSize: 0});
		},
		{message: 'maxSize must be greater than 0'},
	);

	t.throws(
		() => {
			new BoundedMap({maxSize: -1});
		},
		{message: 'maxSize must be greater than 0'},
	);
});

test('BoundedMap - default maxSize is 1000', t => {
	const map = new BoundedMap<string, number>();

	// Fill with 1000 entries
	for (let i = 0; i < 1000; i++) {
		map.set(`key${i}`, i);
	}

	t.is(map.size, 1000);

	// Adding 1001st entry should evict first
	map.set('key1000', 1000);
	t.is(map.size, 1000);
	t.false(map.has('key0'));
	t.true(map.has('key1000'));
});

test('BoundedMap - works with different key/value types', t => {
	const numberMap = new BoundedMap<number, string>();
	numberMap.set(1, 'one');
	numberMap.set(2, 'two');
	t.is(numberMap.get(1), 'one');

	const objectMap = new BoundedMap<string, {value: number}>();
	objectMap.set('a', {value: 1});
	t.deepEqual(objectMap.get('a'), {value: 1});
});

test('BoundedMap - set() returns this for chaining', t => {
	const map = new BoundedMap<string, number>();

	const result = map.set('a', 1).set('b', 2).set('c', 3);

	t.is(result, map);
	t.is(map.size, 3);
});

test('BoundedMap - no TTL when ttl is 0 or undefined', async t => {
	const map1 = new BoundedMap<string, number>({ttl: 0});
	const map2 = new BoundedMap<string, number>({ttl: undefined});

	map1.set('a', 1);
	map2.set('b', 2);

	await new Promise(resolve => setTimeout(resolve, 100));

	// Entries should not expire
	t.is(map1.get('a'), 1);
	t.is(map2.get('b'), 2);
});
