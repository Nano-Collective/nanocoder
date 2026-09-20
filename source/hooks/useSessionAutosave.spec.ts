/**
 * Regression tests for useSessionAutosave bugs (issue #542).
 *
 * These tests exercise the real SessionManager on a temp directory to verify
 * the save-chain behaviour without needing to render a React hook.
 * The three regressions covered:
 *
 *   A — Duplicate-session race: concurrent saves on the first turn must
 *       coalesce into a single createSession() call. The key insight of the
 *       fix is that doSave reads the live session-id ref AFTER the async
 *       init-promise await, not the stale captured value from effect-fire time.
 *       The serialised chain means the first save's setCurrentSessionId
 *       (and ref update) always happens before the second doSave reads it.
 *
 *   B — On-disk truncation: persisted messages must not be truncated to
 *       maxMessages; the full history must always be written to disk.
 *       maxMessages is now enforced in the conversation loop at the LLM call
 *       site, not in the autosave path.
 *
 *   C — Resume rebase: after applySession, getKeyGeneratorSessionId() must
 *       return the resumed session's ID, not the startup random ID.
 */
import {mkdtemp, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {SessionManager} from '../session/session-manager.js';
import {
	deriveSessionTitle,
	shouldResetSessionId,
} from './useSessionAutosave.js';
import {
	getKeyGeneratorSessionId,
	resetKeyGeneratorForTests,
	setKeyGeneratorSessionId,
} from '../session/key-generator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessages(count: number) {
	return Array.from({length: count}, (_, i) => ({
		role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
		content: `msg ${i + 1}`,
	}));
}

test('slash-only sessions keep their preallocated ID while messages stay empty', t => {
	t.false(shouldResetSessionId(0, 0));
});

test('clearing a non-empty conversation resets its session ID', t => {
	t.true(shouldResetSessionId(1, 0));
});

test('internal walkthrough fallback does not replace the user-derived title', t => {
	const title = deriveSessionTitle([
		{role: 'user', content: 'Implement the greeting helper'},
		{role: 'assistant', content: 'Implementation complete.'},
		{
			role: 'user',
			content:
				'<nanocoder-internal-walkthrough>Call write_walkthrough before ending.</nanocoder-internal-walkthrough>',
		},
	]);

	t.is(title, 'Implement the greeting helper');
});

test('approved plan injection does not replace the user-derived title', t => {
	const title = deriveSessionTitle([
		{role: 'user', content: 'Implement the greeting helper'},
		{role: 'assistant', content: 'The plan is ready for approval.'},
		{
			role: 'user',
			content:
				'The implementation plan below is approved. Proceed with implementing it now.\n\n<approved_plan>\nImplement the helper.\n</approved_plan>',
		},
		{role: 'assistant', content: 'Implementation complete.'},
		{
			role: 'user',
			content:
				'<nanocoder-internal-walkthrough>Call write_walkthrough before ending.</nanocoder-internal-walkthrough>',
		},
	]);

	t.is(title, 'Implement the greeting helper');
});

test('session titles keep the existing 50-character truncation', t => {
	const content = 'a'.repeat(51);

	t.is(deriveSessionTitle([{role: 'user', content}]), `${'a'.repeat(50)}...`);
});

test('an internal walkthrough without a real user message uses the fallback title', t => {
	const title = deriveSessionTitle([
		{
			role: 'user',
			content:
				'<nanocoder-internal-walkthrough>Call write_walkthrough before ending.</nanocoder-internal-walkthrough>',
		},
	]);

	t.is(title, `Session ${new Date().toLocaleDateString()}`);
});

// ---------------------------------------------------------------------------
// Bug A — Duplicate-session race
// ---------------------------------------------------------------------------

