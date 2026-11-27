import {randomUUID} from 'node:crypto';
import {getAppConfig} from '@/config/index';
import {getBraveSearchApiKey} from '@/config/nanocoder-tools-config';
import {buildToolEntry} from '@/custom-tools/build-tool';
import {CustomToolLoader} from '@/custom-tools/loader';
// Type-only import — the `MCPClient` runtime value is loaded dynamically
// inside `initializeMCP()` so sessions without MCP servers never pay the
// cost of the @modelcontextprotocol/sdk import graph.
import type {MCPClient} from '@/mcp/mcp-client';
import {MCPToolCatalog} from '@/mcp/tool-catalog';
import {getAllToolExports} from '@/tools/index';
import {createLoadToolSchemaTool} from '@/tools/mcp/load-tool-schema';
import {getToolsForProfile, resolveToolProfile} from '@/tools/tool-profiles';
import {ToolRegistry} from '@/tools/tool-registry';
import type {TuneConfig} from '@/types/config';
import type {CustomToolApprovalPolicy} from '@/types/custom-tools';
import type {
	AISDKCoreTool,
	DevelopmentMode,
	MCPInitResult,
	MCPServer,
	MCPTool,
	StreamingFormatter,
	ToolEntry,
	ToolFormatter,
	ToolHandler,
	ToolValidator,
} from '@/types/index';
import type {MCPHealthChange} from '@/types/mcp';
import {getLogger} from '@/utils/logging';
import {notifyWarning} from '@/utils/message-queue-core';
import {getShutdownManager} from '@/utils/shutdown';

/**
 * Filter knob for tool access methods. Default behavior hides scoped
 * skill tools; pass `forSkill` to opt back in for tools owned by that
 * skill (typically by its own subagent).
 */
export interface ToolVisibilityOptions {
	forSkill?: string;
}

// Tools to exclude per development mode
const MODE_EXCLUDED_TOOLS: Record<DevelopmentMode, string[]> = {
	normal: ['write_plan'],
	'auto-accept': ['write_plan'],
	yolo: ['write_plan'],
	plan: [
		// No mutation tools — plan mode is read-only exploration
		'write_file',
		'string_replace',
		'diff_edit',
		'file_op',
		'lsp_format_document',
		'execute_bash',
		// Background job tools only make sense alongside execute_bash.
		'bash_output',
		'kill_bash',
		'browser',
		// No task tool — plan mode produces the plan itself
		'write_tasks',
		'write_walkthrough',
		// No git mutation tools — keep read-only git tools
		'git_add',
		'git_commit',
		// git_pr bundles both read-only actions (view/list/diff/checks/logs)
		// and mutating ones (create/comment/review) behind one tool name, so
		// it can't be split per-action here — excluded wholesale for now.
		// source/verify/trust-level.ts is the action-granular allowlist meant to
		// replace this blunt exclusion once the verify subcommand (issue
		// #861) consumes it.
		'git_pr',
		// Plan mode may create/refine the plan graph through write_plan, but it
		// must not mark work as done — that is execution, not planning.
		'update_plan_node',
	],
	headless: ['ask_user', 'agent', 'write_plan'],
	architect: ['write_plan', 'git_commit', 'git_pr'],
};

export interface ModeFilterLookups {
	getCustomToolPolicy(
		name: string,
	): {approval: CustomToolApprovalPolicy; readOnly: boolean} | undefined;
	/** Server read-only annotation for an MCP tool; undefined when not MCP. */
	getMcpReadOnly(name: string): boolean | undefined;
}

/**
 * Apply a development mode's tool exclusions to a list of tool names.
 *
 * Custom tools follow the same posture as built-ins but with policy applied
 * per-tool from their approval/readOnly metadata. MCP tools can't be
 * enumerated in MODE_EXCLUDED_TOOLS (their names come from the server), so
 * plan mode gates them on the server's read-only annotation instead - an
 * unannotated tool may mutate, so it's hidden. The annotation is a
 * server-supplied hint read off the MCP client, not the registry entry:
 * isReadOnly() also decides checkpointing and parallel batching, which it
 * must not influence.
 */
export function filterToolNamesForMode(
	names: string[],
	mode: DevelopmentMode,
	lookups: ModeFilterLookups,
): string[] {
	const excludeSet = new Set(MODE_EXCLUDED_TOOLS[mode]);
	let result = names.filter(n => !excludeSet.has(n));

	if (mode === 'plan' || mode === 'headless') {
		result = result.filter(n => {
			const meta = lookups.getCustomToolPolicy(n);
			if (!meta) {
				return lookups.getMcpReadOnly(n) ?? true;
			}
			if (mode === 'headless') {
				return meta.approval === 'never';
			}
			// plan mode: only read-only tools with no approval are safe
			return meta.approval === 'never' && meta.readOnly;
		});
	}

	return result;
}

