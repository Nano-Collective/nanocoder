import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import type {UserPreferences} from '@/types/index';
import {
	directoryTrustRefusal,
	ensureDirectoryTrust,
	grantDirectoryTrust,
	isDirectoryTrusted,
	trustRecheck,
} from './directory-trust';
import {describeProjectTrust, TRUST_FINGERPRINT_VERSION} from './project-trust';

console.log('\ndirectory-trust.spec.ts');


test('isDirectoryTrusted returns false when trustedDirectories is empty', t => {
	t.false(isDirectoryTrusted('/some/project', {}));
});

test('isDirectoryTrusted matches a record with the current fingerprint', t => {
	const dir = process.cwd();
	const fingerprint = describeProjectTrust(dir).fingerprint;
	t.true(
		isDirectoryTrusted(dir, {
			trustedDirectories: [{path: dir, fingerprint}],
		}),
	);
	t.true(
		isDirectoryTrusted(dir, {
			trustedDirectories: [{path: '.', fingerprint}],
		}),
	);
});

test('isDirectoryTrusted ignores a path that has no fingerprint', t => {
	const dir = process.cwd();
	t.false(isDirectoryTrusted(dir, {trustedDirectories: [dir]}));
});

test('isDirectoryTrusted ignores a stale fingerprint', t => {
	const dir = process.cwd();
	t.false(
		isDirectoryTrusted(dir, {
			trustedDirectories: [{path: dir, fingerprint: 'stale'}],
		}),
	);
});