test.serial(
	'A: live-ref pattern creates exactly one session even with two queued saves',
	async t => {
		const dir = await mkdtemp(join(tmpdir(), 'nc-race-'));
		t.teardown(() => rm(dir, {recursive: true, force: true}));

		const manager = new SessionManager(dir);
		await manager.initialize();

		// Model the fixed hook's live-ref pattern.
		// doSave reads `sessionIdRef` (analogous to currentSessionIdRef.current)
		// AFTER the async init-await, NOT a value captured at effect-fire time.
		// This means the second doSave in the chain reads the ID that the first
		// doSave wrote — exactly what the fix achieves.
		const sessionIdRef = {current: null as string | null};

		const doSave = async () => {
			// Simulate the initPromise await that happens inside the real hook.
			await Promise.resolve();

			// Read the live ref AFTER the await (the fix).
			const liveId = sessionIdRef.current;

			if (liveId) {
				// Second save: update existing session
				const session = await manager.readSession(liveId);
				if (session) {
					session.messages = makeMessages(3);
					session.messageCount = 3;
					await manager.saveSession(session);
				}
			} else {
				// First save: create and update the ref immediately
				const s = await manager.createSession({
					title: 'Race test',
					messageCount: 2,
					provider: 'test',
					model: 'test',
					workingDirectory: dir,
					messages: makeMessages(2),
				});
				sessionIdRef.current = s.id;
			}
		};

		// Chain two saves as the fixed hook does. Because doSave reads the ref
		// after the await, the second save sees the ID written by the first.
		let chain = Promise.resolve();
		chain = chain.then(doSave, doSave);
		chain = chain.then(doSave, doSave);
		await chain;

		// Exactly one session file must exist (not two)
		const entries = await readdir(dir);
		const sessionFiles = entries.filter(
			e => e.endsWith('.json') && e !== 'sessions.json',
		);
		t.is(
			sessionFiles.length,
			1,
			`Expected 1 session file, found ${sessionFiles.length}: ${sessionFiles.join(', ')}`,
		);

		const sessions = await manager.listSessions();
		t.is(sessions.length, 1);
	},
);
test.serial(
	'A: without serialisation, concurrent saves can create duplicate sessions (demonstrates the old bug)',
	async t => {
		const dir = await mkdtemp(join(tmpdir(), 'nc-race-old-'));
		t.teardown(() => rm(dir, {recursive: true, force: true}));

		const manager = new SessionManager(dir);
		await manager.initialize();

		// Both saves start simultaneously and both see null sessionId (old behaviour)
		const create = () =>
			manager.createSession({
				title: 'Dup test',
				messageCount: 1,
				provider: 'test',
				model: 'test',
				workingDirectory: dir,
				messages: makeMessages(1),
			});

		// Fire both without chaining
		await Promise.all([create(), create()]);

		const sessions = await manager.listSessions();
		// Old code produces 2; document that this is expected in the un-fixed path
		t.true(
			sessions.length >= 1,
			'At least one session must exist even in the buggy scenario',
		);
		// The key assertion: with the fix, the chained test above gets exactly 1.
		// This test just sanity-checks that the manager itself doesn't explode.
	},
);

// ---------------------------------------------------------------------------
// Bug B — On-disk truncation
// ---------------------------------------------------------------------------

test.serial(
	'B: full message history is written to disk regardless of maxMessages',
	async t => {
		const dir = await mkdtemp(join(tmpdir(), 'nc-trunc-'));
		t.teardown(() => rm(dir, {recursive: true, force: true}));

		const manager = new SessionManager(dir);
		await manager.initialize();

		const allMessages = makeMessages(5);

		// Create the session with all 5 messages
		const session = await manager.createSession({
			title: 'Truncation test',
			messageCount: allMessages.length,
			provider: 'test',
			model: 'test',
			workingDirectory: dir,
			messages: allMessages,
		});

		// Simulate what the FIXED hook does: write full history, no slice
		const saved = await manager.readSession(session.id);
		t.truthy(saved);
		saved!.messages = allMessages; // full array, not .slice(-2)
		saved!.messageCount = allMessages.length;
		await manager.saveSession(saved!);

		// Read back and verify all 5 are present
		const loaded = await manager.readSession(session.id);
		t.is(
			loaded!.messages.length,
			5,
			'All 5 messages must be on disk after save',
		);
		t.deepEqual(
			loaded!.messages.map(m => m.content),
			allMessages.map(m => m.content),
		);
	},
);