/**
 * The startup warning for an MCP server whose tools were skipped because a
 * built-in or custom tool already has the name, or null when none were.
 */
export function describeSkippedMCPTools(result: MCPInitResult): string | null {
	if (!result.skippedTools || result.skippedTools.length === 0) {
		return null;
	}
	return `MCP server "${result.serverName}" offers tools that a built-in or custom tool already uses, so they were skipped: ${result.skippedTools.join(', ')}`;
}

/**
 * Catalog records for MCP tool entries, for a client that can't list its
 * discovered tools directly.
 */
function catalogToolsFromEntries(
	entries: ToolEntry[],
	mapping: ReturnType<MCPClient['getToolMapping']>,
): MCPTool[] {
	return entries.map(e => {
		const map = mapping.get(e.name);
		return {
			name: e.name,
			serverName: map?.serverName || 'mcp',
			readOnly: map?.readOnly,
		};
	});
}

/**
 * Session-artifact tools. These write to the *parent session's* artifact
 * directory, so a subagent calling one would silently overwrite the plan,
 * task list, or walkthrough the user is about to act on. Subagents converse
 * in text and report back through their return value; they have no business
 * owning the session's lifecycle artifacts.
 */
export const SESSION_ARTIFACT_TOOLS = [
	'write_plan',
	'update_plan_node',
	'write_tasks',
	'write_walkthrough',
] as const;

/**
 * Manages built-in tools, MCP tools, and file-based custom tools.
 * Single authority for tool availability, filtering, and approval policy.
 */
export class ToolManager {
	private registry: ToolRegistry;
	private mcpClient: MCPClient | null = null;
	private mcpHealthUnsubscribe: (() => void) | null = null;
	private customTools = new Map<
		string,
		{
			approval: CustomToolApprovalPolicy;
			readOnly: boolean;
			source: 'personal' | 'project';
			filePath: string;
			subscribe?: import('@/types/skills').SkillTrigger[];
		}
	>();
	private mcpCatalog: MCPToolCatalog = new MCPToolCatalog();
	/** Whether initializeMCP chose on-demand discovery for this client. */
	private mcpDiscovery = false;
	/**
	 * Servers currently unhealthy. Their tools stay registered and keep their
	 * place in the request; this set is what makes a call to one fail fast with
	 * a reason instead of being attempted against a dead transport.
	 */
	private mcpUnavailableServers = new Set<string>();
	/**
	 * Last known owner of every MCP tool this manager registered or
	 * catalogued, as the client reported it.
	 *
	 * The client's own mapping is rebuilt from the tools its servers
	 * currently offer, and marking a server unhealthy empties that
	 * server's tool list immediately after announcing the change. Tools now
	 * stay registered through an outage (#1574), so from that moment the
	 * live mapping no longer knows who owns them: every retained tool would
	 * look like a built-in, and the mark that makes a call to it fail fast
	 * would never be found. This map is what survives the clear.
	 */
	private mcpToolOwners: ReturnType<MCPClient['getToolMapping']> = new Map();
	// Names the MCP client currently holds in the registry. The registry is a
	// plain name-keyed map, so an MCP tool named like a built-in would replace
	// it, and removing MCP tools by name would then delete the built-in. Only
	// names in this set are ever registered over or removed on MCP's behalf.
	private mcpToolNames = new Set<string>();

	/** The manager this one is layered over; set only for a session's manager. */
	private readonly parent?: ToolManager;
	/** Shutdown handler name; one per manager, so closing one leaves the rest. */
	private readonly mcpShutdownName: string;

	constructor(parent?: ToolManager) {
		this.parent = parent;
		this.mcpShutdownName = parent ? `mcp-client:${randomUUID()}` : 'mcp-client';
		this.mcpCatalog = new MCPToolCatalog(parent?.mcpCatalog);
		if (parent) {
			this.registry = new ToolRegistry(parent.registry);
			this.customTools = parent.customTools;
			return;
		}
		this.registry = ToolRegistry.fromToolExports(getAllToolExports());

		// Remove web_search if no Brave Search API key is configured
		if (!getBraveSearchApiKey()) {
			this.registry.unregister('web_search');
		}
	}

	/**
	 * A manager for one ACP session: everything this one offers, read live,
	 * plus MCP servers of its own that no other session sees. Connecting and
	 * disconnecting it only ever touches those servers.
	 */
	forSession(): ToolManager {
		return new ToolManager(this);
	}

	/**
	 * Returns the MCP tool catalog for on-demand tool discovery.
	 */
	getMcpCatalog(): MCPToolCatalog {
		return this.mcpCatalog;
	}