test('isDirectoryTrusted is false after a plugin is added', t => {
	const root = join(tmpdir(), `trust-plugin-${Date.now()}`);
	mkdirSync(join(root, '.nanocoder', 'plugins'), {recursive: true});
	try {
		const before = describeProjectTrust(root).fingerprint;
		writeFileSync(
			join(root, '.nanocoder', 'plugins', 'pulled.mjs'),
			'export default {name:"pulled"}\n',
		);
		t.false(
			isDirectoryTrusted(root, {
				trustedDirectories: [{path: root, fingerprint: before}],
			}),
		);
		t.true(
			isDirectoryTrusted(root, {
				trustedDirectories: [
					{
						path: root,
						fingerprint: describeProjectTrust(root).fingerprint,
					},
				],
			}),
		);
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test('isDirectoryTrusted does not match an unrelated directory', t => {
	t.false(
		isDirectoryTrusted(process.cwd(), {
			trustedDirectories: ['/some/other/project'],
		}),
	);
});

test('ensureDirectoryTrust trusts without persisting when bypass is true', t => {
	let saveCalled = false;
	const result = ensureDirectoryTrust('/untrusted/project', true, {
		loadPreferences: () => ({trustedDirectories: []}),
		savePreferences: () => {
			saveCalled = true;
		},
	});
	t.deepEqual(result, {trusted: true, persisted: false});
	t.false(saveCalled);
});

test('ensureDirectoryTrust trusts an already-recorded directory without persisting again', t => {
	const dir = process.cwd();
	let saveCalled = false;
	const result = ensureDirectoryTrust(dir, false, {
		loadPreferences: () => ({
			trustedDirectories: [
				{path: dir, fingerprint: describeProjectTrust(dir).fingerprint},
			],
		}),
		savePreferences: () => {
			saveCalled = true;
		},
	});
	t.deepEqual(result, {trusted: true, persisted: false});
	t.false(saveCalled);
});

test.serial(
	'ensureDirectoryTrust refuses an unrecorded directory when NANOCODER_TRUST_DIRECTORY is unset',
	t => {
		delete process.env.NANOCODER_TRUST_DIRECTORY;
		const result = ensureDirectoryTrust('/untrusted/project', false, {
			loadPreferences: () => ({trustedDirectories: []}),
			savePreferences: () => {
				t.fail('should not persist when refusing');
			},
		});
		t.deepEqual(result, {trusted: false, persisted: false, recheck: null});
	},
);

test.serial(
	'ensureDirectoryTrust flags a trusted directory whose fingerprint changed',
	t => {
		delete process.env.NANOCODER_TRUST_DIRECTORY;
		const dir = process.cwd();
		const result = ensureDirectoryTrust(dir, false, {
			loadPreferences: () => ({
				trustedDirectories: [{path: dir, fingerprint: 'old'}],
			}),
			savePreferences: () => {
				t.fail('should not persist when refusing');
			},
		});
		t.deepEqual(result, {trusted: false, persisted: false, recheck: 'changed'});
	},
);

test.serial(
	'ensureDirectoryTrust says a path-only entry needs re-approval after the upgrade',
	t => {
		delete process.env.NANOCODER_TRUST_DIRECTORY;
		const dir = process.cwd();
		const result = ensureDirectoryTrust(dir, false, {
			loadPreferences: () => ({trustedDirectories: [dir]}),
			savePreferences: () => {
				t.fail('should not persist when refusing');
			},
		});
		t.deepEqual(result, {trusted: false, persisted: false, recheck: 'upgrade'});
	},
);

test.serial('directoryTrustRefusal returns the refusal message for an untrusted directory', t => {
	delete process.env.NANOCODER_TRUST_DIRECTORY;
	const message = directoryTrustRefusal('/untrusted/project', false, {
		loadPreferences: () => ({trustedDirectories: []}),
		savePreferences: () => {
			t.fail('should not persist when refusing');
		},
	});
	t.regex(message ?? '', /is not trusted/);
	t.regex(message ?? '', /--trust-directory/);
	t.regex(message ?? '', /NANOCODER_TRUST_DIRECTORY=1/);
});

test.serial('directoryTrustRefusal words a path-only entry as needing re-approval after the upgrade', t => {
	delete process.env.NANOCODER_TRUST_DIRECTORY;
	const dir = process.cwd();
	const message = directoryTrustRefusal(dir, false, {
		loadPreferences: () => ({trustedDirectories: [dir]}),
		savePreferences: () => {
			t.fail('should not persist when refusing');
		},
	});
	t.regex(message ?? '', /needs re-approval after the upgrade/);
});

test.serial('directoryTrustRefusal words a changed fingerprint differently from an unknown directory', t => {
	delete process.env.NANOCODER_TRUST_DIRECTORY;
	const dir = process.cwd();
	const message = directoryTrustRefusal(dir, false, {
		loadPreferences: () => ({
			trustedDirectories: [{path: dir, fingerprint: 'old'}],
		}),
		savePreferences: () => {
			t.fail('should not persist when refusing');
		},
	});
	t.regex(message ?? '', /changed since you trusted it/);
	t.notRegex(message ?? '', /is not trusted/);
});

test('a trust record without a version counts as version 1, and grants record one', t => {
	const dir = process.cwd();
	const fingerprint = describeProjectTrust(dir).fingerprint;
	t.true(
		isDirectoryTrusted(dir, {
			trustedDirectories: [{path: dir, fingerprint}],
		}),
	);
	t.like(grantDirectoryTrust({}, dir).trustedDirectories?.[0], {
		fingerprintVersion: TRUST_FINGERPRINT_VERSION,
	});
});

test('a trust record from another fingerprint version needs re-approval', t => {
	const dir = process.cwd();
	const preferences = {
		trustedDirectories: [
			{
				path: dir,
				fingerprint: describeProjectTrust(dir).fingerprint,
				fingerprintVersion: TRUST_FINGERPRINT_VERSION + 1,
			},
		],
	};
	t.false(isDirectoryTrusted(dir, preferences));
	t.is(trustRecheck(dir, preferences), 'upgrade');
	t.is(
		trustRecheck(dir, {
			trustedDirectories: [{path: dir, fingerprint: 'stale'}],
		}),
		'changed',
	);
});

test('directoryTrustRefusal is null when bypassed or already trusted', t => {
	const deps = {
		loadPreferences: () => ({trustedDirectories: []}),
		savePreferences: () => {
			t.fail('should not persist');
		},
	};
	t.is(directoryTrustRefusal('/untrusted/project', true, deps), null);

	const dir = process.cwd();
	t.is(
		directoryTrustRefusal(dir, false, {
			...deps,
			loadPreferences: () => ({
				trustedDirectories: [
					{path: dir, fingerprint: describeProjectTrust(dir).fingerprint},
				],
			}),
		}),
		null,
	);
});

test('trust checks skip malformed entries instead of throwing', t => {
	const dir = process.cwd();
	const preferences = {
		trustedDirectories: [null, {}, {path: 5}, 7],
	} as unknown as UserPreferences;
	t.false(isDirectoryTrusted(dir, preferences));
	t.is(trustRecheck(dir, preferences), null);
	const granted = grantDirectoryTrust(preferences, dir);
	t.true(isDirectoryTrusted(dir, granted));
});

test.serial(
	'ensureDirectoryTrust with NANOCODER_TRUST_DIRECTORY=1 trusts and persists a new entry',
	t => {
		process.env.NANOCODER_TRUST_DIRECTORY = '1';
		let savedPreferences: UserPreferences | null = null;
		try {
			const target = join(tmpdir(), 'nanocoder-untrusted-project');
			const result = ensureDirectoryTrust(target, false, {
				loadPreferences: () => ({trustedDirectories: []}),
				savePreferences: prefs => {
					savedPreferences = prefs;
				},
			});
			t.true(result.trusted);
			t.true(result.persisted);
			t.deepEqual(savedPreferences?.trustedDirectories, [
				{
					path: target,
					fingerprint: describeProjectTrust(target).fingerprint,
					fingerprintVersion: TRUST_FINGERPRINT_VERSION,
				},
			]);
		} finally {
			delete process.env.NANOCODER_TRUST_DIRECTORY;
		}
	},
);

test.serial(
	'ensureDirectoryTrust with NANOCODER_TRUST_DIRECTORY=1 does not duplicate an already-trusted directory',
	t => {
		process.env.NANOCODER_TRUST_DIRECTORY = '1';
		try {
			const dir = process.cwd();
			let saveCalled = false;
			const result = ensureDirectoryTrust(dir, false, {
				loadPreferences: () => ({
					trustedDirectories: [
						{
							path: dir,
							fingerprint: describeProjectTrust(dir).fingerprint,
						},
					],
				}),
				savePreferences: () => {
					saveCalled = true;
				},
			});
			t.deepEqual(result, {trusted: true, persisted: false});
			t.false(saveCalled);
		} finally {
			delete process.env.NANOCODER_TRUST_DIRECTORY;
		}
	},
);

test.serial(
	'ensureDirectoryTrust with NANOCODER_TRUST_DIRECTORY=1 replaces a path-only entry',
	t => {
		process.env.NANOCODER_TRUST_DIRECTORY = '1';
		let savedPreferences: UserPreferences | null = null;
		try {
			const dir = process.cwd();
			const result = ensureDirectoryTrust(dir, false, {
				loadPreferences: () => ({trustedDirectories: [dir]}),
				savePreferences: prefs => {
					savedPreferences = prefs;
				},
			});
			t.true(result.trusted);
			t.true(result.persisted);
			t.deepEqual(savedPreferences?.trustedDirectories, [
				{
					path: dir,
					fingerprint: describeProjectTrust(dir).fingerprint,
					fingerprintVersion: TRUST_FINGERPRINT_VERSION,
				},
			]);
		} finally {
			delete process.env.NANOCODER_TRUST_DIRECTORY;
		}
	},
);

