import test from 'ava';
import {
	BASE_FRAME_INTERVAL_MS,
	createStreamYielder,
	FRAME_LAG_THRESHOLD_MS,
	FRAME_RECOVERY_FRAMES,
	type FrameClock,
	MAX_FRAME_INTERVAL_MS,
	STREAM_SLICE_BUDGET_MS,
	StreamFramer,
} from './stream-frames';

/**
 * A clock whose timers only fire when the test advances it. `lagMs` makes a
 * timer fire that much later than scheduled, as a busy event loop would.
 */
function fakeClock() {
	let now = 0;
	let nextId = 0;
	const timers = new Map<number, {at: number; callback: () => void}>();
	const clock: FrameClock = {
		now: () => now,
		setTimeout: (callback, ms) => {
			const id = ++nextId;
			timers.set(id, {at: now + ms, callback});
			return id;
		},
		clearTimeout: handle => {
			timers.delete(handle as number);
		},
	};
	return {
		clock,
		pending: () => timers.size,
		/** Move time forward by `ms`, firing due timers `lagMs` late. */
		advance(ms: number, lagMs = 0) {
			const target = now + ms;
			for (;;) {
				const due = [...timers].sort((a, b) => a[1].at - b[1].at).find(([, t]) => t.at <= target);
				if (!due) break;
				timers.delete(due[0]);
				now = due[1].at + lagMs;
				due[1].callback();
			}
			now = Math.max(now, target);
		},
	};
}

function recordingFramer(clock: FrameClock) {
	const frames: Array<[kind: string, text: string]> = [];
	const framer = new StreamFramer(
		{
			onText: text => frames.push(['text', text]),
			onReasoning: text => frames.push(['reasoning', text]),
		},
		clock,
	);
	return {framer, frames};
}

test('StreamFramer merges deltas into one frame per interval', t => {
	const {clock, advance} = fakeClock();
	const {framer, frames} = recordingFramer(clock);

	framer.push('text', 'Hel');
	framer.push('text', 'lo, ');
	framer.push('text', 'world');
	t.deepEqual(frames, [], 'nothing reaches the UI before the frame is due');

	advance(BASE_FRAME_INTERVAL_MS);
	t.deepEqual(frames, [['text', 'Hello, world']]);
});

test('StreamFramer keeps at most one frame pending', t => {
	const {clock, pending} = fakeClock();
	const {framer} = recordingFramer(clock);

	for (let i = 0; i < 100; i++) framer.push('text', 'x');

	t.is(pending(), 1);
});

test('StreamFramer hands over the other kind first when text and reasoning switch', t => {
	const {clock, advance} = fakeClock();
	const {framer, frames} = recordingFramer(clock);

	framer.push('reasoning', 'Thinking');
	framer.push('text', 'Answer');
	framer.push('reasoning', 'More thought');
	advance(BASE_FRAME_INTERVAL_MS);

	t.deepEqual(frames, [
		['reasoning', 'Thinking'],
		['text', 'Answer'],
		['reasoning', 'More thought'],
	]);
});

test('StreamFramer flush() hands over immediately and cancels the pending frame', t => {
	const {clock, advance, pending} = fakeClock();
	const {framer, frames} = recordingFramer(clock);

	framer.push('text', 'part one');
	framer.flush();
	t.deepEqual(frames, [['text', 'part one']]);
	t.is(pending(), 0);

	advance(BASE_FRAME_INTERVAL_MS * 4);
	t.deepEqual(frames, [['text', 'part one']], 'no empty or duplicate frame later');
});

test('StreamFramer never loses or reorders text across frames and flushes', t => {
	const {clock, advance} = fakeClock();
	const {framer, frames} = recordingFramer(clock);
	const sent = {text: '', reasoning: ''};

	for (let i = 0; i < 200; i++) {
		const kind = i % 17 < 5 ? 'reasoning' : 'text';
		const delta = `${kind[0]}${i} `;
		sent[kind] += delta;
		framer.push(kind, delta);
		if (i % 13 === 0) framer.flush();
		advance(i % 7, i % 3 === 0 ? 60 : 0);
	}
	framer.flush();

	const received = {text: '', reasoning: ''};
	for (const [kind, text] of frames) received[kind as 'text' | 'reasoning'] += text;
	t.deepEqual(received, sent);
});

