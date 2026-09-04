import test from 'ava';
import {ExponentialBackoff} from './backoff';

console.log('\nbackoff.spec.ts');

test('first call returns baseMs', t => {
	const backoff = new ExponentialBackoff({baseMs: 100, maxMs: 10_000});
	t.is(backoff.next(), 100);
});

test('grows by the default factor of 2 each call', t => {
	const backoff = new ExponentialBackoff({baseMs: 100, maxMs: 10_000});
	t.is(backoff.next(), 100);
	t.is(backoff.next(), 200);
	t.is(backoff.next(), 400);
	t.is(backoff.next(), 800);
});

test('honors a custom factor', t => {
	const backoff = new ExponentialBackoff({baseMs: 10, maxMs: 10_000, factor: 3});
	t.is(backoff.next(), 10);
	t.is(backoff.next(), 30);
	t.is(backoff.next(), 90);
});

test('caps at maxMs', t => {
	const backoff = new ExponentialBackoff({baseMs: 100, maxMs: 350});
	t.is(backoff.next(), 100);
	t.is(backoff.next(), 200);
	t.is(backoff.next(), 350); // would be 400, capped
	t.is(backoff.next(), 350);
});

test('reset returns the counter to baseMs', t => {
	const backoff = new ExponentialBackoff({baseMs: 50, maxMs: 10_000});
	backoff.next();
	backoff.next();
	backoff.reset();
	t.is(backoff.next(), 50);
});
