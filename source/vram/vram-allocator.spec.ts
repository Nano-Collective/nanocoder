import test from 'ava';
import {VramAllocator} from './vram-allocator';

test('VramAllocator initializes with default balanced strategy and idle phase', t => {
	const allocator = new VramAllocator();
	t.is(allocator.getCurrentPhase(), 'idle');
	t.is(allocator.getConfig().strategy, 'balanced');
	t.true(allocator.getConfig().unloadOnExecution);
});

test('VramAllocator tracks registered model roles', t => {
	const allocator = new VramAllocator();
	allocator.registerModel('deepseek-coder:33b', 'coder');
	allocator.registerModel('nomic-embed-text', 'embedder');

	const states = allocator.getResidencyStates();
	t.is(states.length, 2);
	t.is(states.find(s => s.model === 'deepseek-coder:33b')?.role, 'coder');
	t.is(states.find(s => s.model === 'nomic-embed-text')?.role, 'embedder');
});

test('VramAllocator phase transitions update current phase and residency', async t => {
	const allocator = new VramAllocator({strategy: 'balanced'});
	allocator.registerModel('deepseek-coder:33b', 'coder');
	allocator.registerModel('nomic-embed-text', 'embedder');

	// Transition to retrieval
	await allocator.transitionPhase('retrieval');
	t.is(allocator.getCurrentPhase(), 'retrieval');
	const embedder = allocator
		.getResidencyStates()
		.find(s => s.model === 'nomic-embed-text');
	t.true(embedder?.isLoaded);

	// Transition to generation
	await allocator.transitionPhase('generation', {model: 'deepseek-coder:33b'});
	t.is(allocator.getCurrentPhase(), 'generation');
	t.false(
		allocator
			.getResidencyStates()
			.find(s => s.model === 'nomic-embed-text')?.isLoaded,
	);
	t.true(
		allocator
			.getResidencyStates()
			.find(s => s.model === 'deepseek-coder:33b')?.isLoaded,
	);

	// Transition to execution (execute_bash)
	await allocator.transitionPhase('execution', {toolName: 'execute_bash'});
	t.is(allocator.getCurrentPhase(), 'execution');
	t.false(
		allocator
			.getResidencyStates()
			.find(s => s.model === 'deepseek-coder:33b')?.isLoaded,
	);
});

test('VramAllocator respects disabled strategy', async t => {
	const allocator = new VramAllocator({strategy: 'disabled'});
	allocator.registerModel('my-model', 'coder');

	await allocator.transitionPhase('generation', {model: 'my-model'});
	t.is(allocator.getCurrentPhase(), 'generation');
	// State remains unchanged because allocator is disabled
	t.false(allocator.getResidencyStates()[0].isLoaded);
});
