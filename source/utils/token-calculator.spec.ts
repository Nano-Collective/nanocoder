import test from 'ava';
import {CHARS_PER_TOKEN_ESTIMATE} from '@/constants';
import {FallbackTokenizer} from '@/tokenization/tokenizers/fallback-tokenizer';
import {estimateTokens} from './token-calculator';

console.log('\ntoken-calculator.spec.ts');

test('estimateTokens rounds characters per token up', t => {
	t.is(CHARS_PER_TOKEN_ESTIMATE, 4);
	t.is(estimateTokens(''), 0);
	t.is(estimateTokens('a'), 1);
	t.is(estimateTokens('abcd'), 1);
	t.is(estimateTokens('abcde'), 2);
	t.is(estimateTokens('x'.repeat(400)), 100);
});

test('the fallback tokenizer counts with estimateTokens', t => {
	const tokenizer = new FallbackTokenizer();
	t.is(tokenizer.encode('abcde'), estimateTokens('abcde'));
	t.is(
		tokenizer.countTokens({role: 'user', content: 'abcdefgh'}),
		estimateTokens('abcdefgh') + estimateTokens('user'),
	);
});
