import test from 'ava';
import {lazyCommands} from '@/commands/lazy-registry';
import {TIPS} from '@/constants';
import {findTips, getRandomTip, pickTip} from './tips';

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

test('getRandomTip never returns the excluded tip', t => {
	for (const excluded of TIPS) {
		for (const random of [0, 0.1, 0.5, 0.999_999]) {
			t.not(getRandomTip(() => random, excluded), excluded);
		}
	}
});

test('getRandomTip ignores an exclusion that is not in the catalogue', t => {
	t.is(getRandomTip(() => 0, 'not a real tip'), TIPS[0]);
});

test('pickTip falls back to the first entry for an out-of-range random', t => {
	const tips = ['a', 'b', 'c'];
	t.is(pickTip(tips, () => 1), 'a');
	t.is(pickTip(tips, () => -1), 'a');
});

test('findTips matches case-insensitively on tip text', t => {
	const matches = findTips('CTRL+J');
	t.is(matches.length, 1);
	t.regex(matches[0]!, /Ctrl\+J/);
});

test('findTips returns the whole catalogue for a blank query', t => {
	t.deepEqual(findTips('   '), [...TIPS]);
});

test('findTips returns nothing when no tip mentions the query', t => {
	t.deepEqual(findTips('quantum'), []);
});

test('every slash command named in a tip is a registered command', t => {
	const registered = new Set(lazyCommands.map(command => command.name));

	for (const tip of TIPS) {
		for (const [, name] of tip.matchAll(/\/([a-z][a-z-]*)/g)) {
			t.true(
				registered.has(name!),
				`tip references /${name}, which is not in lazyCommands`,
			);
		}
	}
});
