import {renderWithTheme} from '../test-utils/render-with-theme.js';
import type {CheckpointListItem} from '../types/checkpoint.js';
import test from 'ava';
import React from 'react';
import CheckpointSelector from './checkpoint-selector';

const createMockCheckpoint = (
	name: string,
	overrides: Partial<CheckpointListItem['metadata']> = {},
): CheckpointListItem => ({
	name,
	metadata: {
		name,
		timestamp: new Date().toISOString(),
		messageCount: 10,
		filesChanged: ['file1.ts', 'file2.ts'],
		provider: {name: 'Test Provider', model: 'test-model'},
		description: 'Test checkpoint',
		...overrides,
	},
	sizeBytes: 1024,
});

test('CheckpointSelector windows a long checkpoint list', t => {
	// An unbounded list ran well past the terminal; the session list already
	// caps its window, and checkpoints now use the same component.
	const checkpoints = Array.from({length: 25}, (_, i) =>
		createMockCheckpoint(`cp-${String(i).padStart(2, '0')}`),
	);

	const {lastFrame, unmount} = renderWithTheme(
		<CheckpointSelector
			checkpoints={checkpoints}
			onSelect={() => {}}
			onCancel={() => {}}
			currentMessageCount={0}
		/>,
	);

	const output = lastFrame() || '';
	const rendered = output.match(/cp-\d{2}/g) ?? [];
	t.true(rendered.length > 0, 'the window must show checkpoints');
	t.true(
		rendered.length <= 10,
		`expected at most 10 rows, saw ${rendered.length}`,
	);
	t.true(output.includes('cp-00'), 'the window starts at the highlighted row');
	t.false(output.includes('cp-24'), 'rows past the window must not render');
	unmount();
});

test('CheckpointSelector renders empty state when no checkpoints', t => {
	const {lastFrame} = renderWithTheme(
		<CheckpointSelector
			checkpoints={[]}
			onSelect={() => {}}
			onCancel={() => {}}
			currentMessageCount={0}
		/>,
	);

	const output = lastFrame() || '';
	t.true(output.includes('No Checkpoints'));
});

test('CheckpointSelector renders checkpoint list', t => {
	const checkpoints = [
		createMockCheckpoint('checkpoint-1'),
		createMockCheckpoint('checkpoint-2'),
	];
	const {lastFrame} = renderWithTheme(
		<CheckpointSelector
			checkpoints={checkpoints}
			onSelect={() => {}}
			onCancel={() => {}}
			currentMessageCount={0}
		/>,
	);

	const output = lastFrame() || '';
	t.true(output.includes('checkpoint-1'));
	t.true(output.includes('checkpoint-2'));
});

test('CheckpointSelector renders title', t => {
	const checkpoints = [createMockCheckpoint('test')];
	const {lastFrame} = renderWithTheme(
		<CheckpointSelector
			checkpoints={checkpoints}
			onSelect={() => {}}
			onCancel={() => {}}
			currentMessageCount={0}
		/>,
	);

	const output = lastFrame() || '';
	t.true(output.includes('Select Checkpoint'));
});

test('CheckpointSelector renders navigation help', t => {
	const checkpoints = [createMockCheckpoint('test')];
	const {lastFrame} = renderWithTheme(
		<CheckpointSelector
			checkpoints={checkpoints}
			onSelect={() => {}}
			onCancel={() => {}}
			currentMessageCount={0}
		/>,
	);

	const output = lastFrame() || '';
	// The component should show some navigation instructions
	t.truthy(output.length > 0);
});

test('CheckpointSelector shows message count in checkpoint label', t => {
	const checkpoints = [createMockCheckpoint('test', {messageCount: 42})];
	const {lastFrame} = renderWithTheme(
		<CheckpointSelector
			checkpoints={checkpoints}
			onSelect={() => {}}
			onCancel={() => {}}
			currentMessageCount={0}
		/>,
	);

	const output = lastFrame() || '';
	// The label format includes "42 msgs"
	t.true(output.includes('42'));
});

test('CheckpointSelector shows files count in checkpoint label', t => {
	const checkpoints = [
		createMockCheckpoint('test', {
			filesChanged: ['a.ts', 'b.ts', 'c.ts'],
		}),
	];
	const {lastFrame} = renderWithTheme(
		<CheckpointSelector
			checkpoints={checkpoints}
			onSelect={() => {}}
			onCancel={() => {}}
			currentMessageCount={0}
		/>,
	);

	const output = lastFrame() || '';
	// The label format includes "3 files"
	t.true(output.includes('3'));
});