test('StreamFramer ignores empty deltas', t => {
	const {clock, pending} = fakeClock();
	const {framer, frames} = recordingFramer(clock);

	framer.push('text', '');
	framer.flush();

	t.is(pending(), 0);
	t.deepEqual(frames, []);
});

test('StreamFramer backs the interval off while frames fire late, up to a ceiling', t => {
	const {clock, advance} = fakeClock();
	const {framer} = recordingFramer(clock);
	const intervals: number[] = [];

	for (let i = 0; i < 6; i++) {
		framer.push('text', 'x');
		advance(framer.frameIntervalMs, FRAME_LAG_THRESHOLD_MS + 20);
		intervals.push(framer.frameIntervalMs);
	}

	t.deepEqual(intervals, [100, 200, 400, 400, 400, 400]);
	t.is(intervals.at(-1), MAX_FRAME_INTERVAL_MS);
});

test('StreamFramer steps the interval back down after a run of on-time frames', t => {
	const {clock, advance} = fakeClock();
	const {framer} = recordingFramer(clock);
	const lateFrame = () => {
		framer.push('text', 'x');
		advance(framer.frameIntervalMs, FRAME_LAG_THRESHOLD_MS + 20);
	};
	const onTimeFrame = () => {
		framer.push('text', 'x');
		advance(framer.frameIntervalMs);
	};

	lateFrame();
	lateFrame();
	t.is(framer.frameIntervalMs, 200);

	for (let i = 0; i < FRAME_RECOVERY_FRAMES - 1; i++) onTimeFrame();
	t.is(framer.frameIntervalMs, 200, 'one calm frame is not enough to speed up again');
	onTimeFrame();
	t.is(framer.frameIntervalMs, 100);
	for (let i = 0; i < FRAME_RECOVERY_FRAMES; i++) onTimeFrame();
	t.is(framer.frameIntervalMs, BASE_FRAME_INTERVAL_MS);
	for (let i = 0; i < FRAME_RECOVERY_FRAMES; i++) onTimeFrame();
	t.is(framer.frameIntervalMs, BASE_FRAME_INTERVAL_MS, 'never below the base interval');
});

test('StreamFramer treats small timer jitter as on time', t => {
	const {clock, advance} = fakeClock();
	const {framer} = recordingFramer(clock);

	for (let i = 0; i < 5; i++) {
		framer.push('text', 'x');
		advance(framer.frameIntervalMs, FRAME_LAG_THRESHOLD_MS);
	}

	t.is(framer.frameIntervalMs, BASE_FRAME_INTERVAL_MS);
});

test('createStreamYielder yields only once a slice has used its budget', async t => {
	let now = 0;
	let yields = 0;
	const yieldIfDue = createStreamYielder({now: () => now}, STREAM_SLICE_BUDGET_MS, async () => {
		yields++;
	});

	for (let i = 0; i < 10; i++) {
		now += 1;
		await yieldIfDue();
	}
	t.is(yields, 0, 'quick chunks do not pay for a yield');

	now += STREAM_SLICE_BUDGET_MS;
	await yieldIfDue();
	t.is(yields, 1);

	await yieldIfDue();
	t.is(yields, 1, 'the next slice starts after the yield');
});

test('createStreamYielder really hands the event loop to pending timers', async t => {
	let timerRan = false;
	setTimeout(() => {
		timerRan = true;
	}, 0);
	let now = 0;
	const yieldIfDue = createStreamYielder({now: () => now});

	now = STREAM_SLICE_BUDGET_MS;
	await yieldIfDue();

	t.true(timerRan, 'a timer queued before the yield runs during it');
});