	/**
	 * Dynamically loads an on-demand MCP tool from the catalog into the active ToolRegistry.
	 */
	loadMcpTool(toolName: string): boolean {
		if (this.registry.hasTool(toolName)) {
			// Already loaded, unless the name belongs to a built-in, custom or
			// skill tool: that tool keeps it, and the MCP tool stays out.
			if (!this.holdsMCPTool(toolName)) return false;
			this.mcpCatalog.markLoaded(toolName);
			return true;
		}

		// An outage keeps the server's catalog entries (#1574), so the model can
		// still see this tool and ask for its schema. Hydrating it would add a
		// schema to the request mid-session — the prefix change keeping the
		// tools registered just avoided — for a tool that cannot answer anyway.
		// It stays in the catalog and loads once the server is back.
		if (this.isUnavailableMcpTool(toolName)) return false;

		const mcpClient = this.mcpClient ?? this.parent?.mcpClient;
		if (!mcpClient) return false;

		const mcpToolEntries = mcpClient.getToolEntries();
		const entry = mcpToolEntries.find(e => e.name === toolName);
		if (!entry) return false;

		this.registry.register({...entry, source: 'mcp'});
		this.mcpToolNames.add(toolName);
		this.rememberMcpOwners([toolName]);
		this.mcpCatalog.markLoaded(toolName);
		return true;
	}

	/**
	 * Initialize MCP servers and register their tools.
	 *
	 * Servers marked `"enabled": false` are skipped entirely — no connection,
	 * no tools, no init result. That flag is the documented server-level gate
	 * (see docs/configuration/mcp-configuration.md), and it is the only opt-out
	 * for headless runs, where every MCP tool executes unattended. An absent
	 * flag means enabled, so existing configs are unaffected.
	 */
	async initializeMCP(
		servers: MCPServer[],
		onProgress?: (result: MCPInitResult) => void,
		onHealthChange?: (change: MCPHealthChange) => void,
		tuneConfig?: Partial<TuneConfig>,
	): Promise<MCPInitResult[]> {
		const enabledServers = servers?.filter(server => server.enabled !== false);
		// Reinitialization must close the previous transports before replacing the client.
		await this.disconnectMCP();

		if (enabledServers && enabledServers.length > 0) {
			// Dynamic import — only paid for by sessions with configured MCP servers.
			this.mcpClient = await this.createMCPClient();
			const unsubscribeHealth = [
				onHealthChange && this.mcpClient.onHealthChange(onHealthChange),
				this.mcpClient.onHealthChange(change => {
					if (change.status === 'unhealthy') {
						// The server's tools stay registered and stay in the
						// catalog; only this mark changes (#1574). Unregistering
						// them rewrote the schema array and the prompt's catalog
						// section mid-session, which invalidates the cached
						// prefix for every later turn — a far larger cost than
						// offering a tool that answers with an error until its
						// server is back. A call to one is refused up front by
						// `isUnavailableMcpTool`, and the transport would fail it
						// anyway.
						this.mcpUnavailableServers.add(change.serverName);
					} else if (change.status === 'connected') {
						this.restoreServerTools(change.serverName);
					}
				}),
			].filter((unsubscribe): unsubscribe is () => void => !!unsubscribe);
			this.mcpHealthUnsubscribe = () => {
				for (const unsubscribe of unsubscribeHealth) unsubscribe();
			};

			getShutdownManager().register({
				name: this.mcpShutdownName,
				priority: 20,
				handler: async () => {
					await this.disconnectMCP();
				},
			});

			const results = await this.mcpClient.connectToServers(
				enabledServers,
				onProgress,
			);

			const mcpClient = this.mcpClient;
			const mcpToolEntries = mcpClient.getToolEntries();
			const mapping = mcpClient.getToolMapping();
			// A name a built-in, custom or skill tool already has stays with that
			// tool: the MCP tool is neither registered nor listed in the catalog,
			// where load_tool_schema would offer the MCP schema for a name that
			// calls the other tool.
			const skipped = new Set(
				mcpToolEntries
					.map(entry => entry.name)
					.filter(name => this.isTakenByNonMCPTool(name)),
			);
			for (const name of skipped) {
				getLogger().warn(
					`MCP tool "${name}" skipped: a tool with that name already exists`,
				);
			}

			const useDiscovery =
				tuneConfig?.mcpDiscovery === 'always' ||
				(tuneConfig?.mcpDiscovery !== 'disabled' && mcpToolEntries.length >= 8);
			this.mcpDiscovery = useDiscovery;

			this.mcpCatalog.clear();
			const discoveredTools: MCPTool[] =
				typeof mcpClient.getAllDiscoveredTools === 'function'
					? mcpClient.getAllDiscoveredTools()
					: catalogToolsFromEntries(mcpToolEntries, mapping);

			for (const tool of discoveredTools) {
				if (skipped.has(tool.name)) continue;
				this.mcpCatalog.add(tool.serverName, tool, !useDiscovery);
			}
			// Catalogued but unregistered tools need an owner as much as
			// registered ones: load_tool_schema refuses to hydrate one whose
			// server is down, and that check reads the owner.
			this.rememberMcpOwners(
				discoveredTools
					.filter(tool => !skipped.has(tool.name))
					.map(tool => tool.name),
				mapping,
			);

			if (useDiscovery) {
				this.registry.registerToolExport(createLoadToolSchemaTool(this));
			} else {
				this.registry.unregister('load_tool_schema');
				this.registerMCPEntries(
					mcpToolEntries.filter(entry => !skipped.has(entry.name)),
				);
			}

			// Tools are keyed by name, so a name two servers share silently
			// reaches only one of them. Say which. A name that was skipped
			// reaches neither server, so it is left to the skipped-tools warning.
			const conflicts = (
				typeof mcpClient.getToolNameConflicts === 'function'
					? mcpClient.getToolNameConflicts()
					: []
			).filter(conflict => !skipped.has(conflict.tool));
			if (conflicts.length > 0) {
				const lines = conflicts
					.slice(0, 5)
					.map(
						c =>
							`"${c.tool}" (${c.servers.join(', ')}; calls go to ${c.active})`,
					);
				const more =
					conflicts.length > 5 ? ` and ${conflicts.length - 5} more` : '';
				const message = `MCP servers expose the same tool names, so only one server handles each: ${lines.join('; ')}${more}.`;
				// An ACP session's manager has no TUI to show a chat warning;
				// log it there, as it does for skipped tools.
				if (this.parent) getLogger().warn(message);
				else notifyWarning(message);
			}

			if (skipped.size === 0) {
				return results;
			}

			// Every server offering a skipped name is told, not only the one the
			// name would have been routed to.
			return results.map(result => {
				const skippedTools = mcpClient
					.getToolEntries(result.serverName)
					.map(entry => entry.name)
					.filter(name => skipped.has(name));
				return skippedTools.length > 0 ? {...result, skippedTools} : result;
			});
		}
		return [];
	}

