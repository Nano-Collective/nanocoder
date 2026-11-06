import test from 'ava';
import {SequenceTracker} from './sequence-tracker.js';

test('SequenceTracker detects repeated multi-step read-only tool sequences', t => {
	const tracker = new SequenceTracker({minOccurrencesForCandidate: 2});

	// Sequence 1: find_files -> read_file
	tracker.recordExecution({
		toolName: 'find_files',
		inputArgs: {pattern: '*.ts'},
		success: true,
		readOnly: true,
		durationMs: 100,
		timestamp: Date.now(),
	});
	tracker.recordExecution({
		toolName: 'read_file',
		inputArgs: {path: 'source/app.tsx'},
		success: true,
		readOnly: true,
		durationMs: 50,
		timestamp: Date.now(),
	});

	// After 1 run, pattern exists with 1 occurrence, not yet a candidate
	const patterns1 = tracker.getPatterns(1);
	t.is(patterns1.length, 1);
	t.is(patterns1[0].signature, 'find_files -> read_file');
	t.is(tracker.getCandidates().length, 0);

	// Sequence 2: find_files -> read_file again
	tracker.recordExecution({
		toolName: 'find_files',
		inputArgs: {pattern: '*.spec.ts'},
		success: true,
		readOnly: true,
		durationMs: 120,
		timestamp: Date.now(),
	});
	tracker.recordExecution({
		toolName: 'read_file',
		inputArgs: {path: 'source/app.spec.tsx'},
		success: true,
		readOnly: true,
		durationMs: 40,
		timestamp: Date.now(),
	});

	// Now it has 2 occurrences and is a candidate macro
	const candidates = tracker.getCandidates();
	t.is(candidates.length, 1);
	t.is(candidates[0].signature, 'find_files -> read_file');
	t.is(candidates[0].occurrences, 2);
	t.truthy(candidates[0].exemplarRecords);
	t.is(candidates[0].exemplarRecords?.length, 2);
	t.is(candidates[0].exemplarRecords?.[0].inputArgs.pattern, '*.spec.ts');
	t.is(candidates[0].exemplarRecords?.[1].inputArgs.path, 'source/app.spec.tsx');
});

test('SequenceTracker preserves parallelBatch tag on exemplar records', t => {
	const tracker = new SequenceTracker({minOccurrencesForCandidate: 1});

	tracker.recordExecution({
		toolName: 'search_file_contents',
		inputArgs: {query: 'foo'},
		success: true,
		readOnly: true,
		parallelBatch: true,
		timestamp: Date.now(),
	});
	tracker.recordExecution({
		toolName: 'read_file',
		inputArgs: {path: 'foo.ts'},
		success: true,
		readOnly: true,
		parallelBatch: true,
		timestamp: Date.now(),
	});

	const patterns = tracker.getPatterns(1);
	t.is(patterns.length, 1);
	t.true(patterns[0].exemplarRecords?.[0].parallelBatch);
	t.true(patterns[0].exemplarRecords?.[1].parallelBatch);
});

test('SequenceTracker ignores non-read-only tool executions and breaks chains', t => {
	const tracker = new SequenceTracker({minOccurrencesForCandidate: 1});

	// find_files (read-only) -> write_file (non-read-only) -> read_file (read-only)
	tracker.recordExecution({
		toolName: 'find_files',
		inputArgs: {pattern: '*.ts'},
		success: true,
		readOnly: true,
		timestamp: Date.now(),
	});
	tracker.recordExecution({
		toolName: 'write_file',
		inputArgs: {path: 'test.txt', content: 'hello'},
		success: true,
		readOnly: false,
		timestamp: Date.now(),
	});
	tracker.recordExecution({
		toolName: 'read_file',
		inputArgs: {path: 'test.txt'},
		success: true,
		readOnly: true,
		timestamp: Date.now(),
	});

	// No contiguous 2+ read-only pattern should be extracted
	t.is(tracker.getPatterns().length, 0);
	t.is(tracker.getCurrentChain().length, 1);
});

