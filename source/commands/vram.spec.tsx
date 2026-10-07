import test from 'ava';
import React from 'react';
import {getVramAllocator, resetVramAllocator} from '@/vram/vram-allocator';
import {vramCommand} from './vram';

test.beforeEach(() => {
	resetVramAllocator();
});

test.afterEach(() => {
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
	t.is(allocator.getResidencyStates()[0].model, 'qwen2.5-coder:7b');
	t.is(allocator.getResidencyStates()[0].role, 'coder');
});

test.serial('vramCommand handles mode subcommand', async t => {
	const result = (await vramCommand.handler(['mode', 'aggressive'], [], {
		provider: 'ollama',
		model: 'qwen2.5-coder:7b',
		tokens: 0,
		getMessageTokens: () => 0,
	})) as React.ReactElement<{message: string}>;

	t.truthy(result);
	t.true(React.isValidElement(result));
	t.regex(result.props.message, /updated to 'aggressive'/);
	const allocator = getVramAllocator();
	t.is(allocator.getConfig().strategy, 'aggressive');
});

test.serial('vramCommand handles invalid mode subcommand', async t => {
	const result = (await vramCommand.handler(['mode', 'invalid_mode'], [], {
		provider: 'ollama',
		model: 'qwen2.5-coder:7b',
		tokens: 0,
		getMessageTokens: () => 0,
	})) as React.ReactElement<{message: string}>;

	t.truthy(result);
	t.true(React.isValidElement(result));
	t.regex(result.props.message, /Invalid strategy/);
});

test.serial('vramCommand handles unload subcommand with no tracked models', async t => {
	const result = (await vramCommand.handler(['unload'], [], {
		provider: 'ollama',
		tokens: 0,
		getMessageTokens: () => 0,
	})) as React.ReactElement<{message: string}>;

	t.truthy(result);
	t.true(React.isValidElement(result));
	t.regex(result.props.message, /No models tracked/);
});

test.serial('vramCommand handles unload subcommand with target model', async t => {
	const allocator = getVramAllocator();
	allocator.registerModel('model-a', 'coder');

	const result = (await vramCommand.handler(['unload', 'model-a'], [], {
		provider: 'ollama',
		model: 'model-a',
		tokens: 0,
		getMessageTokens: () => 0,
	})) as React.ReactElement<{message: string}>;

	t.truthy(result);
	t.true(React.isValidElement(result));
	t.regex(result.props.message, /Dispatched VRAM unload for model 'model-a'/);
});

test.serial('vramCommand handles unload subcommand for all tracked models', async t => {
	const allocator = getVramAllocator();
	allocator.registerModel('model-a', 'coder');
	allocator.registerModel('model-b', 'embedder');

	const result = (await vramCommand.handler(['unload'], [], {
		provider: 'ollama',
		tokens: 0,
		getMessageTokens: () => 0,
	})) as React.ReactElement<{message: string}>;

	t.truthy(result);
	t.true(React.isValidElement(result));
	t.regex(result.props.message, /Dispatched VRAM unload for all 2 tracked models/);
});