	/**
	 * Take the mark off a recovered server and pick up anything it has gained.
	 *
	 * An outage no longer unregisters anything (#1574), so almost always there
	 * is nothing to do here beyond clearing the mark, and the request the next
	 * turn sends is byte-identical to the one before the outage. What is left
	 * is a server that came back offering tools it did not have before: those
	 * are registered when every schema is registered, or listed in the catalog
	 * as unloaded under discovery, the same as at startup.
	 *
	 * A tool that was already registered keeps its registration and its
	 * position, but its entry is refreshed from what the server now reports
	 * (see `refreshRecoveredTool`) so a changed read-only hint or schema
	 * cannot be missed. An unchanged schema object is carried over, so the
	 * prefix tracker's digest cache, which keys on schema identity, survives.
	 *
	 * A tool the server has *dropped* keeps its registration. Removing it would
	 * cost the prefix exactly what keeping the server's tools through the
	 * outage just saved, and a call to it fails at the transport with the
	 * server's own "unknown tool" error.
	 */
	private restoreServerTools(serverName: string): void {
		this.mcpUnavailableServers.delete(serverName);
		const client = this.mcpClient;
		if (!client) return;
		// A name skipped at startup is skipped again here; it was already
		// reported then.
		const entries = client
			.getToolEntries(serverName)
			.filter(entry => !this.isTakenByNonMCPTool(entry.name));
		// The client re-lists a recovered server's tools before it announces the
		// recovery, so its mapping is accurate again at this point. Record the
		// owners first: a tool gained during the outage has none yet, and one
		// retained through it is still pointing at the pre-outage record.
		this.rememberMcpOwners(entries.map(entry => entry.name));

		const gained = entries.filter(entry => !this.holdsMCPTool(entry.name));
		const toRegister = this.mcpDiscovery ? [] : gained;
		const registering = new Set(toRegister.map(entry => entry.name));

		const tools: MCPTool[] =
			typeof client.getServerTools === 'function'
				? client.getServerTools(serverName)
				: catalogToolsFromEntries(entries, client.getToolMapping());
		const offered = new Set(entries.map(entry => entry.name));
		const described = new Map(tools.map(tool => [tool.name, tool]));

		// Tools that held their place through the outage keep it, but the
		// server gets the last word on what they now do. This runs before the
		// catalog is updated below, and has to: the stored entry is what says
		// which schema was in the request before the outage.
		for (const entry of entries) {
			if (!this.mcpToolNames.has(entry.name)) continue;
			this.refreshRecoveredTool(entry, described.get(entry.name));
		}

		for (const tool of tools) {
			if (!offered.has(tool.name)) continue;
			// An entry already in the catalog keeps whether it is loaded, and is
			// rewritten only if the server changed something; a new one is loaded
			// exactly when it is being registered.
			this.mcpCatalog.refresh(
				serverName,
				tool,
				this.mcpCatalog.has(tool.name) ? undefined : registering.has(tool.name),
			);
		}
		this.registerMCPEntries(toRegister);
	}

