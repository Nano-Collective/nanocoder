#!/usr/bin/env node

/**
 * Finish `pnpm run build` after tsc and tsc-alias have written dist/.
 *
 * This used to be a chain of `mkdir -p`, `cp` and `chmod` in the package.json
 * build script, which pnpm runs through cmd.exe on Windows where none of them
 * behave (`mkdir -p` makes a stray "-p" directory, `cp` and `chmod` do not
 * exist). Plain node:fs works the same on every platform.
 *
 *   - Copy the voice plugin's compiled .js and .d.ts files into dist/voice.
 *   - Copy contributors.json next to the compiled /credits command.
 *   - Mark dist/cli.js executable (a no-op on Windows, which has no exec bit).
 */

import {chmodSync, copyFileSync, mkdirSync, readdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

const voiceSrcDir = join(rootDir, 'plugins', 'voice', 'dist');
const voiceDestDir = join(rootDir, 'dist', 'voice');

mkdirSync(voiceDestDir, {recursive: true});
for (const file of readdirSync(voiceSrcDir)) {
	if (file.endsWith('.js') || file.endsWith('.d.ts')) {
		copyFileSync(join(voiceSrcDir, file), join(voiceDestDir, file));
	}
}

copyFileSync(
	join(rootDir, 'source', 'commands', 'contributors.json'),
	join(rootDir, 'dist', 'commands', 'contributors.json'),
);

chmodSync(join(rootDir, 'dist', 'cli.js'), 0o755);
