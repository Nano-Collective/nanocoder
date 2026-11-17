/**
 * Frame-based RMS speech detector, kept free of I/O so it can be unit-tested.
 *
 * Input is 16 kHz 16-bit mono PCM in fixed-size frames. Durations are counted
 * in audio time (frames), not wall-clock time, so results do not depend on how
 * the microphone stream is chunked.
 *
 * A frame above `speechThreshold` opens an onset. The onset is confirmed as
 * speech only once it has lasted `minSpeechDurationMs` without dropping below
 * `silenceThreshold`; a shorter burst (a cough, a door, a keyboard clack) is
 * discarded into the pre-roll and never reported. This matters because
 * `speech_start` can cancel an in-flight agent run.
 */

export interface SpeechDetectorOptions {
	speechThreshold?: number;
	silenceThreshold?: number;
	silenceDurationMs?: number;
	minSpeechDurationMs?: number;
	maxSpeechDurationMs?: number;
	preRollFrames?: number;
	sampleRate?: number;
}

export type SpeechDetectorEvent =
	| {type: 'speech_start'}
	| {type: 'speech_final'; pcm: Buffer};

export function calculateRms(frame: Buffer): number {
	let sum = 0;
	const count = frame.length / 2;
	for (let i = 0; i + 1 < frame.length; i += 2) {
		const sample = frame.readInt16LE(i);
		sum += sample * sample;
	}
	return Math.sqrt(sum / (count || 1));
}

export class SpeechDetector {
	private readonly speechThreshold: number;
	private readonly silenceThreshold: number;
	private readonly silenceDurationMs: number;
	private readonly minSpeechDurationMs: number;
	private readonly maxSpeechDurationMs: number;
	private readonly preRollFrames: number;
	private readonly sampleRate: number;

	private preRoll: Buffer[] = [];
	private onset: Buffer[] = [];
	private onsetMs = 0;
	private utterance: Buffer[] = [];
	private speaking = false;
	private speechMs = 0;
	private silenceMs = 0;

	constructor(options: SpeechDetectorOptions = {}) {
		this.speechThreshold = options.speechThreshold ?? 1500;
		this.silenceThreshold = options.silenceThreshold ?? 800;
		this.silenceDurationMs = options.silenceDurationMs ?? 1000;
		this.minSpeechDurationMs = options.minSpeechDurationMs ?? 300;
		this.maxSpeechDurationMs = options.maxSpeechDurationMs ?? 30_000;
		this.preRollFrames = options.preRollFrames ?? 5;
		this.sampleRate = options.sampleRate ?? 16_000;
	}

	process(frame: Buffer): SpeechDetectorEvent[] {
		const frameMs = (frame.length / 2 / this.sampleRate) * 1000;
		const rms = calculateRms(frame);
		const copy = Buffer.from(frame);

		if (this.speaking) {
			this.utterance.push(copy);
			this.speechMs += frameMs;
			if (rms < this.silenceThreshold) {
				this.silenceMs += frameMs;
			} else {
				this.silenceMs = 0;
			}
			if (
				this.speechMs >= this.maxSpeechDurationMs ||
				this.silenceMs >= this.silenceDurationMs
			) {
				return [this.finalize()];
			}
			return [];
		}

		if (this.onset.length > 0) {
			if (rms < this.silenceThreshold) {
				// Too short to be speech: fold it back into the pre-roll.
				for (const f of this.onset) this.pushPreRoll(f);
				this.onset = [];
				this.onsetMs = 0;
				this.pushPreRoll(copy);
				return [];
			}
			this.onset.push(copy);
			this.onsetMs += frameMs;
			return this.maybeConfirm();
		}

		if (rms > this.speechThreshold) {
			this.onset.push(copy);
			this.onsetMs = frameMs;
			return this.maybeConfirm();
		}

		this.pushPreRoll(copy);
		return [];
	}

	private maybeConfirm(): SpeechDetectorEvent[] {
		if (this.onsetMs < this.minSpeechDurationMs) return [];
		this.speaking = true;
		this.utterance = [...this.preRoll, ...this.onset];
		this.speechMs = this.onsetMs;
		this.silenceMs = 0;
		this.preRoll = [];
		this.onset = [];
		this.onsetMs = 0;
		return [{type: 'speech_start'}];
	}

	private finalize(): SpeechDetectorEvent {
		const pcm = Buffer.concat(this.utterance);
		this.utterance = [];
		this.speaking = false;
		this.speechMs = 0;
		this.silenceMs = 0;
		return {type: 'speech_final', pcm};
	}

	private pushPreRoll(frame: Buffer): void {
		this.preRoll.push(frame);
		if (this.preRoll.length > this.preRollFrames) this.preRoll.shift();
	}
}