	/**
	 * Bring a tool that survived the outage up to date with what its server
	 * now says about it, without giving up its place in the request.
	 *
	 * The entry is rebuilt from the recovered client's own tool entries, so
	 * the handler closes over the live transport and the approval policy
	 * follows the server's current read-only hint. Keeping the pre-outage
	 * entry would leave a tool that has become mutating still annotated
	 * read-only, and in auto-accept mode a read-only MCP tool runs without
	 * asking — so a stale annotation is the difference between a prompt and
	 * an unattended write.
	 *
	 * When the schema has not changed, which is the ordinary case, the entry
	 * keeps the schema object the request has already been fingerprinted
	 * against, so the prefix tracker's per-schema digest cache (keyed on
	 * `inputSchema` identity) survives the recovery. A schema that genuinely
	 * changed is passed on: the model is being offered different parameters,
	 * and the prefix has to give.
	 */
	private refreshRecoveredTool(fresh: ToolEntry, tool?: MCPTool): void {
		const current = this.registry.getEntry(fresh.name);
		if (!current) return;
		const stored = this.mcpCatalog.get(fresh.name);
		const next: ToolEntry = {...fresh, source: 'mcp'};
		const cachedSchema = current.tool.inputSchema;
		if (
			stored &&
			cachedSchema !== undefined &&
			JSON.stringify(stored.inputSchema) === JSON.stringify(tool?.inputSchema)
		) {
			next.tool = {...next.tool, inputSchema: cachedSchema};
		}
		this.registry.register(next);
	}

	/**
	 * Register MCP tool entries, except where a tool the MCP client did not
	 * register already has the name: a built-in, custom or skill tool, or, in
	 * a session's manager, anything the parent offers (the layered registry
	 * reads the parent's tools). That tool keeps its handler, schema and
	 * approval policy, and the MCP tool is skipped, the same way a colliding
	 * custom tool is. Returns the skipped names.
	 */
	private registerMCPEntries(entries: ToolEntry[]): string[] {
		const skipped: string[] = [];
		for (const entry of entries) {
			if (this.isTakenByNonMCPTool(entry.name)) {
				getLogger().warn(
					`MCP tool "${entry.name}" skipped: a tool with that name already exists`,
				);
				skipped.push(entry.name);
				continue;
			}
			// MCP servers connect in parallel, so entries arrive in whatever
			// order the servers answered in. The tag lets the registry sort
			// them into the same order every session (#1574).
			this.registry.register({...entry, source: 'mcp'});
			this.mcpToolNames.add(entry.name);
			this.rememberMcpOwners([entry.name]);
		}
		return skipped;
	}

	/** Whether a tool the MCP client did not register already has the name. */
	private isTakenByNonMCPTool(name: string): boolean {
		return this.registry.hasTool(name) && !this.mcpToolNames.has(name);
	}

	/**
	 * Whether the registry's tool with this name is an MCP tool, registered
	 * here or, for a session's manager, by the manager it is layered over.
	 */
	private holdsMCPTool(name: string): boolean {
		return (
			this.mcpToolNames.has(name) || (this.parent?.holdsMCPTool(name) ?? false)
		);
	}

	/** Unregister MCP tools, ignoring any name the MCP client does not hold. */
	private unregisterMCPTools(names: string[]): void {
		for (const name of names) {
			if (this.mcpToolNames.delete(name)) {
				this.registry.unregister(name);
			}
		}
	}

	/**
	 * This manager's MCP mapping for a tool, or undefined when the name
	 * belongs to a tool the MCP client did not register. An on-demand tool
	 * still in the catalog counts as MCP's: no other tool has its name.
	 */
	private getRegisteredMCPMapping(name: string) {
		const mcp =
			this.mcpToolNames.has(name) ||
			(!this.registry.hasTool(name) && this.mcpCatalog.has(name));
		if (!mcp) return undefined;
		const live = (this.mcpClient ?? this.parent?.mcpClient)
			?.getToolMapping()
			.get(name);
		// An unhealthy server's tools are gone from the live mapping while its
		// tools stay registered (#1574), so the last owner recorded for this
		// tool is what identifies it until the server is back.
		return live ?? this.mcpToolOwners.get(name);
	}

