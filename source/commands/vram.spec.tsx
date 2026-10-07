import test from 'ava';
import React from 'react';
import {getVramAllocator, resetVramAllocator} from '@/vram/vram-allocator';
import {vramCommand} from './vram';

test.beforeEach(() => {
	resetVramAllocator();
});

test.serial('vramCommand displays status view by default', async t => {
	const result = await vramCommand.handler([], [], {
		provider: 'ollama',
		model: 'qwen2.5-coder:7b',
		tokens: 0,
		getMessageTokens: () => 0,
	});

	t.truthy(result);
	t.true(React.isValidElement(result));
	const allocator = getVramAllocator();
	t.is(allocator.getResidencyStates().length, 1);
});

test.serial('vramCommand handles mode subcommand', async t => {
	const result = await vramCommand.handler(['mode', 'aggressive'], [], {
		provider: 'ollama',
		model: 'qwen2.5-coder:7b',
		tokens: 0,
		getMessageTokens: () => 0,
	});

	t.truthy(result);
	const allocator = getVramAllocator();
	t.is(allocator.getConfig().strategy, 'aggressive');
});

test.serial('vramCommand handles invalid mode subcommand', async t => {
	const result = await vramCommand.handler(['mode', 'invalid_mode'], [], {
		provider: 'ollama',
		model: 'qwen2.5-coder:7b',
		tokens: 0,
		getMessageTokens: () => 0,
	});

	t.truthy(result);
});

test.serial('vramCommand handles unload subcommand', async t => {
	const allocator = getVramAllocator();
	allocator.registerModel('model-a', 'coder');

	const result = await vramCommand.handler(['unload', 'model-a'], [], {
		provider: 'ollama',
		model: 'model-a',
		tokens: 0,
		getMessageTokens: () => 0,
	});

	t.truthy(result);
});
