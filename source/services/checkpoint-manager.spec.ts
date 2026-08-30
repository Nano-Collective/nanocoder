import {existsSync} from 'fs';
import * as path from 'path';
import type {Message} from '@/types/core';
import test from 'ava';
import * as fs from 'fs/promises';
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
