import test from 'ava';
import {writeFile, readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {tmpdir} from 'node:os';
import {rm, mkdir} from 'node:fs/promises';

import {rmTool} from './rm';

let testDir: string;
let originalCwd: string;

test.before(async () => {
  // Create a test directory
  testDir = resolve(tmpdir(), `nanocoder-rm-test-${Date.now()}`);
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

test('should delete a single file', async t => {
  const testPath = await createTestFile('test content');

  const args = {
    path: testPath,
  };

  const result = await rmTool.tool.execute(args);
  t.true(result.includes(`Removed file "${testPath}"`));

  const fileExists = existsSync(testPath);
  t.false(fileExists, 'File should be deleted');
});

test('should fail for directory without recursive=true', async t => {
  const testDir = await createTestDir();

  const args = {
    path: testDir,
  };

  await t.throwsAsync(
    async () => rmTool.tool.execute(args),
    {message: /Is a directory.*recursive=true/},
  );
});

test('should delete directory with recursive=true', async t => {
  const testDir = await createTestDir();
  const filePath = join(testDir, 'test.txt');
  await writeFile(filePath, 'content', 'utf-8');

  const args = {
    path: testDir,
    recursive: true,
  };

  const result = await rmTool.tool.execute(args);
  t.true(result.includes(`Removed directory "${testDir}"`));

  const dirExists = existsSync(testDir);
  t.false(dirExists, 'Directory should be deleted');
});

test('should succeed with force=true for nonexistent path', async t => {
  const args = {
    path: 'nonexistent.txt',
    force: true,
  };

  const result = await rmTool.tool.execute(args);
  t.true(result.includes(`No files matched`));
});

test('should fail for nonexistent path without force=true', async t => {
  const args = {
    path: 'nonexistent.txt',
  };

  await t.throwsAsync(
    async () => rmTool.tool.execute(args),
    {message: /No such file or directory/},
  );
});

test('validator should reject dangerous patterns', async t => {
  const args = {
    path: '/',
  };

  const result = await rmTool.validator!(args);
  t.false(result.valid);
  t.true(result.error.includes('dangerous deletion'));
});

test('validator should reject empty path', async t => {
  const args = {
    path: '',
  };

  const result = await rmTool.validator!(args);
  t.false(result.valid);
  t.true(result.error.includes('Path is required'));
});