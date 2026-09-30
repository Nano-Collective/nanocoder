import assert from 'node:assert/strict';
import test from 'node:test';
import {subtotal, withTax} from '../src/cart.js';

const items = [
	{price: 10, quantity: 2},
	{price: 5, quantity: 2},
];

test('subtotal sums price times quantity', () => {
	assert.equal(subtotal(items), 30);
});

test('withTax applies the rate to the subtotal', () => {
	assert.equal(withTax(items, 0.1), 33);
});
