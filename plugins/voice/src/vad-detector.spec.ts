import test from 'ava';
import {SpeechDetector, calculateRms} from './vad-detector.js';

// 512 samples at 16 kHz = 32 ms per frame.
const FRAME_SAMPLES = 512;

function frame(amplitude: number): Buffer {
	const buf = Buffer.alloc(FRAME_SAMPLES * 2);
	for (let i = 0; i < FRAME_SAMPLES; i++) {
		buf.writeInt16LE(i % 2 === 0 ? amplitude : -amplitude, i * 2);
	}
	return buf;
}

const LOUD = frame(4000);
const QUIET = frame(100);

function feed(detector: SpeechDetector, f: Buffer, count: number) {
	const events = [];
	for (let i = 0; i < count; i++) events.push(...detector.process(f));
	return events;
}

test('calculateRms of a square wave equals its amplitude', t => {
	t.is(Math.round(calculateRms(LOUD)), 4000);
	t.is(calculateRms(Buffer.alloc(0)), 0);
});

test('a burst shorter than minSpeechDurationMs never reports speech_start', t => {
	const detector = new SpeechDetector({minSpeechDurationMs: 300});
	// ~96 ms cough, then silence well past silenceDurationMs.
	const events = [...feed(detector, LOUD, 3), ...feed(detector, QUIET, 60)];
	t.deepEqual(events, []);
});

test('sustained speech reports speech_start once the minimum duration is reached', t => {
	const detector = new SpeechDetector({minSpeechDurationMs: 300});
	// 9 frames = 288 ms: still below the minimum.
	t.deepEqual(feed(detector, LOUD, 9), []);
	// The 10th frame crosses 300 ms.
	t.deepEqual(detector.process(LOUD), [{type: 'speech_start'}]);
	t.deepEqual(feed(detector, LOUD, 5), []);
});

test('speech_final carries pre-roll and onset audio, after silenceDurationMs', t => {
	const detector = new SpeechDetector({
		minSpeechDurationMs: 300,
		silenceDurationMs: 1000,
		preRollFrames: 5,
	});
	feed(detector, QUIET, 20);
	feed(detector, LOUD, 15);
	// 31 quiet frames = 992 ms: not yet final.
	t.deepEqual(feed(detector, QUIET, 31), []);
	const events = detector.process(QUIET);
	t.is(events.length, 1);
	const final = events[0]!;
	t.is(final.type, 'speech_final');
	if (final.type !== 'speech_final') return;
	// 5 pre-roll + 15 speech + 32 trailing silence frames.
	t.is(final.pcm.length, (5 + 15 + 32) * FRAME_SAMPLES * 2);
});

test('a dropped onset is kept as pre-roll for the next utterance', t => {
	const detector = new SpeechDetector({minSpeechDurationMs: 300, preRollFrames: 5});
	feed(detector, LOUD, 2);
	feed(detector, QUIET, 1);
	const events = feed(detector, LOUD, 10);
	t.deepEqual(events, [{type: 'speech_start'}]);
});

test('utterances are capped at maxSpeechDurationMs', t => {
	const detector = new SpeechDetector({
		minSpeechDurationMs: 64,
		maxSpeechDurationMs: 640,
	});
	const events = feed(detector, LOUD, 25);
	t.deepEqual(
		events.map(e => e.type),
		['speech_start', 'speech_final', 'speech_start'],
	);
});
