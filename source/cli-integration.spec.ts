import test from 'ava';
import {execSync, execFileSync} from 'child_process';
import {join} from 'path';
import {fileURLToPath} from 'url';

// Get the directory name of the current module
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const cliPath = join(__dirname, '..', 'dist', 'cli.js');

// Helper function to run CLI commands
export function runCliCommand(args: string[]): string {
	try {
		const result = execFileSync('node', [cliPath, ...args], {
			encoding: 'utf8',
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		return result.trim();
	} catch (error: any) {
		// If the command exits with code 0 but has output, return the output
		if (error.stdout) {
			return error.stdout.trim();
		}
		// If the command fails, throw the error
		throw error;
	}
}

// Integration tests for CLI version and help commands
test('CLI integration: --version flag returns version number', t => {
	const output = runCliCommand(['--version']);
	
	// Should return a valid version number (semver format)
	t.regex(output, /^\d+\.\d+\.\d+$/);
});

test('CLI integration: -v flag returns version number', t => {
	const output = runCliCommand(['-v']);
	
	// Should return a valid version number (semver format)
	t.regex(output, /^\d+\.\d+\.\d+$/);
});

test('CLI integration: --help flag returns help text', t => {
	const output = runCliCommand(['--help']);
	
	// Should contain expected help text elements
	t.true(output.includes('Usage:'));
	t.true(output.includes('--version'));
	t.true(output.includes('--help'));
	t.true(output.includes('--vscode'));
	t.true(output.includes('run'));
});

test('CLI integration: -h flag returns help text', t => {
	const output = runCliCommand(['-h']);
	
	// Should contain expected help text elements
	t.true(output.includes('Usage:'));
	t.true(output.includes('--version'));
	t.true(output.includes('--help'));
	t.true(output.includes('--vscode'));
	t.true(output.includes('run'));
});

test('CLI integration: version and help flags exit with code 0', t => {
	// Test that both flags exit successfully
	try {
		execFileSync('node', [cliPath, '--version'], {stdio: ['pipe', 'pipe', 'pipe']});
		t.pass('--version exits with code 0');
	} catch (error: any) {
		if (error.status !== 0) {
			t.fail(`--version exited with code ${error.status}`);
		}
	}

	try {
		execFileSync('node', [cliPath, '--help'], {stdio: ['pipe', 'pipe', 'pipe']});
		t.pass('--help exits with code 0');
	} catch (error: any) {
		if (error.status !== 0) {
			t.fail(`--help exited with code ${error.status}`);
		}
	}
});

test('CLI integration: version flag takes precedence over other arguments', t => {
	const output = runCliCommand(['--version', '--vscode', 'run', 'test']);
	
	// Should return version number, not start the app
	t.regex(output, /^\d+\.\d+\.\d+$/);
});

test('CLI integration: help flag takes precedence over other arguments', t => {
	const output = runCliCommand(['--help', '--vscode', 'run', 'test']);
	
	// Should return help text, not start the app
	t.true(output.includes('Usage:'));
	t.true(output.includes('--version'));
});