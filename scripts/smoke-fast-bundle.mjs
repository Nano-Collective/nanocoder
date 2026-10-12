#!/usr/bin/env node
/**
 * Fast-bundle smoke test.
 *
 * `node dist/cli.js --version` is handled by a fast path in cli.tsx that exits
 * before loading the app graph, so it cannot catch a data file that resolves
 * outside the package -- the class of bug a flat rolldown build introduces.
 *
 * This loads a real code-split chunk that reads data files: the /credits
 * command, which reads both `contributors.json` and the nearest `package.json`.
 * Both reads are swallowed by `catch { return [] }` in production, so an empty
 * result is exactly the silent failure being guarded against.
 */
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(repoRoot, 'dist');

function fail(message) {
	console.error(`smoke-fast-bundle: ${message}`);
	process.exit(1);
}

// `nanocoder daemon start` spawns this file by path, so a missing entry only
// surfaces as a daemon that silently never boots.
const daemonEntry = join(distDir, 'daemon', 'entry.js');
if (!existsSync(daemonEntry)) {
	fail(`daemon entry not emitted at ${daemonEntry}`);
}

// The lazy registry in the entry chunk also mentions `creditsCommand` (inside
// `import(...).then(m => m.creditsCommand)`), so match the export statement to
// find the chunk that actually owns and bundles the command.
const creditsChunk = readdirSync(distDir)
	.filter(name => name.endsWith('.js'))
	.find(name =>
		/export[ \t]*\{[^}]*\bcreditsCommand\b/.test(
			readFileSync(join(distDir, name), 'utf8'),
		),
	);

if (!creditsChunk) {
	fail('no built chunk exports creditsCommand');
}

const {creditsCommand} = await import(
	pathToFileURL(join(distDir, creditsChunk)).href
);

const element = await creditsCommand.handler([], [], {
	provider: 'smoke',
	model: 'smoke',
	tokens: 0,
	getMessageTokens: () => 0,
});

const {contributors = [], dependencies = []} = element?.props ?? {};

if (contributors.length === 0) {
	fail(
		`${creditsChunk} resolved no contributors (contributors.json path is wrong)`,
	);
}
if (dependencies.length === 0) {
	fail(`${creditsChunk} resolved no dependencies (package.json path is wrong)`);
}

console.log(
	`smoke-fast-bundle: ${creditsChunk} read ${contributors.length} contributors and ${dependencies.length} dependencies`,
);
