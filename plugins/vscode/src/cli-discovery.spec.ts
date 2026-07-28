import test from 'ava';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import { findCliPath } from './cli-discovery';

test.serial('findCliPath - discovers fallback global paths when which fails', async (t) => {
	const originalNvmDir = process.env.NVM_DIR;
	const originalPath = process.env.PATH;
	const originalShell = process.env.SHELL;

	// Create a real temporary NVM directory structure
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-test-'));
	const nvmDir = path.join(tempDir, '.nvm');
	const nodeDir = path.join(nvmDir, 'versions', 'node');
	const versionDir = path.join(nodeDir, 'v99.99.9');
	const binDir = path.join(versionDir, 'bin');
	const fakeCli = path.join(binDir, 'nanocoder');

	fs.mkdirSync(binDir, { recursive: true });
	fs.writeFileSync(fakeCli, '#!/usr/bin/env node\nconsole.log("hello");');
	fs.chmodSync(fakeCli, 0o755);

	try {
		// Point NVM_DIR to our temp structure
		process.env.NVM_DIR = nvmDir;

		// Ensure `which nanocoder` fails by clearing PATH
		process.env.PATH = '';
		process.env.SHELL = '/bin/false';

		const result = await findCliPath();
		t.is(result, fakeCli, 'Should find nanocoder in the simulated NVM directory');

	} finally {
		// Cleanup
		if (originalNvmDir !== undefined) process.env.NVM_DIR = originalNvmDir;
		else delete process.env.NVM_DIR;

		if (originalPath !== undefined) process.env.PATH = originalPath;
		else delete process.env.PATH;

		if (originalShell !== undefined) process.env.SHELL = originalShell;
		else delete process.env.SHELL;

		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});