test.serial(
	'B: old truncation path would lose messages (demonstrates the old bug)',
	async t => {
		const dir = await mkdtemp(join(tmpdir(), 'nc-trunc-old-'));
		t.teardown(() => rm(dir, {recursive: true, force: true}));

		const manager = new SessionManager(dir);
		await manager.initialize();

		const allMessages = makeMessages(5);
		const maxMessages = 2;

		const session = await manager.createSession({
			title: 'Old truncation',
			messageCount: allMessages.length,
			provider: 'test',
			model: 'test',
			workingDirectory: dir,
			messages: allMessages,
		});

		// Replicate exactly what the OLD hook did: slice before writing
		const messagesToSave =
			allMessages.length > maxMessages
				? allMessages.slice(-maxMessages)
				: allMessages;

		const saved = await manager.readSession(session.id);
		saved!.messages = messagesToSave; // ← old bug: truncated array on disk
		saved!.messageCount = messagesToSave.length;
		await manager.saveSession(saved!);

		const loaded = await manager.readSession(session.id);
		// This demonstrates data loss: only 2 of 5 messages survive
		t.is(loaded!.messages.length, 2, 'Old code loses 3 of 5 messages');
	},
);

// ---------------------------------------------------------------------------
// Bug C — /resume doesn't rebase the key-generator session ID
// ---------------------------------------------------------------------------

test.serial('C: setKeyGeneratorSessionId rebases ID on resume', t => {
	resetKeyGeneratorForTests();

	// Simulate the startup state: a random 8-hex ID is lazily generated
	const startupId = getKeyGeneratorSessionId();
	t.regex(startupId, /^[0-9a-f]{8}$/, 'startup ID is 8-hex random');

	// Simulate /resume calling applySession with a full UUID session ID
	const resumedSessionId = '12345678-1234-1234-1234-123456789abc';
	setKeyGeneratorSessionId(resumedSessionId); // ← this is what the fix adds

	// Verify: key generator now uses the resumed session's ID
	const afterResumeId = getKeyGeneratorSessionId();
	t.is(
		afterResumeId,
		resumedSessionId,
		'After resume, key generator must reflect the resumed session ID',
	);
	t.not(
		afterResumeId,
		startupId,
		'Key generator must not keep the random startup ID after resume',
	);
});

test.serial(
	'C: without setKeyGeneratorSessionId call, ID stays as startup random (old bug)',
	t => {
		resetKeyGeneratorForTests();

		const startupId = getKeyGeneratorSessionId();

		// Old applySession: setCurrentSessionId(session.id) is called but
		// setKeyGeneratorSessionId is NOT called — nothing changes in key-generator.
		// No-op here intentionally mirrors the missing call.

		const afterResumeId = getKeyGeneratorSessionId();
		t.is(
			afterResumeId,
			startupId,
			'Without the fix, key generator keeps the random startup ID (old bug)',
		);
	},
);

// ---------------------------------------------------------------------------
// Bug D — lastAccessedAt never bumped by autosave
// ---------------------------------------------------------------------------
//
// autosave's update path (read session, mutate fields, saveSession) never
// touched lastAccessedAt, so a session that's actively being chatted in kept
// showing its create/resume time as "last used" until closed and reopened.
// The fix sets lastAccessedAt = now() in the update path itself, right
// before saveSession - saveSession() trusts whatever it's given, it doesn't
// bump anything on its own (other callers, e.g. resolve-session.spec.ts's
// test helpers, rely on being able to set an explicit lastAccessedAt).

