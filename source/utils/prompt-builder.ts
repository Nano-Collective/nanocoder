import {readFileSync} from 'fs';
import {homedir, platform, release} from 'os';
import {basename, dirname, isAbsolute, join, normalize, resolve} from 'path';
import {fileURLToPath} from 'url';
import {getProfessionalTone} from '@/config/preferences';
import {getProjectRoot} from '@/services/session-cwd';
import type {ToolManager} from '@/tools/tool-manager';
import {isNanoProfile, isSingleToolProfile} from '@/tools/tool-profiles';
import type {SystemPromptConfig, TuneConfig} from '@/types/config';
import {TUNE_DEFAULTS} from '@/types/config';
import type {DevelopmentMode} from '@/types/core';
import {appendAgentsMd} from '@/utils/agents-md';
import {getLogger} from '@/utils/logging';
import {getSubagentDescriptions} from '@/utils/prompt-processor';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const sectionsDir = join(__dirname, '../../source/app/prompts/sections');

// Cache loaded sections to avoid re-reading files
const sectionCache = new Map<string, string>();

function getSectionFilePath(name: string): string {
	const normalizedName = normalize(name).replace(/^([/\\])+/, '');
	const safeName = basename(normalizedName);
	return join(sectionsDir, `${safeName}.md`);
}

export function loadSection(name: string): string {
	const cached = sectionCache.get(name);
	if (cached !== undefined) return cached;

	const filePath = getSectionFilePath(name);
	try {
		const content = readFileSync(filePath, 'utf-8').trim();
		sectionCache.set(name, content);
		return content;
	} catch (error) {
		const logger = getLogger();
		logger.warn(`Failed to load prompt section "${name}": ${String(error)}`);
		sectionCache.set(name, '');
		return '';
	}
}

/** Reset section cache for testing. */
export function resetSectionCache(): void {
	sectionCache.clear();
}

// Cache the last-built system prompt so token-counting callers
// (e.g. /status, /usage, /compact) can access it without needing
// developmentMode/tune/tools as arguments.
let lastBuiltPrompt: string | null = null;

/**
 * Get the last system prompt produced by buildSystemPrompt().
 * Falls back to a minimal prompt if buildSystemPrompt hasn't been called yet.
 */
export function getLastBuiltPrompt(): string {
	return (
		lastBuiltPrompt ?? 'You are Nanocoder, a terminal-based AI coding agent.'
	);
}

/**
 * Update the cached prompt after post-processing (e.g. XML tool injection).
 * Ensures token-counting callers see the full prompt the model receives.
 */
export function setLastBuiltPrompt(prompt: string): void {
	lastBuiltPrompt = prompt;
}

function generateSystemInfo(slim = false): string {
	const now = new Date();
	const dateStr = now.toISOString().split('T')[0];

	const getDefaultShell = (): string => {
		if (process.env.SHELL) return process.env.SHELL;
		if (platform() === 'win32') return process.env.COMSPEC || 'cmd.exe';
		if (platform() === 'darwin') return '/bin/zsh';
		return '/bin/bash';
	};

	const getOSName = (): string => {
		switch (platform()) {
			case 'darwin':
				return 'macOS';
			case 'win32':
				return 'Windows';
			case 'linux':
				return 'Linux';
			default:
				return platform();
		}
	};

	if (slim) {
		return `## SYSTEM
OS: ${getOSName()} | Shell: ${getDefaultShell()} | CWD: ${getProjectRoot()} | Date: ${dateStr}`;
	}

	return `## SYSTEM INFORMATION

Operating System: ${getOSName()}
OS Version: ${release()}
Platform: ${platform()}
Default Shell: ${getDefaultShell()}
Home Directory: ${homedir()}
Current Working Directory: ${getProjectRoot()}
Current Date: ${dateStr}`;
}

// The project root is the launch directory everywhere except inside an ACP
// session's scope, where it is the `cwd` the client named for the session.
//
// AGENTS.md loading is layered: the user-level file in the config directory,
// the project-root file, and (for request-time callers) nested files the agent
// discovers as it works. `appendAgentsMd` owns the layering and per-file cap;
// this module only decides whether the feature is enabled.

/**
 * Whether AGENTS.md content belongs in the system prompt for this tune/model.
 *
 * Shared with the conversation loops so they can append nested files at request
 * time only when the base prompt would also have included AGENTS.md. The nano
 * profile and `tune.includeAgentsMd` turn every layer off together, and
 * `systemPrompt.mode: "replace"` bypasses the built-in prompt entirely.
 */
