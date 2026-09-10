import test from 'ava';
import {buildSubagentFailureMessage} from './failure-message';

console.log(`\nfailure-message.spec.ts`);

test('buildSubagentFailureMessage - appends partial output when the run produced some', t => {
	t.is(
		buildSubagentFailureMessage('Repeated tool call limit reached', 'half done'),
		'Repeated tool call limit reached\n\nPartial output produced before stopping:\nhalf done',
	);
});

test('buildSubagentFailureMessage - returns only the reason when output is blank', t => {
	t.is(buildSubagentFailureMessage('boom', '   \n'), 'boom');
});

test('buildSubagentFailureMessage - falls back to a generic reason', t => {
	t.is(buildSubagentFailureMessage(undefined, ''), 'Subagent execution failed');
});
