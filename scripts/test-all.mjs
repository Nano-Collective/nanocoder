#!/usr/bin/env node
// Cross-platform equivalent of scripts/test.sh (bash-only) so `pnpm test:all`
// also works on Windows. Runs every gate sequentially, stopping at the first
// failure, with the same set of steps and the same best-effort semgrep step.
import {spawnSync} from 'node:child_process';

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

const gates = [
	['test:format', 'Checking code formatting'],
	['test:types', 'Checking TypeScript types'],
	['test:types:vscode', 'Checking VS Code extension types'],
	['test:lint', 'Running linter'],
	['test:ava', 'Running AVA tests'],
	['test:knip', 'Checking for unused code'],
	['test:audit', 'Running security audit'],
];

function runGate(script) {
	console.log(`\n--- ${script}`);
	// A shell is required on Windows to run the pnpm.cmd wrapper (spawning it
	// without one fails with EINVAL); script always comes from the fixed gate
	// list above and taint-free pnpm path.
	// nosemgrep: javascript.lang.security.audit.spawn-shell-true.spawn-shell-true
	const result = spawnSync(pnpm, ['run', script], {
		stdio: 'inherit',
		shell: process.platform === 'win32',
	});
	return result.status === 0;
}

for (const [script] of gates) {
	if (!runGate(script)) {
		console.error(`pnpm ${script} failed`);
		process.exit(1);
	}
}

// Semgrep is best-effort: keep skipping it when absent, mirroring scripts/test.sh.
const semgrep = spawnSync('semgrep', ['--version'], {
	stdio: 'ignore',
});
if (semgrep.status === 0) {
	console.log('\n--- test:security');
	if (!runGate('test:security')) {
		console.error('pnpm test:security failed');
		process.exit(1);
	}
} else {
	console.warn('\nsemgrep not installed - skipping security scan');
}

console.log('\nAll tests pass.');