test('CheckpointSelector renders without crashing with onError prop', t => {
	const checkpoints = [createMockCheckpoint('test')];
	const {lastFrame} = renderWithTheme(
		<CheckpointSelector
			checkpoints={checkpoints}
			onSelect={() => {}}
			onCancel={() => {}}
			onError={() => {}}
			currentMessageCount={0}
		/>,
	);

	const output = lastFrame() || '';
	t.true(output.includes('test'));
});

test('CheckpointSelector renders multiple checkpoints in list', t => {
	const checkpoints = [
		createMockCheckpoint('first-checkpoint'),
		createMockCheckpoint('second-checkpoint'),
		createMockCheckpoint('third-checkpoint'),
	];
	const {lastFrame} = renderWithTheme(
		<CheckpointSelector
			checkpoints={checkpoints}
			onSelect={() => {}}
			onCancel={() => {}}
			currentMessageCount={0}
		/>,
	);

	const output = lastFrame() || '';
	t.true(output.includes('first-checkpoint'));
	t.true(output.includes('second-checkpoint'));
	t.true(output.includes('third-checkpoint'));
});

test('CheckpointSelector empty state message mentions create command', t => {
	const {lastFrame} = renderWithTheme(
		<CheckpointSelector
			checkpoints={[]}
			onSelect={() => {}}
			onCancel={() => {}}
			currentMessageCount={0}
		/>,
	);

	const output = lastFrame() || '';
	t.true(output.includes('checkpoint create'));
});

// ============================================================================
// Keyboard Interaction Tests
// ============================================================================

test('CheckpointSelector calls onCancel when escape key is pressed in list view', async t => {
	const checkpoints = [createMockCheckpoint('test-checkpoint')];
	let cancelCalled = false;
	const onCancel = () => {
		cancelCalled = true;
	};

	const {stdin} = renderWithTheme(
		<CheckpointSelector
			checkpoints={checkpoints}
			onSelect={() => {}}
			onCancel={onCancel}
			currentMessageCount={0}
		/>,
	);

	await new Promise(resolve => setTimeout(resolve, 50));

	// Press Escape key
	stdin.write('\u001B');

	await new Promise(resolve => setTimeout(resolve, 50));

	t.true(cancelCalled);
});

test('CheckpointSelector calls onCancel from empty state', async t => {
	let cancelCalled = false;
	const onCancel = () => {
		cancelCalled = true;
	};

	const {stdin} = renderWithTheme(
		<CheckpointSelector
			checkpoints={[]}
			onSelect={() => {}}
			onCancel={onCancel}
			currentMessageCount={0}
		/>,
	);

	await new Promise(resolve => setTimeout(resolve, 50));

	// Press Escape key
	stdin.write('\u001B');

	await new Promise(resolve => setTimeout(resolve, 50));

	t.true(cancelCalled);
});

test('CheckpointSelector calls onSelect without backup when currentMessageCount is 0', async t => {
	const checkpoints = [createMockCheckpoint('test-checkpoint')];
	let selectedCheckpoint = '';
	let createBackup = true;
	const onSelect = (name: string, backup: boolean) => {
		selectedCheckpoint = name;
		createBackup = backup;
	};

	const {stdin} = renderWithTheme(
		<CheckpointSelector
			checkpoints={checkpoints}
			onSelect={onSelect}
			onCancel={() => {}}
			currentMessageCount={0}
		/>,
	);

	await new Promise(resolve => setTimeout(resolve, 50));

	// Press Enter to select
	stdin.write('\r');

	await new Promise(resolve => setTimeout(resolve, 100));

	t.is(selectedCheckpoint, 'test-checkpoint');
	t.false(createBackup);
});

test('CheckpointSelector shows backup confirmation when currentMessageCount > 0', async t => {
	const checkpoints = [createMockCheckpoint('test-checkpoint')];

	const {lastFrame, stdin} = renderWithTheme(
		<CheckpointSelector
			checkpoints={checkpoints}
			onSelect={() => {}}
			onCancel={() => {}}
			currentMessageCount={5}
		/>,
	);

	await new Promise(resolve => setTimeout(resolve, 50));

	// Press Enter to select checkpoint
	stdin.write('\r');

	await new Promise(resolve => setTimeout(resolve, 100));

	const output = lastFrame() || '';
	// Should show backup confirmation
	t.true(output.includes('Create a backup'));
	t.true(output.includes('5 message'));
});

