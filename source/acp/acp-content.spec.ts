import test from 'ava';
import {acpContentToUserText} from '@/acp/acp-content';

console.log('\nacp-content.spec.ts');

// ============================================================================
// acpContentToUserText
// ============================================================================

test('acpContentToUserText - empty array returns empty string', t => {
	t.is(acpContentToUserText([]), '');
});

test('acpContentToUserText - single text block returns its text', t => {
	const result = acpContentToUserText([{type: 'text', text: 'Hello'}]);
	t.is(result, 'Hello');
});

test('acpContentToUserText - multiple text blocks concatenated in order', t => {
	const result = acpContentToUserText([
		{type: 'text', text: 'Hello '},
		{type: 'text', text: 'World'},
	]);
	t.is(result, 'Hello World');
});

test('acpContentToUserText - ignores non-text blocks', t => {
	const result = acpContentToUserText([
		{type: 'image' as any, url: 'https://example.com/img.png'} as any,
	]);
	t.is(result, '');
});

test('acpContentToUserText - mixed blocks concatenates only text parts', t => {
	const result = acpContentToUserText([
		{type: 'text', text: 'Before '},
		{type: 'image' as any, url: 'https://example.com/img.png'} as any,
		{type: 'text', text: 'After'},
	]);
	t.is(result, 'Before After');
});

test('acpContentToUserText - preserves exact text content', t => {
	const specialText = 'Hello "world"\nNew line\tTab';
	const result = acpContentToUserText([{type: 'text', text: specialText}]);
	t.is(result, specialText);
});