	/**
	 * Record who owns each of these tools, from a mapping that is accurate
	 * right now. Called at startup, on hydration and on recovery — each a
	 * point where the client has just listed the tools in question.
	 */
	private rememberMcpOwners(
		names: Iterable<string>,
		mapping?: ReturnType<MCPClient['getToolMapping']>,
	): void {
		const owners =
			mapping ?? (this.mcpClient ?? this.parent?.mcpClient)?.getToolMapping();
		if (!owners) return;
		for (const name of names) {
			const owned = owners.get(name);
			if (owned) this.mcpToolOwners.set(name, owned);
		}
	}

	protected async createMCPClient(): Promise<MCPClient> {
		// The parent's factory builds a new client; its own is not handed over.
		// Going through it keeps one seam for swapping the client in tests.
		if (this.parent) return this.parent.createMCPClient();
		const {MCPClient} = await import('@/mcp/mcp-client');
		return new MCPClient();
	}

	/**
	 * Load file-based custom tools from `.nanocoder/tools/` (project) and
	 * the personal tools directory. Project tools override personal ones.
	 * Custom tools whose name collides with a built-in or already-registered
	 * MCP tool are skipped with an error. Returns a per-tool load summary so
	 * callers can surface counts/errors at startup.
	 */
	initializeCustomTools(projectRoot?: string): {
		loaded: string[];
		errors: Array<{file: string; error: string}>;
	} {
		const loader = new CustomToolLoader(projectRoot ?? process.cwd());
		const {tools, errors} = loader.load();
		const loaded: string[] = [];
		const collisions: Array<{file: string; error: string}> = [];

		for (const t of tools) {
			if (this.registry.hasTool(t.metadata.name)) {
				collisions.push({
					file: t.filePath,
					error: `Tool name "${t.metadata.name}" collides with a built-in or MCP tool — skipping.`,
				});
				continue;
			}
			const entry = buildToolEntry(t, loader.getProjectRoot());
			// Tagged so the registry can order them: they arrive in readdir
			// order, which is not stable between machines (#1574).
			this.registry.register({...entry, source: 'custom'});
			this.customTools.set(t.metadata.name, {
				approval: t.metadata.approval,
				readOnly: t.metadata.readOnly,
				source: t.source,
				filePath: t.filePath,
				subscribe: t.subscribe,
			});
			loaded.push(t.metadata.name);
		}

		return {loaded, errors: [...errors, ...collisions]};
	}

	// =========================================================================
	// Tool availability — single source of truth
	// =========================================================================

	/**
	 * Get the list of tool names available given the current mode and tune config.
	 * This is the single authority used by both prompt building and runtime.
	 */
	getAvailableToolNames(
		tuneConfig?: TuneConfig,
		developmentMode?: DevelopmentMode,
		disabledTools?: readonly string[],
		model?: string,
	): string[] {
		let names = this.getToolNames();

		if (tuneConfig?.enabled) {
			const profile = resolveToolProfile(tuneConfig.toolProfile, model);
			if (profile !== 'full') {
				const profileTools = getToolsForProfile(profile);
				if (profileTools.length > 0) {
					names = profileTools;
				}
			}
		}

		// The plan artifact is a mode capability, not a general-purpose tool.
		// Keep it available even when a slim profile filters the normal tool set.
		// Copy rather than push: `names` may still alias the shared, module-level
		// profile array from getToolsForProfile(), and mutating that would leak
		// write_plan into every later lookup of that profile for the life of the
		// process.
		if (
			developmentMode === 'plan' &&
			this.registry.hasTool('write_plan') &&
			!names.includes('write_plan')
		) {
			names = [...names, 'write_plan'];
		}

		// Apply mode-based exclusions
		if (developmentMode) {
			names = this.filterToolNamesForMode(names, developmentMode);
		}

		// Apply user-configured disable list (intersects with profile + mode).
		// Defaults to global app config; callers may pass an override (mainly
		// for tests). This is global policy every caller should observe.
		const disabled = disabledTools ?? getAppConfig().disabledTools;
		if (disabled && disabled.length > 0) {
			const disabledSet = new Set(disabled);
			names = names.filter(n => !disabledSet.has(n));
		}

		return names;
	}

