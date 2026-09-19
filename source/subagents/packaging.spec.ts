import test from 'ava';
import {execSync} from 'node:child_process';
import {rmSync, mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

console.log('\npackaging.spec.ts');

test.serial('pnpm pack includes built-in subagents', t => {
	const projectRoot = process.cwd(); // Assume tests are run from the project root

	const tempDir = mkdtempSync(join(tmpdir(), 'nanocoder-pack-test-'));
	try {
		// Run pack in projectRoot but redirect output file to tempDir
		const outputText = execSync(`pnpm pack --pack-destination ${tempDir}`, {cwd: projectRoot, encoding: 'utf-8'});

		// Unpack to inspect contents
		execSync('tar -xf *.tgz', {cwd: tempDir});

		// Check if explore.md exists in package/dist/subagents/built-in
		const lsOutput = execSync('ls -la package/dist/subagents/built-in/explore.md', {cwd: tempDir, encoding: 'utf-8'});

		t.true(lsOutput.includes('explore.md'), 'explore.md should be included in the tarball');
	} finally {
		rmSync(tempDir, {recursive: true, force: true});
	}
});
