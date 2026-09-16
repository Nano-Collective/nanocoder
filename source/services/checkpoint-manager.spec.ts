import {existsSync} from 'fs';
import * as path from 'path';
import type {Message} from '@/types/core';
import test from 'ava';
import * as fs from 'fs/promises';
import {describeCheckpointGaps} from '@/utils/checkpoint-utils';
import {CheckpointManager} from './checkpoint-manager';

// Helper to create a temporary directory for tests
async function createTempDir(): Promise<string> {
	const tempDir = path.join(
		process.cwd(),
		'.test-temp',
		`checkpoint-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	await fs.mkdir(tempDir, {recursive: true});
	return tempDir;
}

// Helper to clean up temp directory
async function cleanupTempDir(dir: string): Promise<void> {
	try {
		await fs.rm(dir, {recursive: true, force: true});
	} catch {
		// Ignore cleanup errors
	}
}

// Helper to create mock messages
function createMockMessages(count: number): Message[] {
	const messages: Message[] = [];
	for (let i = 0; i < count; i++) {
		messages.push({
			role: i % 2 === 0 ? 'user' : 'assistant',
			content: `Message ${i + 1}`,
		});
	}
	return messages;
}

test.serial(
	'CheckpointManager creates checkpoints directory on save',
	async t => {
		const tempDir = await createTempDir();
		try {
			const manager = new CheckpointManager(tempDir);
			const messages = createMockMessages(2);

			await manager.saveCheckpoint(
				'test-checkpoint',
				messages,
				'TestProvider',
				'test-model',
			);

			const checkpointsDir = path.join(tempDir, '.nanocoder', 'checkpoints');
			t.true(existsSync(checkpointsDir));
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial(
	'CheckpointManager saves checkpoint with provided name',
	async t => {
		const tempDir = await createTempDir();
		try {
			const manager = new CheckpointManager(tempDir);
			const messages = createMockMessages(2);

			const metadata = await manager.saveCheckpoint(
				'my-checkpoint',
				messages,
				'TestProvider',
				'test-model',
			);

			t.is(metadata.name, 'my-checkpoint');
			t.true(manager.checkpointExists('my-checkpoint'));
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial(
	'CheckpointManager generates timestamp-based name when not provided',
	async t => {
		const tempDir = await createTempDir();
		try {
			const manager = new CheckpointManager(tempDir);
			const messages = createMockMessages(2);

			const metadata = await manager.saveCheckpoint(
				undefined,
				messages,
				'TestProvider',
				'test-model',
			);

			t.true(metadata.name.startsWith('checkpoint-'));
			t.true(manager.checkpointExists(metadata.name));
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial('CheckpointManager saves correct metadata', async t => {
	const tempDir = await createTempDir();
	try {
		const manager = new CheckpointManager(tempDir);
		const messages = createMockMessages(4);

		const metadata = await manager.saveCheckpoint(
			'test',
			messages,
			'MyProvider',
			'my-model',
		);

		t.is(metadata.messageCount, 4);
		t.is(metadata.provider.name, 'MyProvider');
		t.is(metadata.provider.model, 'my-model');
		t.truthy(metadata.timestamp);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial(
	'CheckpointManager throws error for duplicate checkpoint name',
	async t => {
		const tempDir = await createTempDir();
		try {
			const manager = new CheckpointManager(tempDir);
			const messages = createMockMessages(2);

			await manager.saveCheckpoint('duplicate', messages, 'Provider', 'model');

			await t.throwsAsync(
				async () => {
					await manager.saveCheckpoint(
						'duplicate',
						messages,
						'Provider',
						'model',
					);
				},
				{message: /already exists/},
			);
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial(
	'CheckpointManager throws error for invalid checkpoint name',
	async t => {
		const tempDir = await createTempDir();
		try {
			const manager = new CheckpointManager(tempDir);
			const messages = createMockMessages(2);

			await t.throwsAsync(
				async () => {
					await manager.saveCheckpoint(
						'invalid/name',
						messages,
						'Provider',
						'model',
					);
				},
				{message: /invalid characters/},
			);
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial('CheckpointManager loads saved checkpoint', async t => {
	const tempDir = await createTempDir();
	try {
		const manager = new CheckpointManager(tempDir);
		const messages = createMockMessages(3);

		await manager.saveCheckpoint('loadable', messages, 'Provider', 'model');
		const loaded = await manager.loadCheckpoint('loadable');

		t.is(loaded.metadata.name, 'loadable');
		t.is(loaded.conversation.messages.length, 3);
		t.is(loaded.conversation.messages[0].content, 'Message 1');
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial(
	'CheckpointManager throws error loading non-existent checkpoint',
	async t => {
		const tempDir = await createTempDir();
		try {
			const manager = new CheckpointManager(tempDir);

			await t.throwsAsync(
				async () => {
					await manager.loadCheckpoint('non-existent');
				},
				{message: /does not exist/},
			);
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial('CheckpointManager lists checkpoints', async t => {
	const tempDir = await createTempDir();
	try {
		const manager = new CheckpointManager(tempDir);
		const messages = createMockMessages(2);

		await manager.saveCheckpoint('checkpoint-1', messages, 'Provider', 'model');
		await manager.saveCheckpoint('checkpoint-2', messages, 'Provider', 'model');
		await manager.saveCheckpoint('checkpoint-3', messages, 'Provider', 'model');

		const list = await manager.listCheckpoints();

		t.is(list.length, 3);
		const names = list.map(c => c.name);
		t.true(names.includes('checkpoint-1'));
		t.true(names.includes('checkpoint-2'));
		t.true(names.includes('checkpoint-3'));
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial(
	'CheckpointManager lists checkpoints sorted by timestamp (newest first)',
	async t => {
		const tempDir = await createTempDir();
		try {
			const manager = new CheckpointManager(tempDir);
			const messages = createMockMessages(2);

			await manager.saveCheckpoint('oldest', messages, 'Provider', 'model');
			await new Promise(resolve => setTimeout(resolve, 10)); // Small delay
			await manager.saveCheckpoint('middle', messages, 'Provider', 'model');
			await new Promise(resolve => setTimeout(resolve, 10));
			await manager.saveCheckpoint('newest', messages, 'Provider', 'model');

			const list = await manager.listCheckpoints();

			t.is(list[0].name, 'newest');
			t.is(list[2].name, 'oldest');
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial(
	'CheckpointManager returns empty list when no checkpoints',
	async t => {
		const tempDir = await createTempDir();
		try {
			const manager = new CheckpointManager(tempDir);
			const list = await manager.listCheckpoints();

			t.is(list.length, 0);
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial('CheckpointManager deletes checkpoint', async t => {
	const tempDir = await createTempDir();
	try {
		const manager = new CheckpointManager(tempDir);
		const messages = createMockMessages(2);

		await manager.saveCheckpoint('to-delete', messages, 'Provider', 'model');
		t.true(manager.checkpointExists('to-delete'));

		await manager.deleteCheckpoint('to-delete');
		t.false(manager.checkpointExists('to-delete'));
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial(
	'CheckpointManager throws error deleting non-existent checkpoint',
	async t => {
		const tempDir = await createTempDir();
		try {
			const manager = new CheckpointManager(tempDir);

			await t.throwsAsync(
				async () => {
					await manager.deleteCheckpoint('non-existent');
				},
				{message: /does not exist/},
			);
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial(
	'CheckpointManager rejects path traversal in delete',
	async t => {
		const tempDir = await createTempDir();
		// A file outside the checkpoints dir that a traversal name would target.
		const outside = path.join(tempDir, 'outside');
		await fs.mkdir(outside, {recursive: true});
		try {
			const manager = new CheckpointManager(tempDir);

			await t.throwsAsync(
				async () => {
					await manager.deleteCheckpoint('../../outside');
				},
				{message: /Invalid checkpoint name|invalid characters/},
			);

			// The escape target must still be there.
			t.true(existsSync(outside));
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial('CheckpointManager rejects path traversal in load', async t => {
	const tempDir = await createTempDir();
	try {
		const manager = new CheckpointManager(tempDir);

		await t.throwsAsync(
			async () => {
				await manager.loadCheckpoint('../../../etc');
			},
			{message: /Invalid checkpoint name|invalid characters/},
		);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('CheckpointManager validates checkpoint integrity', async t => {
	const tempDir = await createTempDir();
	try {
		const manager = new CheckpointManager(tempDir);
		const messages = createMockMessages(2);

		await manager.saveCheckpoint('valid', messages, 'Provider', 'model');
		const validation = await manager.validateCheckpoint('valid');

		t.true(validation.valid);
		t.is(validation.errors.length, 0);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial(
	'CheckpointManager detects invalid checkpoint (missing metadata)',
	async t => {
		const tempDir = await createTempDir();
		try {
			const manager = new CheckpointManager(tempDir);

			// Create a checkpoint directory without metadata
			const checkpointDir = path.join(
				tempDir,
				'.nanocoder',
				'checkpoints',
				'broken',
			);
			await fs.mkdir(checkpointDir, {recursive: true});

			const validation = await manager.validateCheckpoint('broken');

			t.false(validation.valid);
			t.true(validation.errors.some(e => e.includes('metadata')));
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial(
	'CheckpointManager checkpointExists returns true for existing checkpoint',
	async t => {
		const tempDir = await createTempDir();
		try {
			const manager = new CheckpointManager(tempDir);
			const messages = createMockMessages(2);

			await manager.saveCheckpoint('exists', messages, 'Provider', 'model');

			t.true(manager.checkpointExists('exists'));
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial(
	'CheckpointManager checkpointExists returns false for non-existing checkpoint',
	async t => {
		const tempDir = await createTempDir();
		try {
			const manager = new CheckpointManager(tempDir);

			t.false(manager.checkpointExists('does-not-exist'));
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial(
	'CheckpointManager getCheckpointMetadata returns metadata',
	async t => {
		const tempDir = await createTempDir();
		try {
			const manager = new CheckpointManager(tempDir);
			const messages = createMockMessages(5);

			await manager.saveCheckpoint(
				'meta-test',
				messages,
				'MetaProvider',
				'meta-model',
			);
			const metadata = await manager.getCheckpointMetadata('meta-test');

			t.is(metadata.name, 'meta-test');
			t.is(metadata.messageCount, 5);
			t.is(metadata.provider.name, 'MetaProvider');
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial(
	'CheckpointManager getCheckpointMetadata throws error for non-existent checkpoint',
	async t => {
		const tempDir = await createTempDir();
		try {
			const manager = new CheckpointManager(tempDir);

			await t.throwsAsync(
				async () => {
					await manager.getCheckpointMetadata('does-not-exist');
				},
				{message: /does not exist/},
			);
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial(
	'CheckpointManager generates description from first user message',
	async t => {
		const tempDir = await createTempDir();
		try {
			const manager = new CheckpointManager(tempDir);
			const messages: Message[] = [
				{role: 'user', content: 'This is my first message'},
				{role: 'assistant', content: 'Hello!'},
			];

			const metadata = await manager.saveCheckpoint(
				'desc-test',
				messages,
				'Provider',
				'model',
			);

			t.is(metadata.description, 'This is my first message');
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial('CheckpointManager truncates long descriptions', async t => {
	const tempDir = await createTempDir();
	try {
		const manager = new CheckpointManager(tempDir);
		const longMessage = 'A'.repeat(150);
		const messages: Message[] = [{role: 'user', content: longMessage}];

		const metadata = await manager.saveCheckpoint(
			'long-desc',
			messages,
			'Provider',
			'model',
		);

		t.true(metadata.description!.length <= 103); // 100 chars + "..."
		t.true(metadata.description!.endsWith('...'));
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial(
	'CheckpointManager handles empty messages for description',
	async t => {
		const tempDir = await createTempDir();
		try {
			const manager = new CheckpointManager(tempDir);
			const messages: Message[] = [
				{role: 'assistant', content: 'No user messages'},
			];

			const metadata = await manager.saveCheckpoint(
				'no-user',
				messages,
				'Provider',
				'model',
			);

			t.is(metadata.description, 'Empty conversation');
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial(
	'CheckpointManager loadCheckpoint with validateIntegrity option',
	async t => {
		const tempDir = await createTempDir();
		try {
			const manager = new CheckpointManager(tempDir);
			const messages = createMockMessages(2);

			await manager.saveCheckpoint(
				'validate-test',
				messages,
				'Provider',
				'model',
			);
			const loaded = await manager.loadCheckpoint('validate-test', {
				validateIntegrity: true,
			});

			t.truthy(loaded);
			t.is(loaded.metadata.name, 'validate-test');
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial('CheckpointManager list includes size information', async t => {
	const tempDir = await createTempDir();
	try {
		const manager = new CheckpointManager(tempDir);
		const messages = createMockMessages(2);

		await manager.saveCheckpoint('size-test', messages, 'Provider', 'model');
		const list = await manager.listCheckpoints();

		t.truthy(list[0].sizeBytes);
		t.true(list[0].sizeBytes! > 0);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

// The copy written under files/ is where the bytes were previously destroyed:
// once it is corrupt at rest, the original cannot be recovered from the
// checkpoint at all, whatever restore later does. This pins that copy as well
// as the read back out of it.
const BINARY_FIXTURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
	0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR length + type
	0xff, 0xfe, 0xc0, 0x80, // lone/overlong bytes: never valid UTF-8
]);

test.serial(
	'CheckpointManager round-trips a binary file byte-for-byte',
	async t => {
		const tempDir = await createTempDir();
		try {
			const relativePath = 'assets/logo.png';
			const target = path.join(tempDir, relativePath);
			await fs.mkdir(path.dirname(target), {recursive: true});
			await fs.writeFile(target, BINARY_FIXTURE);

			const manager = new CheckpointManager(tempDir);
			await manager.saveCheckpoint(
				'binary-checkpoint',
				createMockMessages(2),
				'TestProvider',
				'test-model',
				[relativePath],
			);

			const stored = path.join(
				tempDir,
				'.nanocoder',
				'checkpoints',
				'binary-checkpoint',
				'files',
				relativePath,
			);
			t.deepEqual(await fs.readFile(stored), BINARY_FIXTURE);

			await fs.writeFile(target, Buffer.from('clobbered'));

			const checkpointData = await manager.loadCheckpoint(
				'binary-checkpoint',
			);
			t.deepEqual(
				checkpointData.fileSnapshots.get(relativePath),
				BINARY_FIXTURE,
			);

			await manager.restoreFiles(checkpointData);
			t.deepEqual(await fs.readFile(target), BINARY_FIXTURE);
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

// restoreFiles owns the gap report so a restore path cannot forget to ask for
// it. There are three callers today; the fourth gets it for free.
test.serial('CheckpointManager restoreFiles returns the gaps it found', async t => {
	const tempDir = await createTempDir();
	try {
		await fs.writeFile(path.join(tempDir, 'kept.txt'), 'kept');
		await fs.mkdir(path.join(tempDir, 'unreadable.txt'), {recursive: true});

		const manager = new CheckpointManager(tempDir);
		await manager.saveCheckpoint(
			'gappy',
			createMockMessages(2),
			'TestProvider',
			'test-model',
			['kept.txt', 'unreadable.txt'],
		);

		const loaded = await manager.loadCheckpoint('gappy');
		const gaps = await manager.restoreFiles(loaded);

		t.is(gaps.length, 1);
		t.regex(gaps[0]!, /unreadable\.txt/);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

// A checkpoint whose every file was skipped has no snapshots to write back, but
// it is exactly the case that most needs reporting.
test.serial(
	'CheckpointManager restoreFiles reports gaps with nothing to write back',
	async t => {
		const tempDir = await createTempDir();
		try {
			const manager = new CheckpointManager(tempDir);
			await manager.saveCheckpoint(
				'empty',
				createMockMessages(2),
				'TestProvider',
				'test-model',
				[],
			);

			const loaded = await manager.loadCheckpoint('empty');
			loaded.metadata.truncatedFileCount = 4;

			const gaps = await manager.restoreFiles(loaded);

			t.is(gaps.length, 1);
			t.regex(gaps[0]!, /4 further modified file/);
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

// An incomplete capture has to outlive the process that made it: the warning at
// save time is gone by the time anyone restores, so the gap goes in metadata.
// Deleting a file and then checkpointing is routine, especially with the
// daemon's automatic pre-trigger checkpoint. It must not leave a warning behind
// on every later restore.
test.serial(
	'CheckpointManager does not record a deleted file as a gap',
	async t => {
		const tempDir = await createTempDir();
		try {
			await fs.writeFile(path.join(tempDir, 'kept.txt'), 'kept');

			const manager = new CheckpointManager(tempDir);
			const metadata = await manager.saveCheckpoint(
				'with-deletion',
				createMockMessages(2),
				'TestProvider',
				'test-model',
				['kept.txt', 'deleted.txt'],
			);

			t.deepEqual(metadata.filesChanged, ['kept.txt']);
			t.is(metadata.skippedFiles, undefined);

			const restored = await manager.loadCheckpoint('with-deletion');
			t.deepEqual(await manager.restoreFiles(restored), []);
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial(
	'CheckpointManager records files it could not capture',
	async t => {
		const tempDir = await createTempDir();
		try {
			const kept = path.join(tempDir, 'kept.txt');
			await fs.writeFile(kept, 'kept');
			// A real read failure, not a missing file: a directory where a file is
			// expected gives EISDIR everywhere, and Windows cannot chmod away read.
			await fs.mkdir(path.join(tempDir, 'locked.txt'), {recursive: true});

			const manager = new CheckpointManager(tempDir);
			const metadata = await manager.saveCheckpoint(
				'partial',
				createMockMessages(2),
				'TestProvider',
				'test-model',
				['kept.txt', 'locked.txt'],
			);

			t.deepEqual(metadata.filesChanged, ['kept.txt']);
			t.is(metadata.skippedFiles?.length, 1);
			t.is(metadata.skippedFiles?.[0]?.path, 'locked.txt');

			// It has to survive the round-trip to disk, not just the return value.
			const reloaded = await manager.getCheckpointMetadata('partial');
			t.is(reloaded.skippedFiles?.[0]?.path, 'locked.txt');
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial(
	'CheckpointManager leaves the gap fields off a complete checkpoint',
	async t => {
		const tempDir = await createTempDir();
		try {
			await fs.writeFile(path.join(tempDir, 'kept.txt'), 'kept');

			const manager = new CheckpointManager(tempDir);
			const metadata = await manager.saveCheckpoint(
				'complete',
				createMockMessages(2),
				'TestProvider',
				'test-model',
				['kept.txt'],
			);

			t.is(metadata.skippedFiles, undefined);
			t.is(metadata.truncatedFileCount, undefined);
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

// The third way a restore comes up short: the file was captured fine, but the
// stored copy is gone by the time anyone loads it. loadCheckpoint logs and
// carries on, so the shortfall is only visible against metadata.filesChanged.
test.serial(
	'CheckpointManager load reports snapshots it could not read back',
	async t => {
		const tempDir = await createTempDir();
		try {
			await fs.writeFile(path.join(tempDir, 'kept.txt'), 'kept');
			await fs.writeFile(path.join(tempDir, 'lost.txt'), 'lost');

			const manager = new CheckpointManager(tempDir);
			await manager.saveCheckpoint(
				'lossy',
				createMockMessages(2),
				'TestProvider',
				'test-model',
				['kept.txt', 'lost.txt'],
			);

			// Something removed the stored copy after the fact.
			await fs.rm(
				path.join(tempDir, '.nanocoder', 'checkpoints', 'lossy', 'files', 'lost.txt'),
			);

			const checkpointData = await manager.loadCheckpoint('lossy');

			t.deepEqual(checkpointData.metadata.filesChanged, [
				'kept.txt',
				'lost.txt',
			]);
			t.is(checkpointData.fileSnapshots.size, 1);

			const gaps = describeCheckpointGaps(checkpointData);
			t.is(gaps.length, 1);
			t.regex(gaps[0]!, /lost\.txt/);
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);