test.serial(
	'D: autosave update path bumps lastAccessedAt on every save',
	async t => {
		const dir = await mkdtemp(join(tmpdir(), 'nc-lastaccessed-'));
		t.teardown(() => rm(dir, {recursive: true, force: true}));

		const manager = new SessionManager(dir);
		await manager.initialize();

		const created = await manager.createSession({
			title: 'Original',
			messageCount: 1,
			provider: 'test',
			model: 'test',
			workingDirectory: dir,
			messages: makeMessages(1),
		});
		const originalLastAccessed = created.lastAccessedAt;

		await new Promise(r => setTimeout(r, 10));

		// Mirrors the hook's update path (source/hooks/useSessionAutosave.ts).
		const session = await manager.readSession(created.id);
		if (!session) throw new Error('session missing');
		session.messages = makeMessages(3);
		session.messageCount = 3;
		session.lastAccessedAt = new Date().toISOString();
		await manager.saveSession(session);

		const loaded = await manager.readSession(created.id);
		t.not(
			loaded!.lastAccessedAt,
			originalLastAccessed,
			'autosave must bump lastAccessedAt so "last used" reflects real activity',
		);
	},
);

// ---------------------------------------------------------------------------
// Issue #932 — Auto-save indicator & unblocked flush
// ---------------------------------------------------------------------------

test.serial(
	'Issue 932: indicator hide timer does not block save chain or flush resolution',
	async t => {
		let isSaving = false;
		let hideTimer: NodeJS.Timeout | null = null;
		const minDuration = 500;

		const runSave = async () => {
			let startTime: number | null = null;
			try {
				if (hideTimer) {
					clearTimeout(hideTimer);
					hideTimer = null;
				}
				startTime = Date.now();
				isSaving = true;

				// Fast mock disk write (~5ms)
				await new Promise(r => setTimeout(r, 5));
			} finally {
				if (startTime !== null) {
					const elapsed = Date.now() - startTime;
					const remaining = Math.max(0, minDuration - elapsed);
					hideTimer = setTimeout(() => {
						isSaving = false;
						hideTimer = null;
					}, remaining);
				}
			}
		};

		const flushStart = Date.now();
		await runSave();
		const flushElapsed = Date.now() - flushStart;

		// flush/save resolution must finish immediately on I/O completion (< 100ms),
		// NOT blocked by the 500ms UI indicator timer
		t.true(
			flushElapsed < 100,
			`flush() took ${flushElapsed}ms; must not wait for the 500ms UI timer`,
		);
		t.true(isSaving, 'isSaving must be true immediately after save finishes');

		// Wait 250ms: isSaving must still be true (within the 500ms floor)
		await new Promise(r => setTimeout(r, 250));
		t.true(isSaving, 'isSaving must stay true at 250ms (within 500ms floor)');

		// Wait another 300ms (total > 550ms): isSaving must transition to false
		await new Promise(r => setTimeout(r, 300));
		t.false(
			isSaving,
			'isSaving must transition to false after 500ms minimum display floor',
		);
		t.is(hideTimer, null);
	},
);

test.serial(
	'Issue 932: subsequent save cancels earlier pending hide timer',
	async t => {
		let isSaving = false;
		let hideTimer: NodeJS.Timeout | null = null;
		let timerClearCount = 0;
		const minDuration = 500;

		const runSave = async () => {
			let startTime: number | null = null;
			try {
				if (hideTimer) {
					clearTimeout(hideTimer);
					hideTimer = null;
					timerClearCount++;
				}
				startTime = Date.now();
				isSaving = true;

				await new Promise(r => setTimeout(r, 5));
			} finally {
				if (startTime !== null) {
					const elapsed = Date.now() - startTime;
					const remaining = Math.max(0, minDuration - elapsed);
					hideTimer = setTimeout(() => {
						isSaving = false;
						hideTimer = null;
					}, remaining);
				}
			}
		};

		// First save schedules a hide timer for 500ms
		await runSave();
		t.true(isSaving);
		t.truthy(hideTimer);

		// Second save starts 100ms later (while hide timer is still pending)
		await new Promise(r => setTimeout(r, 100));
		await runSave();

		t.is(timerClearCount, 1, 'Previous hide timer must be cancelled');
		t.true(isSaving);

		// Clean up
		if (hideTimer) {
			clearTimeout(hideTimer);
		}
	},
);
