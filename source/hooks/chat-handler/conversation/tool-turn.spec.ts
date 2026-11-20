import {mkdtempSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {createWalkthroughLifecycle} from '@/artifacts/walkthrough-lifecycle';
import {reloadAppConfig} from '@/config/index';
import {setToolManagerGetter, setToolRegistryGetter} from '@/message-handler';
import {getProjectRoot, setProjectRoot} from '@/services/session-cwd';
import {writeFileTool} from '@/tools/file-ops/write-file';
import {markFileSeenAndVisible} from '@/tools/runtime/read-tracker';
import {setGlobalToolConfirmHandler} from '@/tools/runtime/tool-confirm-queue';
import {ToolRegistry} from '@/tools/tool-registry';
import type {ToolManager} from '@/tools/tool-manager';
import type {ToolCall} from '@/types/core';
import {
	runToolTurn,
	type ArchitectCheckpointState,
	type ToolTurnContext,
} from './tool-turn';

/**
 * Architect mode's contract is "one keypress undoes the whole turn", which it
 * gets by checkpointing every file mutation before it runs. It used to waive
 * every file edit, so the turn-start batch was the whole set. A taint-escalated
 * write is approved later than that, and must still enter the checkpoint.
 */

function withEscalation(fn: () => () => void): () => void {
	const dir = mkdtempSync(join(tmpdir(), 'nanocoder-architect-config-'));
	const previous = process.env.NANOCODER_CONFIG_DIR;
	process.env.NANOCODER_CONFIG_DIR = dir;
	writeFileSync(
		join(dir, 'agents.config.json'),
		JSON.stringify({nanocoder: {untrustedContent: {escalate: true}}}),
		'utf-8',
	);
	reloadAppConfig();
	return fn();
}

/** Every file under `dir`, as text, for assertions about what was captured. */
function readTree(dir: string): string {
	return readdirSync(dir, {recursive: true})
		.filter(entry => typeof entry === 'string')
		.map(entry => {
			try {
				return readFileSync(join(dir, entry as string), 'utf-8');
			} catch {
				return '';
			}
		})
		.join('\n');
}

test.serial(
	'an escalated write in architect mode is checkpointed before it runs',
	async t => {
		const project = mkdtempSync(join(tmpdir(), 'nanocoder-architect-taint-'));
		writeFileSync(join(project, 'out.txt'), 'before', 'utf-8');
		const previousRoot = getProjectRoot();
		const previousCwd = process.cwd();
		// The tool's path validation resolves relative paths against the process
		// cwd, the checkpoint against the session root; a real session has them
		// pointing at the same workspace.
		process.chdir(project);
		setProjectRoot(project);
		// The write tool refuses to overwrite a file it has not read this session;
		// this is the documented test helper for satisfying that guard.
		markFileSeenAndVisible(join(project, 'out.txt'));

		const registry = ToolRegistry.fromToolExports([writeFileTool]);
		setToolRegistryGetter(() => registry.getHandlers());
		setToolManagerGetter(() => null);
		setGlobalToolConfirmHandler(async () => true);

		const toolManager = {
			getToolEntry: (name: string) => registry.getEntry(name),
			getToolFormatter: () => undefined,
			getStreamingFormatter: () => undefined,
			isReadOnly: () => false,
			hasTool: (name: string) => registry.hasTool(name),
		} as unknown as ToolManager;

		const checkpointState: ArchitectCheckpointState = {created: false};
		const toolCall: ToolCall = {
			id: 'call-write',
			function: {
				name: 'write_file',
				arguments: {path: 'out.txt', content: 'after'},
			},
		};

		const context: ToolTurnContext = {
			toolManager,
			signal: new AbortController().signal,
			addToChatQueue: () => {},
			setIsGenerating: () => {},
			conversationStateManager: {
				current: {
					updateAfterToolExecution: () => {},
				},
			} as never,
			developmentMode: 'architect',
			nonInteractiveMode: false,
			architectCheckpointState: checkpointState,
			currentProvider: 'test-provider',
			currentModel: 'test-model',
			walkthroughLifecycle: createWalkthroughLifecycle([
				{role: 'user', content: 'write it'},
			]),
			turnStartMessages: [],
			availableNames: ['write_file'],
			notOfferedReason: () => undefined,
			flushAll: async () => {},
			markLiveTaskUpdates: () => {},
			// The page it read is what escalates the write out of the auto batch.
			externalContent: {inContext: true, summary: 'fetch_url https://x.test/p'},
		};

		const restoreConfig = withEscalation(() => () => {
			reloadAppConfig();
		});
		let outcome: Awaited<ReturnType<typeof runToolTurn>>;
		try {
			outcome = await runToolTurn([toolCall], context);
		} finally {
			process.chdir(previousCwd);
			setProjectRoot(previousRoot);
			restoreConfig();
		}

		t.is(outcome.kind, 'continue');
		t.regex(
			String(outcome.kind === 'continue' ? outcome.results[0]?.content : ''),
			/overwritten successfully/,
			'the write ran after the checkpoint, not instead of it',
		);
		t.true(
			checkpointState.created,
			'the approved write must open a checkpoint even though it was not in the auto batch',
		);

		const checkpoints = join(project, '.nanocoder', 'checkpoints');
		const captured = readTree(checkpoints);
		t.true(captured.includes('out.txt'), 'the path is recorded');
		t.true(
			captured.includes('before'),
			'the snapshot is of the file as it was before the write',
		);

		// And the write itself did land afterwards, so the snapshot is not simply
		// the file read at the end of the turn.
		t.is(readFileSync(join(project, 'out.txt'), 'utf-8'), 'after');
	},
);