	/**
	 * Drop the tools a development mode must not offer. Shared by the main
	 * conversation (via getAvailableToolNames) and subagents, so a subagent
	 * spawned in plan or headless mode can't reach tools its parent can't.
	 */
	filterToolNamesForMode(names: string[], mode: DevelopmentMode): string[] {
		return filterToolNamesForMode(names, mode, {
			getCustomToolPolicy: name => this.getCustomToolPolicy(name),
			getMcpReadOnly: name =>
				mode === 'plan' ? this.mcpReadOnly(name) : undefined,
		});
	}

	private mcpReadOnly(name: string): boolean | undefined {
		const mapping = this.getRegisteredMCPMapping(name);
		return mapping ? mapping.readOnly : this.parent?.mcpReadOnly(name);
	}

	/**
	 * Approval/read-only policy for a file-based custom tool, or for a
	 * skill-bundle tool (registered straight into the registry, so its policy
	 * is recovered from the entry's approval shape).
	 */
	private getCustomToolPolicy(
		name: string,
	): {approval: CustomToolApprovalPolicy; readOnly: boolean} | undefined {
		const meta = this.customTools.get(name);
		if (meta) return meta;
		const entry = this.registry.getEntry(name);
		if (!entry?.ownerSkill) return undefined;
		const approval: CustomToolApprovalPolicy =
			entry.approval === false || entry.approval === undefined
				? 'never'
				: entry.approval === true
					? 'always'
					: 'destructive';
		return {approval, readOnly: entry.readOnly === true};
	}

	// =========================================================================
	// Tool access — delegates to ToolRegistry
	//
	// All accessors return execute-stripped AI SDK tool definitions: the SDK
	// never auto-executes, so the model only ever needs schemas/descriptions.
	// Execution runs through the registry handler (see getToolHandler), which
	// validates. Approval is decided separately by `resolveToolApproval`.
	// =========================================================================

	getAllTools(opts?: ToolVisibilityOptions): Record<string, AISDKCoreTool> {
		return this.applyVisibility(this.registry.getNativeTools(), opts);
	}

	getFilteredTools(
		allowedToolNames: string[],
		opts?: ToolVisibilityOptions,
	): Record<string, AISDKCoreTool> {
		return this.filterByNames(this.getAllTools(opts), allowedToolNames);
	}

	/**
	 * Drop scoped tools unless the caller opts in by passing the owning
	 * skill's name. Tools without `scoped` set (built-ins, MCP, custom
	 * tools, single-file skill tools) pass through untouched.
	 */
	private applyVisibility(
		tools: Record<string, AISDKCoreTool>,
		opts?: ToolVisibilityOptions,
	): Record<string, AISDKCoreTool> {
		const result: Record<string, AISDKCoreTool> = {};
		for (const [name, tool] of Object.entries(tools)) {
			const entry = this.registry.getEntry(name);
			if (entry?.scoped) {
				if (entry.ownerSkill && entry.ownerSkill === opts?.forSkill) {
					result[name] = tool;
				}
				continue;
			}
			result[name] = tool;
		}
		return result;
	}

	private filterByNames(
		tools: Record<string, AISDKCoreTool>,
		allowedNames: string[],
	): Record<string, AISDKCoreTool> {
		const nameSet = new Set(allowedNames);
		const filtered: Record<string, AISDKCoreTool> = {};
		for (const [name, tool] of Object.entries(tools)) {
			if (nameSet.has(name)) {
				filtered[name] = tool;
			}
		}
		return filtered;
	}

	getToolRegistry(): Record<string, ToolHandler> {
		return this.registry.getHandlers();
	}

	getToolHandler(toolName: string): ToolHandler | undefined {
		if (!this.registry.hasTool(toolName) && this.mcpCatalog.has(toolName)) {
			this.loadMcpTool(toolName);
		}
		return this.registry.getHandler(toolName);
	}

	getToolFormatter(toolName: string): ToolFormatter | undefined {
		if (!this.registry.hasTool(toolName) && this.mcpCatalog.has(toolName)) {
			this.loadMcpTool(toolName);
		}
		return this.registry.getFormatter(toolName);
	}

	getToolValidator(toolName: string): ToolValidator | undefined {
		if (!this.registry.hasTool(toolName) && this.mcpCatalog.has(toolName)) {
			this.loadMcpTool(toolName);
		}
		return this.registry.getValidator(toolName);
	}

	getStreamingFormatter(toolName: string): StreamingFormatter | undefined {
		return this.registry.getStreamingFormatter(toolName);
	}

	/**
	 * Whether a call can skip a checkpoint and join a parallel batch. An
	 * unloaded on-demand MCP tool is not read-only here: its catalog flag is
	 * the server's own readOnlyHint, which must not decide either (see
	 * createMCPToolApproval in mcp/tool-approval.ts). Once loaded, its
	 * registry entry carries no readOnly flag either, so the answer doesn't
	 * change.
	 */
	isReadOnly(toolName: string): boolean {
		return this.registry.getEntry(toolName)?.readOnly === true;
	}

