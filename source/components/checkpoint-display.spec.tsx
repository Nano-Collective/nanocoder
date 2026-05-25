import {renderWithTheme} from '@/test-utils/render-with-theme';
import type {CheckpointListItem} from '@/types/checkpoint';
import test from 'ava';
import React from 'react';
import {CheckpointListDisplay} from './checkpoint-display';

const createMockCheckpoint = (
	name: string,
	overrides: Partial<CheckpointListItem> = {},
): CheckpointListItem => ({
	name,
	metadata: {
		name,
		timestamp: new Date().toISOString(),
		messageCount: 10,
		filesChanged: ['file1.ts', 'file2.ts'],
		provider: {name: 'Test Provider', model: 'test-model'},
		description: 'Test checkpoint',
	},
	sizeBytes: 1024,
	...overrides,
});

test('CheckpointListDisplay renders empty state when no checkpoints', t => {
	const {lastFrame} = renderWithTheme(
		<CheckpointListDisplay checkpoints={[]} />,
	);

	const output = lastFrame() || '';
	t.true(output.includes('No checkpoints found'));
	t.true(output.includes('/checkpoint create'));
});

test('CheckpointListDisplay renders with default title', t => {
	const checkpoints = [createMockCheckpoint('test-checkpoint')];
	const {lastFrame} = renderWithTheme(
		<CheckpointListDisplay checkpoints={checkpoints} />,
	);

	const output = lastFrame() || '';
	t.true(output.includes('Available Checkpoints'));
});

test('CheckpointListDisplay renders with custom title', t => {
	const checkpoints = [createMockCheckpoint('test-checkpoint')];
	const {lastFrame} = renderWithTheme(
		<CheckpointListDisplay checkpoints={checkpoints} title="My Checkpoints" />,
	);

	const output = lastFrame() || '';
	t.true(output.includes('My Checkpoints'));
});

test('CheckpointListDisplay renders checkpoint name', t => {
	const checkpoints = [createMockCheckpoint('my-test-checkpoint')];
	const {lastFrame} = renderWithTheme(
		<CheckpointListDisplay checkpoints={checkpoints} />,
	);

	const output = lastFrame() || '';
	t.true(output.includes('my-test-checkpoint'));
});

test('CheckpointListDisplay truncates long checkpoint names', t => {
	const longName = 'this-is-a-very-long-checkpoint-name-that-exceeds-limit';
	const checkpoints = [createMockCheckpoint(longName)];
	const {lastFrame} = renderWithTheme(
		<CheckpointListDisplay checkpoints={checkpoints} />,
	);

	const output = lastFrame() || '';
	// Should be truncated with ...
	t.true(output.includes('...'));
	t.false(output.includes(longName)); // Full name should not appear
});

test('CheckpointListDisplay renders message count', t => {
	const checkpoints = [
		createMockCheckpoint('test', {
			metadata: {
				name: 'test',
				timestamp: new Date().toISOString(),
				messageCount: 42,
				filesChanged: [],
				provider: {name: 'Test', model: 'model'},
			},
		}),
	];
	const {lastFrame} = renderWithTheme(
		<CheckpointListDisplay checkpoints={checkpoints} />,
	);

	const output = lastFrame() || '';
	t.true(output.includes('42'));
});

test('CheckpointListDisplay renders files count', t => {
	const checkpoints = [
		createMockCheckpoint('test', {
			metadata: {
				name: 'test',
				timestamp: new Date().toISOString(),
				messageCount: 10,
				filesChanged: ['a.ts', 'b.ts', 'c.ts'],
				provider: {name: 'Test', model: 'model'},
			},
		}),
	];
	const {lastFrame} = renderWithTheme(
		<CheckpointListDisplay checkpoints={checkpoints} />,
	);

	const output = lastFrame() || '';
	t.true(output.includes('3'));
});

test('CheckpointListDisplay renders size in KB', t => {
	const checkpoints = [createMockCheckpoint('test', {sizeBytes: 2048})];
	const {lastFrame} = renderWithTheme(
		<CheckpointListDisplay checkpoints={checkpoints} />,
	);

	const output = lastFrame() || '';
	t.true(output.includes('2KB'));
});

