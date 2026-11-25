import test from 'ava';
import {
	getSessionContextLimit,
	resetSessionContextLimit,
	setSessionContextLimit,
} from '@/models/models-dev-client';
import {
	applyTuneCompaction,
	autoCompactSessionOverrides,
	resetAutoCompactSession,
	resolveAutoCompactSettings,
	setAutoCompactThreshold,
} from '@/conversation/compaction/auto-compact';
import {compressionBackup} from '@/conversation/compaction/compression-backup';
import {getLastBuiltPrompt, setLastBuiltPrompt} from '@/conversation/prompt-builder';
import {
	createSessionContext,
	defineSessionValue,
	runInSessionContext,
} from './session-context';

console.log('\nservices/session-context.spec.ts');

const config = {enabled: true, threshold: 70, mode: 'default' as const};

test.serial('a session value is kept apart per session and from the process', t => {
	const value = defineSessionValue<number>(n => (n !== null && n > 0 ? n : null));
	const a = createSessionContext('/tmp/a');
	const b = createSessionContext('/tmp/b');

	value.set(1);
	runInSessionContext(a, () => value.set(2));
	runInSessionContext(b, () => value.set(-5));

	t.is(value.get(), 1);
	t.is(
		runInSessionContext(a, () => value.get()),
		2,
	);
	t.is(
		runInSessionContext(b, () => value.get()),
		null,
		'normalize still runs',
	);
	runInSessionContext(a, () => value.reset());
	t.is(
		runInSessionContext(a, () => value.get()),
		null,
	);
	t.is(value.get(), 1, 'a session reset leaves the process value');
	value.reset();
});

test.serial('/compact and context-limit overrides stay in their session', t => {
	const session = createSessionContext('/tmp/a');
	try {
		runInSessionContext(session, () => {
			setAutoCompactThreshold(55);
			setSessionContextLimit(8000);
		});

		t.is(autoCompactSessionOverrides.threshold, null);
		t.is(getSessionContextLimit(), null);
		t.is(resolveAutoCompactSettings(config).threshold, 70);
		runInSessionContext(session, () => {
			t.is(autoCompactSessionOverrides.threshold, 55);
			t.is(getSessionContextLimit(), 8000);
			t.is(resolveAutoCompactSettings(config).threshold, 55);
		});
	} finally {
		runInSessionContext(session, () => {
			resetAutoCompactSession();
			resetSessionContextLimit();
		});
	}
});

test.serial("one session's tune preset does not change another's compaction", t => {
	const tuned = createSessionContext('/tmp/a');
	const plain = createSessionContext('/tmp/b');
	runInSessionContext(tuned, () =>
		applyTuneCompaction({enabled: true, aggressiveCompact: true} as never),
	);

	t.is(
		runInSessionContext(tuned, () => resolveAutoCompactSettings(config).mode),
		'aggressive',
	);
	t.is(
		runInSessionContext(plain, () => resolveAutoCompactSettings(config).mode),
		'default',
	);
	t.is(resolveAutoCompactSettings(config).mode, 'default');
});

test.serial('the compression backup and last prompt belong to their session', t => {
	const a = createSessionContext('/tmp/a');
	const b = createSessionContext('/tmp/b');
	runInSessionContext(a, () => {
		compressionBackup.storeBackup([{role: 'user', content: 'from a'}]);
		setLastBuiltPrompt('prompt a');
	});

	runInSessionContext(b, () => {
		t.false(compressionBackup.hasBackup());
		t.is(compressionBackup.restore(), null);
		t.not(getLastBuiltPrompt(), 'prompt a');
	});
	runInSessionContext(a, () => {
		t.deepEqual(compressionBackup.restore(), [
			{role: 'user', content: 'from a'},
		]);
		t.is(getLastBuiltPrompt(), 'prompt a');
		compressionBackup.clearBackup();
		t.false(compressionBackup.hasBackup());
	});
});
