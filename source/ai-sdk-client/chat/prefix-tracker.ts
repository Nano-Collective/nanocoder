import {createHash} from 'node:crypto';
import type {ModelMessage} from 'ai';
import {asSchema} from 'ai';
import type {AISDKCoreTool} from '@/types/index';

/**
 * Prompt prefix stability tracking (#1574).
 *
 * Inference servers (llama.cpp, vLLM, Ollama, SGLang) and cloud prompt caches
 * only reuse work for the longest prefix that is byte-identical to an earlier
 * request. Anything that changes early in the prompt (a system prompt
 * rebuilt per turn, a reordered tool list, a rewritten history message)
 * forces the whole tail to be recomputed. This module fingerprints each
 * outgoing request and reports where it first diverged from the previous
 * request, so prefix breaks show up in debug logs instead of only as slow
 * prefill.
 */

export interface PromptFingerprint {
	systemHash: string;
	toolsHash: string;
	/** Tool names in the order they were sent. */
	toolNames: string[];
	/** One hash per non-system message, in send order. */
	messageHashes: string[];
}

export type PrefixDivergence =
	/** No previous request to compare against. */
	| {kind: 'first'}
	/** Every previously sent message is unchanged; only new ones were appended. */
	| {kind: 'append-only'; reusedMessages: number}
	| {kind: 'system-changed'}
	| {
			kind: 'tools-changed';
			added: string[];
			removed: string[];
			reordered: boolean;
	  }
	/** History was rewritten (compaction, capping, mutation) at `index`. */
	| {kind: 'history-changed'; index: number; previousMessages: number};

function hash(value: string): string {
	return createHash('sha1').update(value).digest('hex');
}

// Tool definitions are the same objects for the life of a registry entry, so
// hashing each one once is enough. Keyed weakly so dropped tools are collected.
const toolHashCache = new WeakMap<object, string>();

async function hashTool(name: string, tool: AISDKCoreTool): Promise<string> {
	const cached = toolHashCache.get(tool);
	if (cached) {
		return `${name}:${cached}`;
	}
	let schema: unknown = null;
	try {
		schema = tool.inputSchema
			? await asSchema(tool.inputSchema).jsonSchema
			: null;
	} catch {
		// An unserialisable schema still gets a stable (description-only) hash.
	}
	const digest = hash(
		JSON.stringify({description: tool.description ?? '', schema}),
	);
	toolHashCache.set(tool, digest);
	return `${name}:${digest}`;
}

export async function fingerprintPrompt(
	systemContent: string,
	tools: Record<string, AISDKCoreTool> | undefined,
	messages: ModelMessage[],
): Promise<PromptFingerprint> {
	const toolNames = tools ? Object.keys(tools) : [];
	const toolHashes = await Promise.all(
		toolNames.map(name =>
			hashTool(name, (tools as Record<string, AISDKCoreTool>)[name]),
		),
	);
	return {
		systemHash: hash(systemContent),
		toolsHash: hash(toolHashes.join('\n')),
		toolNames,
		messageHashes: messages.map(message => hash(JSON.stringify(message))),
	};
}

/**
 * Compare two request fingerprints, reporting the earliest point where the
 * new request stops sharing a prefix with the previous one. System prompt and
 * tool schemas are checked first because chat templates render them ahead of
 * the conversation, so a change there invalidates everything after it.
 */
export function comparePromptFingerprints(
	previous: PromptFingerprint | undefined,
	next: PromptFingerprint,
): PrefixDivergence {
	if (!previous) {
		return {kind: 'first'};
	}
	if (previous.systemHash !== next.systemHash) {
		return {kind: 'system-changed'};
	}
	if (previous.toolsHash !== next.toolsHash) {
		const prevNames = new Set(previous.toolNames);
		const nextNames = new Set(next.toolNames);
		const added = next.toolNames.filter(name => !prevNames.has(name));
		const removed = previous.toolNames.filter(name => !nextNames.has(name));
		return {
			kind: 'tools-changed',
			added,
			removed,
			reordered:
				added.length === 0 &&
				removed.length === 0 &&
				previous.toolNames.join('\n') !== next.toolNames.join('\n'),
		};
	}
	const prevHashes = previous.messageHashes;
	for (let index = 0; index < prevHashes.length; index++) {
		if (prevHashes[index] !== next.messageHashes[index]) {
			return {
				kind: 'history-changed',
				index,
				previousMessages: prevHashes.length,
			};
		}
	}
	return {kind: 'append-only', reusedMessages: prevHashes.length};
}

/**
 * Remembers the last request sent through one client so each new request can
 * be compared against it. One tracker per client mirrors what a single-slot
 * local server sees: helper calls (titles, compaction summaries) on the same
 * client really do evict the cached prefix there, so they are reported too.
 */
export class PrefixTracker {
	private last: PromptFingerprint | undefined;
	// Fingerprinting awaits tool schemas, so two overlapping calls on one
	// client would both compare against the same `last` and report the wrong
	// divergence. Chaining keeps compare-and-store ordered per tracker.
	private queue: Promise<unknown> = Promise.resolve();

	record(
		systemContent: string,
		tools: Record<string, AISDKCoreTool> | undefined,
		messages: ModelMessage[],
	): Promise<PrefixDivergence> {
		const result = this.queue.then(async () => {
			const next = await fingerprintPrompt(systemContent, tools, messages);
			const divergence = comparePromptFingerprints(this.last, next);
			this.last = next;
			return divergence;
		});
		// Swallow on the chain only: a rejection still reaches the caller
		// through `result`, but must not poison later records.
		this.queue = result.catch(() => undefined);
		return result;
	}

	reset(): void {
		this.last = undefined;
	}
}
