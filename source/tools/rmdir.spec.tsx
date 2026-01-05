import test from 'ava';
import {writeFile, readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {tmpdir} from 'node:os';
import {rm, mkdir} from 'node:fs/promises';

import {rmdirTool} from './rmdir';

let testDir: string;
let originalCwd: string;

test.before(async () => {
  // Create a test directory
  testDir = resolve(tmpdir(), `nanocoder-rmdir-test-${Date.now()}`);
  await rm(testDir, {recursive: true, force: true}).catch(() => {});
  await mkdir(testDir, {recursive: true});
  originalCwd = process.cwd();
  process.chdir(testDir);
});

test.after.always(async () => {
  // Restore original working directory
  process.chdir(originalCwd);
  // Clean up test directory
  try {
    await rm(testDir, {recursive: true, force: true});
  } catch {}
});

// Helper to create a test file
async function createTestFile(content: string): Promise<string> {
  const fileName = `file-${Date.now()}-${Math.random().toString(36).substring(7)}.txt`;
  const tempPath = join(testDir, fileName);
  await writeFile(tempPath, content, 'utf-8');
  return fileName;
}

// Helper to create a test directory
async function createTestDir(): Promise<string> {
  const dirName = `dir-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const tempPath = join(testDir, dirName);
  await rm(tempPath, {recursive: true, force: true}).catch(() => {});
  await rm(tempPath, {recursive: true, force: true}).catch(() => {});
  return dirName;
}

test('should remove empty directory', async t => {
  const testDirPath = await createTestDir();

  const args = {
    path: testDirPath,
  };

  const result = await rmdirTool.tool.execute(args);
  t.true(result.includes(`Removed empty directory "${testDirPath}"`));

  const dirExists = await existsSync(testDirPath).catch(() => false);
  t.false(dirExists, 'Directory should be deleted');
});

test('should fail for non-empty directory', async t => {
  const testDirPath = await createTestDir();
  const filePath = join(testDirPath, 'test.txt');
  await writeFile(filePath, 'content', 'utf-8');

  const args = {
    path: testDirPath,
  };

  await t.throwsAsync(
    async () => rmdirTool.tool.execute(args),
    {message: /Directory not empty/},
  );

  const dirExists = await existsSync(testDirPath).catch(() => false);
  t.true(dirExists, 'Directory should still exist');
});

test('should fail for file path', async t => {
  const testPath = await createTestFile('content');

  const args = {
    path: testPath,
  };

  await t.throwsAsync(
    async () => rmdirTool.tool.execute(args),
    {message: /Not a directory/},
  );
});

test('should fail for nonexistent path', async t => {
  const args = {
    path: 'nonexistent-dir',
  };

  await t.throwsAsync(
    async () => rmdirTool.tool.execute(args),
    {message: /No such file or directory/},
  );
});

test('validator should reject dangerous patterns', async t => {
  const args = {
    path: '/',
  };

  const result = await rmdirTool.validator!(args);
  t.false(result.valid);
  t.true(result.error.includes('dangerous deletion'));
});

test('validator should reject empty path', async t => {
  const args = {
    path: '',
  };

  const result = await rmdirTool.validator!(args);
  t.false(result.valid);
  t.true(result.error.includes('Path is required'));
});