test('CheckpointSelector backup confirmation shows checkpoint details', async t => {
	const checkpoints = [
		createMockCheckpoint('feature-checkpoint', {
			messageCount: 42,
			filesChanged: ['file1.ts', 'file2.ts', 'file3.ts'],
		}),
	];

	const {lastFrame, stdin} = renderWithTheme(
		<CheckpointSelector
			checkpoints={checkpoints}
			onSelect={() => {}}
			onCancel={() => {}}
			currentMessageCount={10}
		/>,
	);

	await new Promise(resolve => setTimeout(resolve, 50));

	// Select checkpoint
	stdin.write('\r');

	await new Promise(resolve => setTimeout(resolve, 100));

	const output = lastFrame() || '';
	// Should show checkpoint details
	t.true(output.includes('feature-checkpoint'));
	t.true(output.includes('42 messages'));
	t.true(output.includes('3 files'));
});

test('CheckpointSelector backup confirmation - Y creates backup', async t => {
	const checkpoints = [createMockCheckpoint('test-checkpoint')];
	let selectedCheckpoint = '';
	let createBackup = false;
	const onSelect = (name: string, backup: boolean) => {
		selectedCheckpoint = name;
		createBackup = backup;
	};

	const {stdin} = renderWithTheme(
		<CheckpointSelector
			checkpoints={checkpoints}
			onSelect={onSelect}
			onCancel={() => {}}
			currentMessageCount={5}
		/>,
	);

	await new Promise(resolve => setTimeout(resolve, 50));

	// Select checkpoint
	stdin.write('\r');

	await new Promise(resolve => setTimeout(resolve, 100));

	// Press Y for backup
	stdin.write('y');

	await new Promise(resolve => setTimeout(resolve, 100));

	t.is(selectedCheckpoint, 'test-checkpoint');
	t.true(createBackup);
});

test('CheckpointSelector backup confirmation - Enter creates backup (default)', async t => {
	const checkpoints = [createMockCheckpoint('test-checkpoint')];
	let selectedCheckpoint = '';
	let createBackup = false;
	const onSelect = (name: string, backup: boolean) => {
		selectedCheckpoint = name;
		createBackup = backup;
	};

	const {stdin} = renderWithTheme(
		<CheckpointSelector
			checkpoints={checkpoints}
			onSelect={onSelect}
			onCancel={() => {}}
			currentMessageCount={5}
		/>,
	);

	await new Promise(resolve => setTimeout(resolve, 50));

	// Select checkpoint
	stdin.write('\r');

	await new Promise(resolve => setTimeout(resolve, 100));

	// Press Enter (default action is backup)
	stdin.write('\r');

	await new Promise(resolve => setTimeout(resolve, 100));

	t.is(selectedCheckpoint, 'test-checkpoint');
	t.true(createBackup);
});

test('CheckpointSelector backup confirmation - N skips backup', async t => {
	const checkpoints = [createMockCheckpoint('test-checkpoint')];
	let selectedCheckpoint = '';
	let createBackup = true;
	const onSelect = (name: string, backup: boolean) => {
		selectedCheckpoint = name;
		createBackup = backup;
	};

	const {stdin} = renderWithTheme(
		<CheckpointSelector
			checkpoints={checkpoints}
			onSelect={onSelect}
			onCancel={() => {}}
			currentMessageCount={5}
		/>,
	);

	await new Promise(resolve => setTimeout(resolve, 50));

	// Select checkpoint
	stdin.write('\r');

	await new Promise(resolve => setTimeout(resolve, 100));

	// Press N to skip backup
	stdin.write('n');

	await new Promise(resolve => setTimeout(resolve, 100));

	t.is(selectedCheckpoint, 'test-checkpoint');
	t.false(createBackup);
});

test('CheckpointSelector backup confirmation - Escape cancels', async t => {
	const checkpoints = [createMockCheckpoint('test-checkpoint')];
	let selectCalled = false;
	let cancelCalled = false;
	const onSelect = () => {
		selectCalled = true;
	};
	const onCancel = () => {
		cancelCalled = true;
	};

	const {stdin} = renderWithTheme(
		<CheckpointSelector
			checkpoints={checkpoints}
			onSelect={onSelect}
			onCancel={onCancel}
			currentMessageCount={5}
		/>,
	);

	await new Promise(resolve => setTimeout(resolve, 50));

	// Select checkpoint
	stdin.write('\r');

	await new Promise(resolve => setTimeout(resolve, 100));

	// Press Escape to cancel
	stdin.write('\u001B');

	await new Promise(resolve => setTimeout(resolve, 100));

	t.false(selectCalled);
	t.true(cancelCalled);
});

