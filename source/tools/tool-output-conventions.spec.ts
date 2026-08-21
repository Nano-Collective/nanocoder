import test from 'ava';

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const toolsDir = join(process.cwd(), 'source', 'tools');

test('read_file returns raw content without line-number prefixes', (t) => {
  const readFilePath = join(toolsDir, 'read-file.tsx');
  if (!existsSync(readFilePath)) {
    t.fail('source/tools/read-file.tsx should exist');
    return;
  }

  const source = readFileSync(readFilePath, 'utf8');
  t.false(
    source.includes('%4d:'),
    'read_file should not return model-facing content with line-number prefixes',
  );
});

test('bounded edit tools keep absolute line-numbered context headers', (t) => {
  const fileOpsDir = join(toolsDir, 'file-ops');
  if (!existsSync(fileOpsDir)) {
    t.fail('source/tools/file-ops should exist');
    return;
  }

  const files = readdirSync(fileOpsDir).filter(
    (file) =>
      (file.endsWith('.tsx') || file.endsWith('.ts')) &&
      !file.includes('.spec.'),
  );

  const hasContextHeader = files.some((file) => {
    const source = readFileSync(join(fileOpsDir, file), 'utf8');
    return source.includes('Updated file context (lines');
  });

  t.true(
    hasContextHeader,
    'bounded edit tools should include an absolute line-numbered context header',
  );
});
