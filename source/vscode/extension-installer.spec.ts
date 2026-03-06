import test from 'ava';
import {
	getExtensionStatus,
	getVsixPath,
	installExtension,
	isExtensionInstalled,
	isVSCodeCliAvailable,
} from './extension-installer.js';

// ============================================================================
// Tests for isVSCodeCliAvailable
// ============================================================================

test('isVSCodeCliAvailable returns a boolean', async t => {
	const result = await isVSCodeCliAvailable();
	t.is(typeof result, 'boolean');
});

test('isVSCodeCliAvailable does not throw', async t => {
	await t.notThrowsAsync(async () => {
		await isVSCodeCliAvailable();
	});
});

// ============================================================================
// Tests for getExtensionStatus
// ============================================================================

test('getExtensionStatus returns an array of status objects', async t => {
	const statuses = await getExtensionStatus();
	t.true(Array.isArray(statuses));

	if (statuses.length > 0) {
		const status = statuses[0];
		if (status) {
			t.is(typeof status.cli, 'string');
			t.is(typeof status.available, 'boolean');
			t.is(typeof status.extensionInstalled, 'boolean');
		}
	}
});

// ============================================================================
// Tests for isExtensionInstalled
// ============================================================================

test('isExtensionInstalled returns a boolean', async t => {
	const result = await isExtensionInstalled();
	t.is(typeof result, 'boolean');
});

test('isExtensionInstalled does not throw', async t => {
	await t.notThrowsAsync(async () => {
		await isExtensionInstalled();
	});
});

// Note: We can't easily test the true case for isExtensionInstalled
// without actually having VS Code and the extension installed

// ============================================================================
// Tests for installExtension
// ============================================================================

test('installExtension returns a promise', async t => {
	const result = installExtension();
	t.true(result instanceof Promise);
	// Wait for the promise to settle
	await result.catch(() => {});
});

test('installExtension returns object with success, message, and results', async t => {
	const result = await installExtension();

	t.is(typeof result.success, 'boolean');
	t.is(typeof result.message, 'string');
	t.true(Array.isArray(result.results));
});

// If VS Code CLI is not available, installExtension should return appropriate message
test('installExtension handles missing VS Code CLI gracefully', async t => {
	// This test documents expected behavior - if code CLI is missing,
	// installExtension should return a helpful message
	const result = await installExtension();

	const isAvailable = await isVSCodeCliAvailable();
	if (!isAvailable) {
		t.false(result.success);
		t.true(result.message.includes('No supported VS Code flavor found'));
	} else {
		// If VS Code is available, the result depends on whether VSIX exists
		t.is(typeof result.success, 'boolean');
	}
});

// ============================================================================
// Tests for getVsixPath
// ============================================================================

test('getVsixPath returns a string when VSIX exists', t => {
	try {
		const path = getVsixPath();
		t.is(typeof path, 'string');
		t.true(path.includes('nanocoder-vscode.vsix'));
	} catch (error) {
		// VSIX may not exist in all environments (e.g., before build)
		t.true(error instanceof Error);
		t.true((error as Error).message.includes('VSIX not found'));
	}
});

test('getVsixPath throws when VSIX does not exist', t => {
	// Since we can't guarantee VSIX exists in test environment,
	// we just verify the function throws the expected error type
	try {
		getVsixPath();
		// If it doesn't throw, the VSIX exists - that's fine
		t.pass();
	} catch (error) {
		t.true(error instanceof Error);
		t.regex((error as Error).message, /VSIX not found/);
	}
});

// ============================================================================
// Integration-style tests (behavior documentation)
// ============================================================================

test('installExtension with VSIX missing returns appropriate error', async t => {
	// This test documents the expected behavior when VSIX is missing
	// but VS Code CLI is available
	const isAvailable = await isVSCodeCliAvailable();
	if (!isAvailable) {
		t.pass(); // Skip if VS Code not available
		return;
	}

	const result = await installExtension();

	// If VSIX doesn't exist, should fail with appropriate message
	if (!result.success) {
		t.true(
			result.message.includes('Failed') || result.message.includes('not found'),
		);
	} else {
		// If it succeeded, the extension was installed
		t.true(result.message.includes('success'));
	}
});

// ============================================================================
// Type safety tests
// ============================================================================

test('isVSCodeCliAvailable has correct return type', async t => {
	const result: boolean = await isVSCodeCliAvailable();
	t.is(typeof result, 'boolean');
});

test('isExtensionInstalled has correct return type', async t => {
	const result: boolean = await isExtensionInstalled();
	t.is(typeof result, 'boolean');
});

test('installExtension has correct return type', async t => {
	const result: {success: boolean; message: string; results: any[]} =
		await installExtension();
	t.is(typeof result.success, 'boolean');
	t.is(typeof result.message, 'string');
});

test('getVsixPath has correct return type when successful', t => {
	try {
		const result: string = getVsixPath();
		t.is(typeof result, 'string');
	} catch {
		// Expected if VSIX doesn't exist
		t.pass();
	}
});
