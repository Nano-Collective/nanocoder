import {execFile} from 'child_process';
import {chmodSync, existsSync} from 'fs';
import * as path from 'path';
import {promisify} from 'util';
import test from 'ava';
import * as fs from 'fs/promises';
import {MAX_CHECKPOINT_FILES} from '@/constants';
import {FileSnapshotService} from './file-snapshot';

const execFileAsync = promisify(execFile);

// Helper to create a temporary directory for tests
async function createTempDir(): Promise<string> {
	const tempDir = path.join(
		process.cwd(),
		'.test-temp',
		`snapshot-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

// Helper to create a test file
async function createTestFile(
	dir: string,
	relativePath: string,
	content: string,
): Promise<string> {
	const fullPath = path.join(dir, relativePath);
	await fs.mkdir(path.dirname(fullPath), {recursive: true});
	await fs.writeFile(fullPath, content, 'utf-8');
	return fullPath;
}

test.serial('FileSnapshotService captures single file', async t => {
	const tempDir = await createTempDir();
	try {
		await createTestFile(tempDir, 'test.txt', 'Hello, World!');

		const service = new FileSnapshotService(tempDir);
		const {snapshots} = await service.captureFiles(['test.txt']);

		t.is(snapshots.size, 1);
		t.is(snapshots.get('test.txt')?.toString('utf-8'), 'Hello, World!');
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('FileSnapshotService captures multiple files', async t => {
	const tempDir = await createTempDir();
	try {
		await createTestFile(tempDir, 'file1.txt', 'Content 1');
		await createTestFile(tempDir, 'file2.txt', 'Content 2');
		await createTestFile(tempDir, 'file3.txt', 'Content 3');

		const service = new FileSnapshotService(tempDir);
		const {snapshots} = await service.captureFiles([
			'file1.txt',
			'file2.txt',
			'file3.txt',
		]);

		t.is(snapshots.size, 3);
		t.is(snapshots.get('file1.txt')?.toString('utf-8'), 'Content 1');
		t.is(snapshots.get('file2.txt')?.toString('utf-8'), 'Content 2');
		t.is(snapshots.get('file3.txt')?.toString('utf-8'), 'Content 3');
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('FileSnapshotService captures files in subdirectories', async t => {
	const tempDir = await createTempDir();
	try {
		await createTestFile(tempDir, 'src/index.ts', 'export {};');
		await createTestFile(
			tempDir,
			'src/utils/helper.ts',
			'export function help() {}',
		);

		const service = new FileSnapshotService(tempDir);
		const {snapshots} = await service.captureFiles([
			'src/index.ts',
			'src/utils/helper.ts',
		]);

		t.is(snapshots.size, 2);
		t.is(snapshots.get('src/index.ts')?.toString('utf-8'), 'export {};');
		t.is(
			snapshots.get('src/utils/helper.ts')?.toString('utf-8'),
			'export function help() {}',
		);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial(
	'FileSnapshotService handles non-existent files gracefully',
	async t => {
		const tempDir = await createTempDir();
		try {
			await createTestFile(tempDir, 'exists.txt', 'I exist');

			const service = new FileSnapshotService(tempDir);
			const {snapshots} = await service.captureFiles([
				'exists.txt',
				'does-not-exist.txt',
			]);

			// Should only capture the existing file
			t.is(snapshots.size, 1);
			t.is(snapshots.get('exists.txt')?.toString('utf-8'), 'I exist');
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial('FileSnapshotService restores files', async t => {
	const tempDir = await createTempDir();
	try {
		const service = new FileSnapshotService(tempDir);
		const snapshots = new Map<string, Buffer>();
		snapshots.set('restored.txt', Buffer.from('Restored content'));

		await service.restoreFiles(snapshots);

		const restoredPath = path.join(tempDir, 'restored.txt');
		t.true(existsSync(restoredPath));
		const content = await fs.readFile(restoredPath, 'utf-8');
		t.is(content, 'Restored content');
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('FileSnapshotService restores files in subdirectories', async t => {
	const tempDir = await createTempDir();
	try {
		const service = new FileSnapshotService(tempDir);
		const snapshots = new Map<string, Buffer>();
		snapshots.set('deep/nested/file.txt', Buffer.from('Nested content'));

		await service.restoreFiles(snapshots);

		const restoredPath = path.join(tempDir, 'deep/nested/file.txt');
		t.true(existsSync(restoredPath));
		const content = await fs.readFile(restoredPath, 'utf-8');
		t.is(content, 'Nested content');
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('FileSnapshotService restores multiple files', async t => {
	const tempDir = await createTempDir();
	try {
		const service = new FileSnapshotService(tempDir);
		const snapshots = new Map<string, Buffer>();
		snapshots.set('file1.txt', Buffer.from('Content 1'));
		snapshots.set('file2.txt', Buffer.from('Content 2'));
		snapshots.set('subdir/file3.txt', Buffer.from('Content 3'));

		await service.restoreFiles(snapshots);

		t.true(existsSync(path.join(tempDir, 'file1.txt')));
		t.true(existsSync(path.join(tempDir, 'file2.txt')));
		t.true(existsSync(path.join(tempDir, 'subdir/file3.txt')));
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial(
	'FileSnapshotService overwrites existing files on restore',
	async t => {
		const tempDir = await createTempDir();
		try {
			await createTestFile(tempDir, 'existing.txt', 'Old content');

			const service = new FileSnapshotService(tempDir);
			const snapshots = new Map<string, Buffer>();
			snapshots.set('existing.txt', Buffer.from('New content'));

			await service.restoreFiles(snapshots);

			const content = await fs.readFile(
				path.join(tempDir, 'existing.txt'),
				'utf-8',
			);
			t.is(content, 'New content');
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial(
	'FileSnapshotService getSnapshotSize calculates correct size',
	async t => {
		const service = new FileSnapshotService(process.cwd());
		const snapshots = new Map<string, Buffer>();
		snapshots.set('file1.txt', Buffer.from('Hello')); // 5 bytes
		snapshots.set('file2.txt', Buffer.from('World!')); // 6 bytes

		const size = service.getSnapshotSize(snapshots);

		t.is(size, 11);
	},
);

test.serial(
	'FileSnapshotService getSnapshotSize handles empty snapshots',
	async t => {
		const service = new FileSnapshotService(process.cwd());
		const snapshots = new Map<string, Buffer>();

		const size = service.getSnapshotSize(snapshots);

		t.is(size, 0);
	},
);

test.serial(
	'FileSnapshotService getSnapshotSize handles unicode content',
	async t => {
		const service = new FileSnapshotService(process.cwd());
		const snapshots = new Map<string, Buffer>();
		snapshots.set('unicode.txt', Buffer.from('日本語')); // 9 bytes in UTF-8

		const size = service.getSnapshotSize(snapshots);

		t.is(size, 9);
	},
);

test.serial(
	'FileSnapshotService validateRestorePath validates writable paths',
	async t => {
		const tempDir = await createTempDir();
		try {
			const service = new FileSnapshotService(tempDir);
			const snapshots = new Map<string, Buffer>();
			snapshots.set('new-file.txt', Buffer.from('Content'));

			const result = await service.validateRestorePath(snapshots);

			t.true(result.valid);
			t.is(result.errors.length, 0);
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial(
	'FileSnapshotService validateRestorePath validates existing writable files',
	async t => {
		const tempDir = await createTempDir();
		try {
			await createTestFile(tempDir, 'writable.txt', 'Original');

			const service = new FileSnapshotService(tempDir);
			const snapshots = new Map<string, Buffer>();
			snapshots.set('writable.txt', Buffer.from('New content'));

			const result = await service.validateRestorePath(snapshots);

			t.true(result.valid);
			t.is(result.errors.length, 0);
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial(
	'FileSnapshotService validateRestorePath creates missing directories',
	async t => {
		const tempDir = await createTempDir();
		try {
			const service = new FileSnapshotService(tempDir);
			const snapshots = new Map<string, Buffer>();
			// Directory doesn't exist yet - should be created during validation
			snapshots.set('nested/deep/path/file.txt', Buffer.from('Content'));

			const result = await service.validateRestorePath(snapshots);

			t.true(result.valid);
			t.is(result.errors.length, 0);
			// Directory should now exist (created during validation)
			const dirPath = path.join(tempDir, 'nested/deep/path');
			t.true(existsSync(dirPath));
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial(
	'FileSnapshotService validateRestorePath handles non-writable directories',
	async t => {
		const tempDir = await createTempDir();
		try {
			// Create a read-only directory
			const readOnlyDir = path.join(tempDir, 'readonly-dir');
			await fs.mkdir(readOnlyDir, {recursive: true});
			chmodSync(readOnlyDir, 0o444); // Read-only

			const service = new FileSnapshotService(tempDir);
			const snapshots = new Map<string, Buffer>();
			snapshots.set('readonly-dir/file.txt', Buffer.from('Content'));

			const result = await service.validateRestorePath(snapshots);

			t.false(result.valid);
			t.true(result.errors.length > 0);
			t.true(
				result.errors.some(error =>
					error.includes('Cannot create directory') ||
						error.includes('Cannot write to file') ||
						error.includes('is not writable'),
				),
			);
		} finally {
			// Restore permissions for cleanup
			try {
				chmodSync(path.join(tempDir, 'readonly-dir'), 0o755);
			} catch {
				// Ignore cleanup errors
			}
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial(
	'FileSnapshotService validateRestorePath handles non-writable existing files',
	async t => {
		const tempDir = await createTempDir();
		try {
			// Create a read-only file
			const readOnlyFile = path.join(tempDir, 'readonly.txt');
			await fs.writeFile(readOnlyFile, 'Original', 'utf-8');
			chmodSync(readOnlyFile, 0o444); // Read-only

			const service = new FileSnapshotService(tempDir);
			const snapshots = new Map<string, Buffer>();
			snapshots.set('readonly.txt', Buffer.from('New content'));

			const result = await service.validateRestorePath(snapshots);

			t.false(result.valid);
			t.true(result.errors.length > 0);
			t.true(
				result.errors.some(error =>
					error.includes('Cannot write to file'),
				),
			);
		} finally {
			// Restore permissions for cleanup
			try {
				chmodSync(path.join(tempDir, 'readonly.txt'), 0o644);
			} catch {
				// Ignore cleanup errors
			}
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial(
	'FileSnapshotService validateRestorePath skips file checks when directory creation fails',
	async t => {
		const tempDir = await createTempDir();
		try {
			// Create a read-only parent directory
			const parentDir = path.join(tempDir, 'parent');
			await fs.mkdir(parentDir, {recursive: true});
			chmodSync(parentDir, 0o444); // Read-only

			const service = new FileSnapshotService(tempDir);
			const snapshots = new Map<string, Buffer>();
			// Try to create a file in a subdirectory of the read-only parent
			snapshots.set('parent/child/file.txt', Buffer.from('Content'));

			const result = await service.validateRestorePath(snapshots);

			t.false(result.valid);
			t.true(result.errors.length > 0);
			// Should only have directory creation error, not file write error
			// because we skip file checks when directory creation fails
			const dirErrors = result.errors.filter(error =>
				error.includes('Cannot create directory'),
			);
			t.true(dirErrors.length > 0);
		} finally {
			// Restore permissions for cleanup
			try {
				chmodSync(path.join(tempDir, 'parent'), 0o755);
			} catch {
				// Ignore cleanup errors
			}
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial(
	'FileSnapshotService validateRestorePath handles multiple files with mixed scenarios',
	async t => {
		const tempDir = await createTempDir();
		try {
			// Create one writable file
			await createTestFile(tempDir, 'writable.txt', 'Original');
			// Create one read-only file
			const readOnlyFile = path.join(tempDir, 'readonly.txt');
			await fs.writeFile(readOnlyFile, 'Original', 'utf-8');
			chmodSync(readOnlyFile, 0o444);

			const service = new FileSnapshotService(tempDir);
			const snapshots = new Map<string, Buffer>();
			snapshots.set('writable.txt', Buffer.from('New content'));
			snapshots.set('readonly.txt', Buffer.from('New content'));
			snapshots.set('new-file.txt', Buffer.from('Content'));
			snapshots.set('nested/new-file.txt', Buffer.from('Content'));

			const result = await service.validateRestorePath(snapshots);

			t.false(result.valid);
			t.true(result.errors.length > 0);
			// Should have error for read-only file
			t.true(
				result.errors.some(error =>
					error.includes('Cannot write to file') &&
						error.includes('readonly.txt'),
				),
			);
		} finally {
			// Restore permissions for cleanup
			try {
				chmodSync(path.join(tempDir, 'readonly.txt'), 0o644);
			} catch {
				// Ignore cleanup errors
			}
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial(
	'FileSnapshotService validateRestorePath handles deeply nested paths',
	async t => {
		const tempDir = await createTempDir();
		try {
			const service = new FileSnapshotService(tempDir);
			const snapshots = new Map<string, Buffer>();
			snapshots.set(
				'level1/level2/level3/level4/file.txt',
				Buffer.from('Deeply nested content'),
			);

			const result = await service.validateRestorePath(snapshots);

			t.true(result.valid);
			t.is(result.errors.length, 0);
			// All nested directories should be created
			const nestedDir = path.join(
				tempDir,
				'level1/level2/level3/level4',
			);
			t.true(existsSync(nestedDir));
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial('FileSnapshotService refuses to restore outside the workspace', async t => {
	const tempDir = await createTempDir();
	try {
		const service = new FileSnapshotService(tempDir);
		// Snapshot keys come back from user-writable metadata on disk, so a
		// corrupted index must not be able to write anywhere it likes.
		await t.throwsAsync(
			service.restoreFiles(new Map([['../escaped.txt', 'owned']])),
			{message: /outside workspace/},
		);
		t.false(existsSync(path.join(path.dirname(tempDir), 'escaped.txt')));
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('FileSnapshotService reports whether a scan was truncated', async t => {
	const tempDir = await createTempDir();
	try {
		const service = new FileSnapshotService(tempDir);
		const result = service.getModifiedFilesResult();

		t.true(Array.isArray(result.files));
		t.is(typeof result.truncated, 'boolean');
		t.is(typeof result.truncatedCount, 'number');
		t.is(typeof result.available, 'boolean');
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('FileSnapshotService getModifiedFiles returns array', async t => {
	// Note: This test runs in a git directory, so it may return files.
	// The important thing is that it returns an array and doesn't throw.
	const tempDir = await createTempDir();
	try {
		const service = new FileSnapshotService(tempDir);
		const files = service.getModifiedFiles();

		t.true(Array.isArray(files));
		// Files should all be strings
		t.true(files.every(f => typeof f === 'string'));
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('FileSnapshotService captures empty files', async t => {
	const tempDir = await createTempDir();
	try {
		await createTestFile(tempDir, 'empty.txt', '');

		const service = new FileSnapshotService(tempDir);
		const {snapshots} = await service.captureFiles(['empty.txt']);

		t.is(snapshots.size, 1);
		t.is(snapshots.get('empty.txt')?.toString('utf-8'), '');
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial(
	'FileSnapshotService captures files with special characters in content',
	async t => {
		const tempDir = await createTempDir();
		try {
			const specialContent = 'Special chars: \n\t\r "quotes" & <tags> 日本語';
			await createTestFile(tempDir, 'special.txt', specialContent);

			const service = new FileSnapshotService(tempDir);
			const {snapshots} = await service.captureFiles(['special.txt']);

			t.is(snapshots.get('special.txt')?.toString('utf-8'), specialContent);
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial('FileSnapshotService uses relative paths in snapshots', async t => {
	const tempDir = await createTempDir();
	try {
		await createTestFile(tempDir, 'src/file.ts', 'content');

		const service = new FileSnapshotService(tempDir);
		const {snapshots} = await service.captureFiles(['src/file.ts']);

		// Should use relative path, not absolute
		const keys = Array.from(snapshots.keys());
		t.is(keys.length, 1);
		t.is(keys[0], 'src/file.ts');
		t.false(keys[0].startsWith('/'));
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('FileSnapshotService handles large files', async t => {
	const tempDir = await createTempDir();
	try {
		const largeContent = 'x'.repeat(100000); // 100KB
		await createTestFile(tempDir, 'large.txt', largeContent);

		const service = new FileSnapshotService(tempDir);
		const {snapshots} = await service.captureFiles(['large.txt']);

		t.is(snapshots.get('large.txt')?.length, 100000);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('FileSnapshotService defaults to current working directory', t => {
	const service = new FileSnapshotService();
	// Just verify it doesn't throw
	t.truthy(service);
});

test.serial('FileSnapshotService getModifiedFiles handles git not available', async t => {
	const tempDir = await createTempDir();
	try {
		// Create a directory that's not a git repo
		const nonGitDir = path.join(tempDir, 'non-git-repo');
		await fs.mkdir(nonGitDir, {recursive: true});

		const service = new FileSnapshotService(nonGitDir);
		const files = service.getModifiedFiles();

		// Should return empty array or array when git is not available
		// (may return files from parent git repo in some environments)
		t.true(Array.isArray(files));
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('FileSnapshotService validateRestorePath handles access errors', async t => {
	const tempDir = await createTempDir();
	try {
		const service = new FileSnapshotService(tempDir);
		const snapshots = new Map<string, Buffer>();

		// Create a file in temp dir to simulate a file that exists
		const testFile = path.join(tempDir, 'test.txt');
		await fs.writeFile(testFile, 'content');

		// Make the file read-only by removing write permissions
		await fs.chmod(testFile, 0o444);

		// Add the file to snapshots (relative path)
		snapshots.set('test.txt', Buffer.from('new content'));

		const result = await service.validateRestorePath(snapshots);

		// Should detect that the file is not writable
		t.false(result.valid);
		t.true(result.errors.length > 0);
		t.true(result.errors.some(e => e.includes('test.txt')));
	} finally {
		await cleanupTempDir(tempDir);
	}
});

// Snapshots cover whatever git reports as modified, and that includes images,
// .vsix bundles and every other binary a repository tracks. Reading or writing
// those as UTF-8 replaces each invalid byte with U+FFFD, so this pins the
// round-trip at the byte level rather than the string level.
const BINARY_FIXTURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
	0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR length + type
	0xff, 0xfe, 0xc0, 0x80, // lone/overlong bytes: never valid UTF-8
]);

test.serial(
	'FileSnapshotService captures and restores binary files byte-for-byte',
	async t => {
		const tempDir = await createTempDir();
		try {
			const target = path.join(tempDir, 'assets/logo.png');
			await fs.mkdir(path.dirname(target), {recursive: true});
			await fs.writeFile(target, BINARY_FIXTURE);

			const service = new FileSnapshotService(tempDir);
			const {snapshots} = await service.captureFiles(['assets/logo.png']);

			// Capture must not decode: the bytes are lost here first.
			t.deepEqual(snapshots.get('assets/logo.png'), BINARY_FIXTURE);

			await fs.writeFile(target, Buffer.from('clobbered'));
			await service.restoreFiles(snapshots);

			// Restore must not encode.
			t.deepEqual(await fs.readFile(target), BINARY_FIXTURE);
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

// Gap 1: a file git reported but that could not be read used to vanish with only
// a log line, so a later restore silently put back less than the user thought.
//
// A directory standing where a file is expected fails with EISDIR on every
// platform, which is a genuine read failure and not a missing file. chmod 0o000
// would not do it: Windows cannot drop read permission that way.
test.serial(
	'FileSnapshotService reports files it could not capture',
	async t => {
		const tempDir = await createTempDir();
		try {
			await createTestFile(tempDir, 'readable.txt', 'kept');
			await fs.mkdir(path.join(tempDir, 'unreadable.txt'), {recursive: true});

			const service = new FileSnapshotService(tempDir);
			const {snapshots, skipped} = await service.captureFiles([
				'readable.txt',
				'unreadable.txt',
			]);

			t.is(snapshots.size, 1);
			t.is(skipped.length, 1);
			t.is(skipped[0]?.path, 'unreadable.txt');
			// The reason travels with it, so a restore can say why.
			t.true((skipped[0]?.reason.length ?? 0) > 0);
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

// `git diff --name-only HEAD` lists deleted files, so they reach captureFiles
// and fail with ENOENT. Recording those would make deleting a file and taking a
// checkpoint produce a permanent gap warning on every later restore - the
// failure this feature exists to prevent, inverted.
test.serial(
	'FileSnapshotService does not record a deleted file as a gap',
	async t => {
		const tempDir = await createTempDir();
		try {
			await createTestFile(tempDir, 'kept.txt', 'kept');

			const service = new FileSnapshotService(tempDir);
			const {snapshots, skipped} = await service.captureFiles([
				'kept.txt',
				'deleted.txt',
			]);

			t.is(snapshots.size, 1);
			t.deepEqual(skipped, []);
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

// skippedFiles and filesChanged are read side by side at restore, so a skipped
// path has to be keyed the same way a captured one is.
test.serial(
	'FileSnapshotService normalizes the path of a file it skipped',
	async t => {
		const tempDir = await createTempDir();
		try {
			await fs.mkdir(path.join(tempDir, 'nested', 'dir.txt'), {
				recursive: true,
			});

			const service = new FileSnapshotService(tempDir);
			const {skipped} = await service.captureFiles([
				path.join('nested', 'dir.txt'),
			]);

			t.is(skipped.length, 1);
			t.is(skipped[0]?.path, 'nested/dir.txt');
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

test.serial(
	'FileSnapshotService reports nothing skipped when every file is readable',
	async t => {
		const tempDir = await createTempDir();
		try {
			await createTestFile(tempDir, 'a.txt', 'a');

			const service = new FileSnapshotService(tempDir);
			const {skipped} = await service.captureFiles(['a.txt']);

			t.deepEqual(skipped, []);
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);

// Gap 2: the cap warned at capture time and was invisible afterwards, so a
// restore never mentioned the files it was never given.
test.serial(
	'FileSnapshotService reports how many files the cap dropped',
	async t => {
		const tempDir = await createTempDir();
		try {
			// getModifiedFiles asks git for `diff --name-only HEAD`, so the repo
			// needs a commit to diff against - a bare `git init` has no HEAD and
			// the whole lookup falls into its empty-result branch.
			await execFileAsync('git', ['init'], {cwd: tempDir});
			await createTestFile(tempDir, 'committed.txt', 'base');
			await execFileAsync('git', ['add', '-A'], {cwd: tempDir});
			// A contributor with commit signing, a global core.hooksPath, or any
			// commit-msg hook would otherwise fail this commit and take the test
			// with it. None of them have anything to say about a temp fixture.
			await execFileAsync(
				'git',
				[
					'-c',
					'user.email=test@example.com',
					'-c',
					'user.name=test',
					'-c',
					'core.hooksPath=',
					'commit',
					'-m',
					'base',
					'--no-gpg-sign',
					'--no-verify',
				],
				{cwd: tempDir},
			);

			for (let i = 0; i < MAX_CHECKPOINT_FILES + 3; i++) {
				await createTestFile(tempDir, `file-${i}.txt`, `content ${i}`);
			}

			const service = new FileSnapshotService(tempDir);
			const {files, truncatedCount} = service.getModifiedFilesResult();

			t.is(files.length, MAX_CHECKPOINT_FILES);
			t.is(truncatedCount, 3);
		} finally {
			await cleanupTempDir(tempDir);
		}
	},
);