test('CheckpointListDisplay renders size in MB', t => {
	const checkpoints = [
		createMockCheckpoint('test', {sizeBytes: 2 * 1024 * 1024}),
	];
	const {lastFrame} = renderWithTheme(
		<CheckpointListDisplay checkpoints={checkpoints} />,
	);

	const output = lastFrame() || '';
	t.true(output.includes('2.0MB'));
});

test('CheckpointListDisplay renders size in bytes for small files', t => {
	const checkpoints = [createMockCheckpoint('test', {sizeBytes: 500})];
	const {lastFrame} = renderWithTheme(
		<CheckpointListDisplay checkpoints={checkpoints} />,
	);

	const output = lastFrame() || '';
	t.true(output.includes('500B'));
});

test('CheckpointListDisplay renders multiple checkpoints', t => {
	const checkpoints = [
		createMockCheckpoint('checkpoint-1'),
		createMockCheckpoint('checkpoint-2'),
		createMockCheckpoint('checkpoint-3'),
	];
	const {lastFrame} = renderWithTheme(
		<CheckpointListDisplay checkpoints={checkpoints} />,
	);

	const output = lastFrame() || '';
	t.true(output.includes('checkpoint-1'));
	t.true(output.includes('checkpoint-2'));
	t.true(output.includes('checkpoint-3'));
});

test('CheckpointListDisplay renders table headers', t => {
	const checkpoints = [createMockCheckpoint('test')];
	const {lastFrame} = renderWithTheme(
		<CheckpointListDisplay checkpoints={checkpoints} />,
	);

	const output = lastFrame() || '';
	t.true(output.includes('Name'));
	t.true(output.includes('Created'));
	t.true(output.includes('Messages'));
	t.true(output.includes('Files'));
	t.true(output.includes('Size'));
});

test('CheckpointListDisplay renders relative time', t => {
	const checkpoints = [
		createMockCheckpoint('test', {
			metadata: {
				name: 'test',
				timestamp: new Date().toISOString(), // Just now
				messageCount: 10,
				filesChanged: [],
				provider: {name: 'Test', model: 'model'},
			},
		}),
	];
	const {lastFrame} = renderWithTheme(
		<CheckpointListDisplay checkpoints={checkpoints} />,
	);

	const output = lastFrame() || '';
	t.true(output.includes('Just now'));
});

test('CheckpointListDisplay handles empty size', t => {
	const checkpoints = [createMockCheckpoint('test', {sizeBytes: undefined})];
	const {lastFrame} = renderWithTheme(
		<CheckpointListDisplay checkpoints={checkpoints} />,
	);

	// Should render without crashing
	const output = lastFrame() || '';
	t.true(output.includes('test'));
});

test('CheckpointListDisplay handles zero size', t => {
	const checkpoints = [createMockCheckpoint('test', {sizeBytes: 0})];
	const {lastFrame} = renderWithTheme(
		<CheckpointListDisplay checkpoints={checkpoints} />,
	);

	// Should render without crashing (empty string for 0 bytes)
	const output = lastFrame() || '';
	t.true(output.includes('test'));
});

test('CheckpointListDisplay shows trigger reason for trigger checkpoints', t => {
	const checkpoints = [
		createMockCheckpoint('trigger-cp', {
			metadata: {
				name: 'trigger-cp',
				timestamp: new Date().toISOString(),
				messageCount: 0,
				filesChanged: [],
				provider: {
					name: 'trigger',
					model: 'trigger:file.changed:agent:docs-agent',
				},
				description: 'Empty conversation',
			},
		}),
	];
	const {lastFrame} = renderWithTheme(
		<CheckpointListDisplay checkpoints={checkpoints} />,
	);

	const output = lastFrame() || '';
	t.true(output.includes('trigger-cp'));
	t.regex(output, /↳ trigger:file\.changed:agent:docs-agent/);
});

test('CheckpointListDisplay does NOT show trigger reason for user checkpoints', t => {
	const checkpoints = [
		createMockCheckpoint('user-cp', {
			metadata: {
				name: 'user-cp',
				timestamp: new Date().toISOString(),
				messageCount: 5,
				filesChanged: ['a.ts'],
				provider: {name: 'OpenAI', model: 'gpt-4'},
				description: 'Manual checkpoint',
			},
		}),
	];
	const {lastFrame} = renderWithTheme(
		<CheckpointListDisplay checkpoints={checkpoints} />,
	);

	const output = lastFrame() || '';
	t.true(output.includes('user-cp'));
	t.notRegex(output, /↳ trigger/);
});
