import test from 'ava';
import {AcpStateManager, ACPStatus} from './acp-state';

test('AcpStateManager - fires onDidChangeStatus with status and detail', (t) => {
	const manager = new AcpStateManager();
	const seen: {status: ACPStatus; detail?: unknown}[] = [];
	manager.onDidChangeStatus((event) => seen.push(event));

	manager.setStatus(ACPStatus.Starting);
	t.deepEqual(seen, [{status: ACPStatus.Starting, detail: undefined}]);

	manager.setStatus(ACPStatus.Restarting, {attempt: 2, totalAttempts: 5});
	t.deepEqual(seen[1], {
		status: ACPStatus.Restarting,
		detail: {attempt: 2, totalAttempts: 5},
	});

	t.is(manager.status, ACPStatus.Restarting);
	t.deepEqual(manager.detail, {attempt: 2, totalAttempts: 5});
});

test('AcpStateManager - does not fire for identical status without detail', (t) => {
	const manager = new AcpStateManager();
	let fired = 0;
	manager.onDidChangeStatus(() => fired++);

	manager.setStatus(ACPStatus.Starting);
	manager.setStatus(ACPStatus.Starting);

	t.is(fired, 1, 'Same status, no detail: no second event');
});

test('AcpStateManager - refires when detail is provided even for same status', (t) => {
	const manager = new AcpStateManager();
	let fired = 0;
	manager.onDidChangeStatus(() => fired++);

	manager.setStatus(ACPStatus.Restarting, {attempt: 1, totalAttempts: 5});
	manager.setStatus(ACPStatus.Restarting, {attempt: 2, totalAttempts: 5});

	t.is(fired, 2, 'Attempt 2/5 must be observable even though the status string is unchanged');
	t.is((manager.detail as {attempt: number}).attempt, 2);
});