export function shouldIncludeAgentsMd(
	tuneConfig: TuneConfig | undefined,
	model?: string,
	systemPromptOverride?: SystemPromptConfig,
): boolean {
	if (
		systemPromptOverride &&
		(systemPromptOverride.content !== undefined ||
			systemPromptOverride.file !== undefined) &&
		(systemPromptOverride.mode ?? 'replace') === 'replace'
	) {
		return false;
	}

	const tune = tuneConfig ?? TUNE_DEFAULTS;
	const nano = tune.enabled && isNanoProfile(tune.toolProfile, model);
	return tune.includeAgentsMd ?? (nano ? false : true);
}

// Search/discovery tools that justify a "prefer native over bash" instruction
// read_file alone doesn't count — the model needs search tools for the advice to be meaningful
const NATIVE_SEARCH_TOOLS = new Set([
	'find_files',
	'search_file_contents',
	'list_directory',
]);

function hasNativeSearchTools(toolSet: Set<string>): boolean {
	for (const tool of NATIVE_SEARCH_TOOLS) {
		if (toolSet.has(tool)) return true;
	}
	return false;
}

function hasAnyGitTool(toolSet: Set<string>): boolean {
	for (const name of toolSet) {
		if (name.startsWith('git_')) return true;
	}
	return false;
}

/**
 * Resolve the override content from a SystemPromptConfig: inline content wins
 * over file. Returns the prompt string, or null if neither is usable.
 */
function resolveSystemPromptOverride(
	override: SystemPromptConfig,
): string | null {
	if (override.content !== undefined) {
		if (override.file !== undefined) {
			getLogger().warn(
				'systemPrompt: both `content` and `file` set — using `content`.',
			);
		}
		return override.content;
	}

	if (override.file !== undefined) {
		// Path comes from the user's own agents.config.json (trusted config), same model as source/config/index.ts
		const filePath = isAbsolute(override.file)
			? override.file
			: resolve(process.cwd(), override.file); // nosemgrep
		try {
			return readFileSync(filePath, 'utf-8');
		} catch (error) {
			getLogger().warn(
				`systemPrompt: failed to read file "${filePath}": ${String(error)}`,
			);
			return null;
		}
	}

	return null;
}

/**
 * Build a system prompt dynamically based on development mode, tune config, and available tools.
 *
 * Sections are full quality — the prompt gets smaller only because sections for
 * unavailable tools are excluded entirely, not because content is truncated.
 *
 * When `systemPromptOverride` is provided, the user's custom prompt either replaces
 * the built-in prompt entirely (mode="replace", the default) or is appended to it
 * (mode="append").
 */