test('SequenceTracker breakChain explicitly resets the active chain', t => {
	const tracker = new SequenceTracker({minOccurrencesForCandidate: 1});

	tracker.recordExecution({
		toolName: 'find_files',
		inputArgs: {},
		success: true,
		readOnly: true,
		timestamp: Date.now(),
	});

	t.is(tracker.getCurrentChain().length, 1);

	// Explicitly break chain (e.g., agent batch or mutation occurred)
	tracker.breakChain();

	t.is(tracker.getCurrentChain().length, 0);

	tracker.recordExecution({
		toolName: 'read_file',
		inputArgs: {},
		success: true,
		readOnly: true,
		timestamp: Date.now(),
	});

	// Separated by breakChain, so no 2-step sequence formed
	t.is(tracker.getPatterns().length, 0);
	t.is(tracker.getCurrentChain().length, 1);
});

test('SequenceTracker ignores failed tool executions and breaks chains', t => {
	const tracker = new SequenceTracker();

	tracker.recordExecution({
		toolName: 'find_files',
		inputArgs: {pattern: 'fail'},
		success: false,
		readOnly: true,
		durationMs: 10,
		timestamp: Date.now(),
	});
	tracker.recordExecution({
		toolName: 'read_file',
		inputArgs: {path: 'app.ts'},
		success: true,
		readOnly: true,
		durationMs: 10,
		timestamp: Date.now(),
	});

	// No successful 2-step sequence formed
	t.is(tracker.getPatterns().length, 0);
});

test('SequenceTracker evicts history beyond maxHistory', t => {
	const tracker = new SequenceTracker({maxHistory: 3});

	for (let i = 0; i < 5; i++) {
		tracker.recordExecution({
			toolName: `read_file_${i}`,
			inputArgs: {},
			success: true,
			readOnly: true,
			timestamp: Date.now(),
		});
	}

	t.is(tracker.getHistory().length, 3);
	t.is(tracker.getHistory()[0].toolName, 'read_file_2');
	t.is(tracker.getHistory()[2].toolName, 'read_file_4');
});

test('SequenceTracker clear resets patterns, history, and active chain', t => {
	const tracker = new SequenceTracker();
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
	t.is(tracker.getHistory().length, 2);
	t.is(tracker.getCurrentChain().length, 2);

	tracker.clear();

	t.is(tracker.getPatterns().length, 0);
	t.is(tracker.getHistory().length, 0);
	t.is(tracker.getCurrentChain().length, 0);
});

test('SequenceTracker counts non-overlapping repeats and does not inflate single run of identical tools', t => {
	const tracker = new SequenceTracker({minOccurrencesForCandidate: 2});

	// A single run of four read_file calls
	for (let i = 0; i < 4; i++) {
		tracker.recordExecution({
			toolName: 'read_file',
			inputArgs: {path: `file_${i}.ts`},
			success: true,
			readOnly: true,
			timestamp: Date.now(),
		});
	}

	// Should not be reported as a repeated candidate in a single run
	const patterns = tracker.getPatterns(1);
	const readRepeatPattern = patterns.find(
		p => p.signature === 'read_file -> read_file',
	);
	t.truthy(readRepeatPattern);
	t.is(readRepeatPattern?.occurrences, 1);
	t.is(tracker.getCandidates().length, 0);

	// A second separate streak of read_file calls (e.g. after a chain break / new turn)
	tracker.breakChain();
	tracker.recordExecution({
		toolName: 'read_file',
		inputArgs: {path: 'other_1.ts'},
		success: true,
		readOnly: true,
		timestamp: Date.now(),
	});
	tracker.recordExecution({
		toolName: 'read_file',
		inputArgs: {path: 'other_2.ts'},
		success: true,
		readOnly: true,
		timestamp: Date.now(),
	});

	// Now it has occurred in 2 separate runs and becomes a candidate
	const candidates = tracker.getCandidates();
	t.is(candidates.length, 1);
	t.is(candidates[0].signature, 'read_file -> read_file');
	t.is(candidates[0].occurrences, 2);
});