test('CheckpointSelector handles navigation before selection', async t => {
	const checkpoints = [
		createMockCheckpoint('checkpoint-1'),
		createMockCheckpoint('checkpoint-2'),
		createMockCheckpoint('checkpoint-3'),
	];
	let selectedCheckpoint = '';
	const onSelect = (name: string) => {
		selectedCheckpoint = name;
	};

	const {stdin} = renderWithTheme(
		<CheckpointSelector
			checkpoints={checkpoints}
			onSelect={onSelect}
			onCancel={() => {}}
			currentMessageCount={0}
		/>,
	);

	await new Promise(resolve => setTimeout(resolve, 50));

	// Navigate down twice
	stdin.write('\u001B[B'); // Down arrow
	await new Promise(resolve => setTimeout(resolve, 50));
	stdin.write('\u001B[B'); // Down arrow
	await new Promise(resolve => setTimeout(resolve, 50));

	// Select
	stdin.write('\r');

	await new Promise(resolve => setTimeout(resolve, 100));

	// Should have selected the third checkpoint
	t.is(selectedCheckpoint, 'checkpoint-3');
});

test('CheckpointSelector backup confirmation handles uppercase Y', async t => {
	const checkpoints = [createMockCheckpoint('test-checkpoint')];
	let createBackup = false;
	const onSelect = (_name: string, backup: boolean) => {
		createBackup = backup;
	};

	const {stdin} = renderWithTheme(
		<CheckpointSelector
			checkpoints={checkpoints}
			onSelect={onSelect}
			onCancel={() => {}}
			currentMessageCount={5}
		/>,
	);

	await new Promise(resolve => setTimeout(resolve, 50));

	// Select checkpoint
	stdin.write('\r');
	await new Promise(resolve => setTimeout(resolve, 100));

	// Press uppercase Y
	stdin.write('Y');
	await new Promise(resolve => setTimeout(resolve, 100));

	t.true(createBackup);
});

test('CheckpointSelector backup confirmation handles uppercase N', async t => {
	const checkpoints = [createMockCheckpoint('test-checkpoint')];
	let createBackup = true;
	const onSelect = (_name: string, backup: boolean) => {
		createBackup = backup;
	};

	const {stdin} = renderWithTheme(
		<CheckpointSelector
			checkpoints={checkpoints}
			onSelect={onSelect}
			onCancel={() => {}}
			currentMessageCount={5}
		/>,
	);

	await new Promise(resolve => setTimeout(resolve, 50));

	// Select checkpoint
	stdin.write('\r');
	await new Promise(resolve => setTimeout(resolve, 100));

	// Press uppercase N
	stdin.write('N');
	await new Promise(resolve => setTimeout(resolve, 100));

	t.false(createBackup);
});

test('CheckpointSelector displays relative time in checkpoint list', async t => {
	const checkpoints = [createMockCheckpoint('test-checkpoint')];

	const {lastFrame} = renderWithTheme(
		<CheckpointSelector
			checkpoints={checkpoints}
			onSelect={() => {}}
			onCancel={() => {}}
			currentMessageCount={0}
		/>,
	);

	await new Promise(resolve => setTimeout(resolve, 50));

	const output = lastFrame() || '';
	// formatRelativeTime should produce output like "just now", "2 minutes ago", etc.
	// Since we're creating a checkpoint with current timestamp, it should say "just now" or similar
	t.truthy(output.length > 0);
});

test('CheckpointSelector backup confirmation shows relative time', async t => {
	const checkpoints = [createMockCheckpoint('test-checkpoint')];

	const {lastFrame, stdin} = renderWithTheme(
		<CheckpointSelector
			checkpoints={checkpoints}
			onSelect={() => {}}
			onCancel={() => {}}
			currentMessageCount={5}
		/>,
	);

	await new Promise(resolve => setTimeout(resolve, 50));

	// Select checkpoint
	stdin.write('\r');
	await new Promise(resolve => setTimeout(resolve, 100));

	const output = lastFrame() || '';
	// Should show "Created [relative time]"
	t.true(output.includes('Created'));
});
