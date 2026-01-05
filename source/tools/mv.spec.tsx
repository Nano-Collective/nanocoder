import test from 'ava';
import {writeFile, readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {tmpdir} from 'node:os';
import {rm, mkdir} from 'node:fs/promises';

import {mvTool} from './mv';

let testDir: string;
let originalCwd: string;

test.before(async () => {
  // Create a test directory
  testDir = resolve(tmpdir(), `nanocoder-mv-test-${Date.now()}`);
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

test('should rename a file', async t => {
  const originalPath = await createTestFile('test content');
  const newPath = 'renamed.txt';

  const args = {
    source: originalPath,
    destination: newPath,
  };

  const result = await mvTool.tool.execute(args);
  t.true(result.includes('Renamed file'));
  t.true(result.includes(`from "${originalPath}"`));
  t.true(result.includes(`to "${newPath}"`));

  const oldExists = await existsSync(originalPath).catch(() => false);
  const newExists = await existsSync(newPath).catch(() => false);
  t.false(oldExists, 'Original file should not exist');
  t.true(newExists, 'New file should exist');

  const newContent = await readFile(newPath, 'utf-8');
  t.is(newContent, 'test content', 'Content should be preserved');
});

test('should move a file', async t => {
  const originalPath = await createTestFile('test content');
  const targetDir = await createTestDir();
  const targetPath = join(targetDir, 'moved.txt');

  const args = {
    source: originalPath,
    destination: targetPath,
  };

  const result = await mvTool.tool.execute(args);
  t.true(result.includes('Moved file'));

  const oldExists = await existsSync(originalPath).catch(() => false);
  const newExists = await existsSync(targetPath).catch(() => false);
  t.false(oldExists, 'Original file should not exist');
  t.true(newExists, 'New file should exist');

  const newContent = await readFile(targetPath, 'utf-8');
  t.is(newContent, 'test content', 'Content should be preserved');
});

test('should move a directory with contents', async t => {
  const originalDir = await createTestDir();
  const subDir = join(originalDir, 'subdir');
  const file1 = join(originalDir, 'file1.txt');
  const file2 = join(subDir, 'file2.txt');
  
  await writeFile(file1, 'content1', 'utf-8');
  await rm(subDir, {recursive: true, force: true}).catch(() => {});
  await writeFile(subDir, 'content2', 'utf-8');

  const newDir = await createTestDir();

  const args = {
    source: originalDir,
    destination: newDir,
  };

  const result = await mvTool.tool.execute(args);
  t.true(result.includes('Moved directory'));

  const oldExists = await existsSync(originalDir).catch(() => false);
  const newExists = await existsSync(newDir).catch(() => false);
  const nestedFileExists = await existsSync(join(newDir, 'file1.txt')).catch(() => false);
  t.false(oldExists, 'Original directory should not exist');
  t.true(newExists, 'New directory should exist');
  t.true(nestedFileExists, 'Nested file should exist');
});

test('should fail when source does not exist', async t => {
  const args = {
    source: 'nonexistent.txt',
    destination: 'new.txt',
  };

  await t.throwsAsync(
    async () => mvTool.tool.execute(args),
    {message: /does not exist/},
  );
});

test('should fail when destination exists without overwrite', async t => {
  const sourcePath = await createTestFile('source content');
  const destPath = await createTestFile('existing content');

  const args = {
    source: sourcePath,
    destination: destPath,
  };

  await t.throwsAsync(
    async () => mvTool.tool.execute(args),
    {message: /already exists/},
  );

  // Verify original content preserved
  const sourceContent = await readFile(sourcePath, 'utf-8');
  const destContent = await readFile(destPath, 'utf-8');
  t.is(sourceContent, 'source content', 'Source content should be preserved');
  t.is(destContent, 'existing content', 'Destination content should be preserved');
});

test('should overwrite when destination exists with overwrite=true', async t => {
  const sourcePath = await createTestFile('source content');
  const destPath = await createTestFile('existing content');

  const args = {
    source: sourcePath,
    destination: destPath,
    overwrite: true,
  };

  const result = await mvTool.tool.execute(args);
  t.true(result.includes('Renamed file'));

  const sourceExists = await existsSync(sourcePath).catch(() => false);
  const destExists = await existsSync(destPath).catch(() => false);
  t.false(sourceExists, 'Source file should not exist');
  t.true(destExists, 'Destination file should exist');

  const newContent = await readFile(destPath, 'utf-8');
  t.is(newContent, 'source content', 'Destination should have source content');
});

test('should fail for same source and destination', async t => {
  const path = await createTestFile('content');

  const args = {
    source: path,
    destination: path,
  };

  await t.throwsAsync(
    async () => mvTool.tool.execute(args),
    {message: /Source and destination are the same/},
  );
});

test('validator should reject dangerous patterns', async t => {
  const args = {
    source: 'file.txt',
    destination: '/',
  };

  const result = await mvTool.validator!(args);
  t.false(result.valid);
  t.true(result.error.includes('dangerous path'));
});

test('validator should reject empty source', async t => {
  const args = {
    source: '',
    destination: 'dest.txt',
  };

  const result = await mvTool.validator!(args);
  t.false(result.valid);
  t.true(result.error.includes('Source path is required'));
});

test('validator should reject empty destination', async t => {
  const args = {
    source: 'source.txt',
    destination: '',
  };

  const result = await mvTool.validator!(args);
  t.false(result.valid);
  t.true(result.error.includes('Destination path is required'));
});