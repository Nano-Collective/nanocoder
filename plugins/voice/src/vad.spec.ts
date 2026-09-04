import test from 'ava';
import { VadEngine, createVadEngine } from './vad.js';

test('createVadEngine returns VadEngine instance', (t) => {
	const engine = createVadEngine({ speechThreshold: 2000 });
	t.true(engine instanceof VadEngine);
});

test('VadEngine emits events correctly', async (t) => {
	const engine = new VadEngine();
	let startFired = false;
	let finalFired = false;

	engine.on('speech_start', () => {
		startFired = true;
	});
	engine.on('speech_final', ({ filePath }) => {
		finalFired = filePath === 'test.wav';
	});

	engine.emit('speech_start');
	engine.emit('speech_final', { filePath: 'test.wav' });

	t.true(startFired);
	t.true(finalFired);
});
