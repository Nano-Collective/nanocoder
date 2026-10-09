import test from 'ava';
import type {CustomCommand} from '@/types/index';
import {acpCustomCommandText} from './acp-custom-command';

function review(content: string, parameters?: string[]): CustomCommand {
	return {
		name: 'review',
		fullName: 'review',
		path: '/tmp/review.md',
		content,
		metadata: parameters ? {parameters} : {},
	};
}

test('ACP /review main fills {{args}} and drops the typed line', t => {
	const text = acpCustomCommandText(
		'/review main',
		review('Review the diff for {{args}}.'),
	);
	t.true(text.includes('Review the diff for main.'));
	t.false(text.includes('{{args}}'));
	t.false(text.includes('/review main'));
	t.false(text.includes('Included Command Instructions'));
});

test('ACP custom command fills a named parameter', t => {
	const text = acpCustomCommandText(
		'/review main',
		review('Target {{base}}. Extra {{note}}.', ['base', 'note']),
	);
	t.true(text.includes('Target main.'));
	t.false(text.includes('{{base}}'));
	t.false(text.includes('{{note}}'));
});

test('ACP custom command with no arguments does not leave {{args}} literal', t => {
	const text = acpCustomCommandText('/review', review('Review {{args}} end'));
	t.true(text.includes('Review  end'));
	t.false(text.includes('{{args}}'));
});

test('an omitted ACP argument uses the parameter default', t => {
	const text = acpCustomCommandText(
		'/review',
		review('Diff against {{base}}.', ['base=origin/main']),
	);
	t.true(text.includes('Diff against origin/main.'));
	t.false(text.includes('{{base}}'));
});
