import test from 'ava';
import React from 'react';
import {getSequenceTracker, resetSequenceTracker} from '@/macros/sequence-tracker';
import {macrosCommand} from './macros';

test.beforeEach(() => {
	resetSequenceTracker();
});

test.serial('macrosCommand renders empty view when no patterns recorded', async t => {
	const result = await macrosCommand.handler([], [], {
		provider: 'ollama',
		model: 'test-model',
		tokens: 0,
		getMessageTokens: () => 0,
	});

	t.truthy(result);
	t.true(React.isValidElement(result));
});

test.serial('macrosCommand renders patterns when sequences are tracked', async t => {
	const tracker = getSequenceTracker();
	// Run 1
	tracker.recordExecution({
		toolName: 'find_files',
		inputArgs: {},
		success: true,
		readOnly: true,
		timestamp: Date.now(),
	});
	tracker.recordExecution({
		toolName: 'read_file',
		inputArgs: {},
		success: true,
		readOnly: true,
		timestamp: Date.now(),
	});

	// Run 2 (repeat)
	tracker.breakChain();
	tracker.recordExecution({
		toolName: 'find_files',
		inputArgs: {},
		success: true,
		readOnly: true,
		timestamp: Date.now(),
	});
	tracker.recordExecution({
		toolName: 'read_file',
		inputArgs: {},
		success: true,
		readOnly: true,
		timestamp: Date.now(),
	});

	const result = await macrosCommand.handler([], [], {
		provider: 'ollama',
		model: 'test-model',
		tokens: 0,
		getMessageTokens: () => 0,
	});

	t.truthy(result);
	t.true(React.isValidElement(result));
	t.is(tracker.getCandidates().length, 1);
});

test.serial('macrosCommand handles clear subcommand', async t => {
	const tracker = getSequenceTracker();
	tracker.recordExecution({
		toolName: 'find_files',
		inputArgs: {},
		success: true,
		readOnly: true,
		timestamp: Date.now(),
	});
	tracker.recordExecution({
		toolName: 'read_file',
		inputArgs: {},
		success: true,
		readOnly: true,
		timestamp: Date.now(),
	});

	t.is(tracker.getPatterns().length, 1);

	const result = await macrosCommand.handler(['clear'], [], {
		provider: 'ollama',
		model: 'test-model',
		tokens: 0,
		getMessageTokens: () => 0,
	});

	t.truthy(result);
	t.is(tracker.getPatterns().length, 0);
});
