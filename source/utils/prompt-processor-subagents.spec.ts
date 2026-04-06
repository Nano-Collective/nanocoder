import test from 'ava';
import {
	setAvailableSubagents,
	getSubagentDescriptions,
} from './prompt-processor.js';

console.log('\nprompt-processor-subagents.spec.ts');

test.serial('getSubagentDescriptions returns default before any call', t => {
	// Reset by setting empty
	setAvailableSubagents([]);
	t.is(getSubagentDescriptions(), 'No subagents available.');
});

test.serial('setAvailableSubagents formats agent list', t => {
	setAvailableSubagents([
		{name: 'research', description: 'Codebase research agent'},
		{name: 'reviewer', description: 'Code review agent'},
	]);

	const result = getSubagentDescriptions();
	t.true(result.includes('- **research**: Codebase research agent'));
	t.true(result.includes('- **reviewer**: Code review agent'));
});

test.serial('setAvailableSubagents with empty array resets to default', t => {
	setAvailableSubagents([
		{name: 'research', description: 'test'},
	]);
	t.not(getSubagentDescriptions(), 'No subagents available.');

	setAvailableSubagents([]);
	t.is(getSubagentDescriptions(), 'No subagents available.');
});

test.serial('setAvailableSubagents with single agent', t => {
	setAvailableSubagents([
		{name: 'research', description: 'Read-only codebase research'},
	]);

	const result = getSubagentDescriptions();
	t.is(result, '- **research**: Read-only codebase research');
});
