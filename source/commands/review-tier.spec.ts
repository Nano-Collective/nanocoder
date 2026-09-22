import test from 'ava';
import {parseReviewArgs} from './review-tier';

console.log('\nreview-tier.spec.ts');

test('no arguments means the default tier', t => {
	t.deepEqual(parseReviewArgs([]), {tier: 'default', args: []});
});

test('quick tier consumes the tier word', t => {
	t.deepEqual(parseReviewArgs(['quick']), {tier: 'quick', args: []});
});

test('quick tier keeps the remaining target', t => {
	t.deepEqual(parseReviewArgs(['quick', 'feature']), {
		tier: 'quick',
		args: ['feature'],
	});
});

test('deep tier consumes the tier word', t => {
	t.deepEqual(parseReviewArgs(['deep']), {tier: 'deep', args: []});
	t.deepEqual(parseReviewArgs(['deep', '42']), {
		tier: 'deep',
		args: ['42'],
	});
});

test('a branch named quick is ambiguous and wins as a tier word', t => {
	// Documented trade-off: the tier word always wins. Users with a branch
	// literally named "quick" or "deep" must review it by its full ref.
	const parsed = parseReviewArgs(['quick']);
	t.is(parsed.tier, 'quick');
	t.is(parsed.args.length, 0);
});

test('a plain target runs the default tier', t => {
	t.deepEqual(parseReviewArgs(['feature']), {
		tier: 'default',
		args: ['feature'],
	});
});

test('tier word is case-insensitive', t => {
	t.is(parseReviewArgs(['QUICK']).tier, 'quick');
	t.is(parseReviewArgs(['Deep', 'main']).tier, 'deep');
	t.deepEqual(parseReviewArgs(['Deep', 'main']).args, ['main']);
});