export function buildSystemPrompt(
	developmentMode: DevelopmentMode,
	tuneConfig: TuneConfig | undefined,
	availableToolNames: string[],
	toolsDisabled = false,
	systemPromptOverride?: SystemPromptConfig,
	model?: string,
	professionalTone: boolean = getProfessionalTone(),
	toolManager?: ToolManager,
): string {
	const overrideContent = systemPromptOverride
		? resolveSystemPromptOverride(systemPromptOverride)
		: null;
	const overrideMode = systemPromptOverride?.mode ?? 'replace';

	if (overrideContent !== null && overrideMode === 'replace') {
		lastBuiltPrompt = overrideContent;
		return overrideContent;
	}

	const tune = tuneConfig ?? TUNE_DEFAULTS;
	const singleTool =
		tune.enabled && isSingleToolProfile(tune.toolProfile, model);
	const nano = tune.enabled && isNanoProfile(tune.toolProfile, model);
	const toolSet = new Set(availableToolNames);
	const sections: string[] = [];

	// Always included
	sections.push(loadSection('identity'));

	// Core principles — dropped under nano (identity + tool rules cover the essentials)
	if (!nano) {
		sections.push(loadSection('core-principles'));
	}

	// Mode-specific task approach (nano variant when active). Retain a read-only
	// fallback for clients or tool profiles where write_plan is unavailable.
	const planSuffix =
		developmentMode === 'plan' && !toolSet.has('write_plan')
			? '-plan-readonly'
			: `-${developmentMode}`;
	sections.push(
		loadSection(`task-approach${nano ? '-nano' : ''}${planSuffix}`),
	);

	// Tool rules — XML variant when native tool calling is disabled
	let toolRules = loadSection(toolsDisabled ? 'tool-rules-xml' : 'tool-rules');
	if (singleTool) {
		toolRules +=
			'\n- **IMPORTANT**: Call exactly ONE tool per response. Wait for the result before calling the next tool.';
	}
	sections.push(toolRules);

	// File operations — only if any file mutation tools are available
	if (
		toolSet.has('string_replace') ||
		toolSet.has('write_file') ||
		toolSet.has('file_op')
	) {
		sections.push(loadSection(nano ? 'file-editing-nano' : 'file-editing'));
	}

	// Native tool preference — only if bash AND search/discovery tools are both available.
	// Skipped under nano: nano profile has no native search/discovery tools by design.
	if (!nano && toolSet.has('execute_bash') && hasNativeSearchTools(toolSet)) {
		sections.push(loadSection('native-tool-preference'));
	}

	// Git tools — only if any git tools are available
	if (hasAnyGitTool(toolSet)) {
		// Plan mode only has read-only git tools — use plan-specific section
		sections.push(
			loadSection(
				developmentMode === 'plan' ? 'git-tools-readonly' : 'git-tools',
			),
		);
	}

	// Task management — only if write_tasks is available AND not in plan mode
	if (toolSet.has('write_tasks') && developmentMode !== 'plan') {
		sections.push(loadSection('task-management'));
	}

	if (toolSet.has('write_walkthrough') && developmentMode !== 'plan') {
		sections.push(loadSection('walkthrough'));
	}

	// Web tools — only if web_search or fetch_url are available
	if (toolSet.has('web_search') || toolSet.has('fetch_url')) {
		sections.push(loadSection('web-tools'));
	}

	if (toolSet.has('browser')) {
		sections.push(loadSection('browser'));
	}

	// Diagnostics — only if lsp_get_diagnostics is available
	if (toolSet.has('lsp_get_diagnostics')) {
		// Plan mode: check for existing issues, not "fix what you introduce"
		sections.push(
			loadSection(
				developmentMode === 'plan' ? 'diagnostics-readonly' : 'diagnostics',
			),
		);
	}

	// Asking questions — only if ask_user is available
	if (toolSet.has('ask_user')) {
		// Plan mode gets stronger upfront-questioning guidance
		sections.push(
			loadSection(
				developmentMode === 'plan'
					? 'asking-questions-plan'
					: 'asking-questions',
			),
		);
	}

	// Coding practices and constraints — not needed in plan mode
	// (plan task approach already covers the relevant guidance).
	// Under nano, drop coding-practices and use the shortened constraints.
	if (developmentMode !== 'plan') {
		if (!nano) {
			sections.push(loadSection('coding-practices'));
		}
		sections.push(loadSection(nano ? 'constraints-nano' : 'constraints'));
	}

	// Subagents — only if the agent tool is available
	if (toolSet.has('agent')) {
		const subagentSection = loadSection('subagents');
		const subagentInfo = `${subagentSection}

### Available subagents:

${getSubagentDescriptions()}`;
		sections.push(subagentInfo);
	}

	// On-demand MCP Tool Catalog — only when load_tool_schema is available and catalog has unloaded tools
	if (toolSet.has('load_tool_schema') && toolManager) {
		const mcpCatalogSection = toolManager
			.getMcpCatalog()
			.formatCatalogSection();
		if (mcpCatalogSection) {
			sections.push(mcpCatalogSection);
		}
	}

	// Professional ("boring") tone — user preference, opt-in. Placed last among
	// the static sections so it overrides the register of anything above it.
	// Nano gets the shortened variant, like every other section under nano.
	if (professionalTone) {
		sections.push(
			loadSection(nano ? 'professional-tone-nano' : 'professional-tone'),
		);
	}

	// System info (dynamic) — slim variant under nano
	sections.push(generateSystemInfo(nano));

	// Compose and (optionally) append the user-level and project-root AGENTS.md.
	// Nano omits AGENTS.md by default; users can override via tune.includeAgentsMd.
	// Nested files are added at request time by the conversation loops, so this
	// base prompt stays stable and cacheable.
	let prompt = sections.filter(Boolean).join('\n\n');
	if (shouldIncludeAgentsMd(tune, model, systemPromptOverride)) {
		prompt = appendAgentsMd(prompt, {includeNested: false});
	}

	// Append-mode user override (replace mode is handled at the top of the function).
	if (overrideContent !== null && overrideMode === 'append') {
		prompt = `${prompt}\n\n${overrideContent}`;
	}

	// Cache for token-counting callers that don't have access to the inputs
	lastBuiltPrompt = prompt;

	return prompt;
}
