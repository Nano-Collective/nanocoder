import test from 'ava';
import {TIPS} from '@/constants';
import {getRandomTip} from './tips';

test('getRandomTip selects the first tip at the lower boundary', t => {
	t.is(getRandomTip(() => 0), TIPS[0]);
});

test('getRandomTip selects the last tip at the upper boundary', t => {
	t.is(getRandomTip(() => 0.999_999), TIPS.at(-1));
});

test('getRandomTip always returns a tip from the catalogue', t => {
	for (const random of [0, 0.1, 0.25, 0.5, 0.75, 0.999_999]) {
		t.true(TIPS.includes(getRandomTip(() => random)));
	}
});