	hasTool(toolName: string): boolean {
		return this.registry.hasTool(toolName);
	}

	/**
	 * True for an on-demand MCP tool that is in the catalog but whose schema
	 * the model hasn't loaded with `load_tool_schema` yet.
	 */
	isUnloadedMcpTool(toolName: string): boolean {
		return !this.registry.hasTool(toolName) && this.mcpCatalog.has(toolName);
	}

	/**
	 * Whether this tool belongs to an MCP server that is currently unhealthy.
	 *
	 * Its schema is still offered — that is the point, the request stays
	 * byte-identical through the outage (#1574) — so the call has to be refused
	 * here instead, with a reason the model can act on. Reads the parent too,
	 * so a session's manager sees an outage on a shared server.
	 */
	isUnavailableMcpTool(toolName: string): boolean {
		const serverName = this.getMCPToolInfo(toolName).serverName;
		if (!serverName) return false;
		return (
			this.mcpUnavailableServers.has(serverName) ||
			(this.parent?.isUnavailableMcpTool(toolName) ?? false)
		);
	}

	/**
	 * Register a skill-provided tool. Wraps the registry call so the
	 * registrar doesn't have to reach through `ToolManager` into
	 * `ToolRegistry`. The entry's `ownerSkill` tag is preserved.
	 */
	registerSkillTool(entry: ToolEntry): void {
		this.registry.register({...entry, source: 'skill'});
	}

	/**
	 * Unregister a previously-registered skill-provided tool. Returns true
	 * if the tool was found and removed.
	 */
	unregisterSkillTool(toolName: string): boolean {
		if (!this.registry.hasTool(toolName)) return false;
		this.registry.unregister(toolName);
		return true;
	}

	/**
	 * Return the tool entry's `ownerSkill` tag, if any. Used by callers
	 * (e.g. `/tools`, scoped-visibility filters) to attribute a tool back
	 * to the skill that registered it.
	 */
	getOwnerSkill(toolName: string): string | undefined {
		return this.registry.getEntry(toolName)?.ownerSkill;
	}

	isCustomTool(toolName: string): boolean {
		return this.customTools.has(toolName);
	}

	getCustomToolInfo(toolName: string):
		| {
				approval: CustomToolApprovalPolicy;
				readOnly: boolean;
				source: 'personal' | 'project';
				filePath: string;
				subscribe?: import('@/types/skills').SkillTrigger[];
		  }
		| undefined {
		return this.customTools.get(toolName);
	}

	getCustomToolNames(): string[] {
		return Array.from(this.customTools.keys());
	}

	getMCPToolInfo(toolName: string): {isMCPTool: boolean; serverName?: string} {
		const mapping = this.getRegisteredMCPMapping(toolName);

		if (mapping) {
			return {
				isMCPTool: true,
				serverName: mapping.serverName,
			};
		}

		return this.parent?.getMCPToolInfo(toolName) ?? {isMCPTool: false};
	}

	async disconnectMCP(): Promise<void> {
		this.mcpHealthUnsubscribe?.();
		this.mcpHealthUnsubscribe = null;
		this.mcpCatalog.clear();
		this.mcpDiscovery = false;
		this.mcpUnavailableServers.clear();
		this.mcpToolOwners.clear();
		this.registry.unregister('load_tool_schema');
		if (this.mcpClient) {
			this.unregisterMCPTools([...this.mcpToolNames]);
			await this.mcpClient.disconnect();

			this.mcpClient = null;
		}

		getShutdownManager().unregister(this.mcpShutdownName);
	}

	getToolEntry(toolName: string): ToolEntry | undefined {
		if (!this.registry.hasTool(toolName) && this.mcpCatalog.has(toolName)) {
			this.loadMcpTool(toolName);
		}
		return this.registry.getEntry(toolName);
	}

	getToolNames(): string[] {
		return this.registry.getToolNames();
	}

	getToolCount(): number {
		return this.registry.getToolCount();
	}

	getConnectedServers(): string[] {
		return this.mcpClient?.getConnectedServers() || [];
	}

	getServerNames(): string[] {
		return this.mcpClient?.getServerNames() || [];
	}

	getServerTools(serverName: string): MCPTool[] {
		return this.mcpClient?.getServerTools(serverName) || [];
	}

	getServerInfo(serverName: string) {
		return this.mcpClient?.getServerInfo(serverName);
	}

	getMCPClient() {
		return this.mcpClient;
	}

	onMCPHealthChange(listener: (change: MCPHealthChange) => void): () => void {
		return this.mcpClient?.onHealthChange(listener) || (() => {});
	}
}
