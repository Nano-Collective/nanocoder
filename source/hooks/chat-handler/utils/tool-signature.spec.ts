import test from 'ava';
import type {ToolCall} from '@/types/core';
import {computeToolCallSignature} from './tool-signature.js';

function call(name: string, args: unknown, id = 'x'): ToolCall {
	return {
		id,
		function: {name, arguments: args as Record<string, unknown>},
	};
}

test('empty input produces an empty signature', t => {
	t.is(computeToolCallSignature([]), '');
});

test('identical calls produce identical signatures regardless of id', t => {
	const a = computeToolCallSignature([call('bash', {command: 'ls'}, 'id-1')]);
	const b = computeToolCallSignature([call('bash', {command: 'ls'}, 'id-2')]);
	t.is(a, b);
});

test('different arguments produce different signatures', t => {
	const a = computeToolCallSignature([call('bash', {command: 'ls'})]);
	const b = computeToolCallSignature([call('bash', {command: 'pwd'})]);
	t.not(a, b);
});

test('different tool names produce different signatures', t => {
	const a = computeToolCallSignature([call('read_file', {path: 'a'})]);
	const b = computeToolCallSignature([call('write_file', {path: 'a'})]);
	t.not(a, b);
});

test('signature is order-independent across multiple calls', t => {
	const a = computeToolCallSignature([
		call('bash', {command: 'ls'}, '1'),
		call('read_file', {path: 'a'}, '2'),
	]);
	const b = computeToolCallSignature([
		call('read_file', {path: 'a'}, '3'),
		call('bash', {command: 'ls'}, '4'),
	]);
	t.is(a, b);
});

test('string and object arguments with the same shape collapse', t => {
	const fromObject = computeToolCallSignature([call('bash', {command: 'ls'})]);
	const fromString = computeToolCallSignature([
		call('bash', JSON.stringify({command: 'ls'})),
	]);
	t.is(fromObject, fromString);
});
