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

// Serialising the tool schemas is the expensive half of fingerprinting — about
// 18KB of JSON across a default tool set, on every request — so the result is
// cached. (The SDK memoizes schema *resolution* on the Schema object itself;
// stringify and hash are what repeat.)
//
// The cache cannot be keyed on the tool: `ToolRegistry.getNativeTools` strips
// `execute` with a rest-spread, so it hands out a fresh object per tool per
// call and a tool-keyed cache never hits. That spread is shallow, so
// `inputSchema` is the reference that does survive — built-ins are module-level
// constants, and MCP and custom tools are built once at registration. Keyed
// weakly so dropped schemas are collected.
const schemaDigestCache = new WeakMap<object, string>();

/** No `inputSchema` at all, versus one that would not resolve. */
const NO_SCHEMA = 'none';
const UNREADABLE_SCHEMA = 'unreadable';

async function schemaDigest(
	schema: AISDKCoreTool['inputSchema'],
): Promise<string> {
	if (!schema) {
		return NO_SCHEMA;
	}
	// A WeakMap keys on objects and functions but not on primitives. A schema
	// may legitimately be either of the former: `jsonSchema()` accepts a thunk.
	if (typeof schema !== 'object' && typeof schema !== 'function') {
		return UNREADABLE_SCHEMA;
	}
	const cached = schemaDigestCache.get(schema);
	if (cached) {
		return cached;
	}
	let digest: string;
	try {
		digest = hash(JSON.stringify(await asSchema(schema).jsonSchema));
	} catch {
		// Not cached: a schema can resolve lazily, so a failure now does not
		// mean a failure next turn, and caching it would hide the recovery.
		return UNREADABLE_SCHEMA;
	}
	schemaDigestCache.set(schema, digest);
	return digest;
}

async function hashTool(name: string, tool: AISDKCoreTool): Promise<string> {
	// The description is combined per call rather than cached with the schema:
	// nothing stops two tools sharing one schema object, and keying their whole
	// hash on it would collide and hide a real tool change.
	const digest = await schemaDigest(tool.inputSchema);
	return `${name}:${hash(`${tool.description ?? ''}\n${digest}`)}`;
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
