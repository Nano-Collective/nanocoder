/**
 * Generates all system prompt variants for review.
 * Run: pnpm generate:system-prompts
 * Output: .generated-prompts/ (git-ignored)
 */

import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {basename, dirname, join, normalize} from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const sectionsDir = join(__dirname, '../source/app/prompts/sections');
const outputDir = join(__dirname, '../.generated-prompts');

// Types (inline to avoid import issues running standalone)
type DevelopmentMode = 'normal' | 'auto-accept' | 'plan' | 'scheduler';
type ToolProfile = 'full' | 'minimal';

interface Variant {
	name: string;
	mode: DevelopmentMode;
	profile: ToolProfile;
	toolsDisabled?: boolean;
}

// Tool profile definitions (mirrored from tool-profiles.ts)
const TOOL_PROFILES: Record<ToolProfile, string[]> = {
	full: [],
	minimal: ['read_file', 'string_replace', 'execute_bash'],
};

// Tool descriptions (snapshot of what the model sees via tool definitions)
const TOOL_DOCS: Record<string, {description: string; params: string}> = {
	read_file: {
		description:
			'Read file contents with line numbers. AUTO-ACCEPTED. Use INSTEAD OF bash cat/head/tail. Files >300 lines return metadata first.',
		params:
			'path (string, required), start_line (number), end_line (number), metadata_only (boolean)',
	},
	string_replace: {
		description:
			'Replace exact string content in a file. PRIMARY EDIT TOOL. Match must be unique.',
		params:
			'path (string, required), old_str (string, required), new_str (string, required)',
	},
	write_file: {
		description:
			'Write entire file contents. Use for new files or complete rewrites.',
		params: 'path (string, required), content (string, required)',
	},
	find_files: {
		description: 'Find files matching a glob pattern. AUTO-ACCEPTED.',
		params: 'pattern (string, required), path (string), maxResults (number)',
	},
	search_file_contents: {
		description: 'Search for text/regex patterns across files. AUTO-ACCEPTED.',
		params:
			'query (string, required), path (string), include (string), caseSensitive (boolean)',
	},
	execute_bash: {
		description: 'Execute a bash command in the terminal.',
		params: 'command (string, required), timeout (number)',
	},
	list_directory: {
		description: 'List directory contents. AUTO-ACCEPTED.',
		params:
			'path (string, required), recursive (boolean), maxDepth (number), tree (boolean)',
	},
	delete_file: {
		description: 'Delete a file. Always requires approval.',
		params: 'path (string, required)',
	},
	move_file: {
		description: 'Move or rename a file.',
		params: 'source (string, required), destination (string, required)',
	},
	copy_file: {
		description: 'Copy a file to a new location.',
		params: 'source (string, required), destination (string, required)',
	},
	create_directory: {
		description:
			'Create a directory including parent directories. AUTO-ACCEPTED.',
		params: 'path (string, required)',
	},
	git_status: {
		description:
			'View repository status, branch info, staged/unstaged changes. AUTO-ACCEPTED.',
		params: 'short (boolean)',
	},
	git_diff: {
		description:
			'View diffs (working tree, staged, or against a branch). AUTO-ACCEPTED.',
		params: 'staged (boolean), branch (string), path (string)',
	},
	git_log: {
		description: 'View commit history with filters. AUTO-ACCEPTED.',
		params: 'count (number), branch (string), author (string), since (string)',
	},
	git_add: {
		description: 'Stage files for commit.',
		params: 'files (string[]), all (boolean)',
	},
	git_commit: {
		description: 'Create a commit. Always requires approval.',
		params: 'message (string, required)',
	},
	git_push: {
		description: 'Push to remote. Always requires approval.',
		params: 'remote (string), branch (string), force (boolean)',
	},
	git_pull: {
		description: 'Pull from remote.',
		params: 'remote (string), branch (string), rebase (boolean)',
	},
	git_branch: {
		description: 'List, create, switch, or delete branches.',
		params: 'action (string, required), name (string)',
	},
	git_stash: {
		description: 'Save, list, apply, pop, or clear stashes.',
		params: 'action (string, required), message (string)',
	},
	git_reset: {
		description: 'Unstage files or reset commits. Warns on hard reset.',
		params: 'mode (string), commit (string), files (string[])',
	},
	git_pr: {
		description: 'Create, view, or list GitHub PRs. Requires gh CLI.',
		params: 'action (string, required), title (string), body (string)',
	},
	create_task: {
		description: 'Create one or more tasks for tracking progress.',
		params: 'tasks (array, required)',
	},
	list_tasks: {
		description: 'View all tasks, optionally filter by status.',
		params: 'status (string)',
	},
	update_task: {
		description: 'Update task status to pending, in_progress, or completed.',
		params: 'id (number, required), status (string, required)',
	},
	delete_task: {
		description: 'Remove a task by ID or clear all.',
		params: 'id (number), clear_all (boolean)',
	},
	ask_user: {
		description: 'Present the user with a structured choice for clarification.',
		params: 'question (string, required), options (string[])',
	},
	web_search: {
		description: 'Search the web for documentation, APIs, and solutions.',
		params: 'query (string, required), maxResults (number)',
	},
	fetch_url: {
		description: 'Fetch content from a specific URL.',
		params: 'url (string, required)',
	},
	lsp_get_diagnostics: {
		description: 'Get LSP diagnostics (errors, warnings, linting) for a file.',
		params: 'path (string, required)',
	},
};

function formatToolDocs(toolNames: string[], xml: boolean): string {
	const header = xml
		? '\n\n---\n\n## AVAILABLE TOOLS\n\nUse XML format: `<tool_name><param>value</param></tool_name>`\n'
		: '\n\n---\n\n## AVAILABLE TOOLS (passed via native tool calling)\n';

	let output = header;
	for (const name of toolNames) {
		const doc = TOOL_DOCS[name];
		if (!doc) continue;
		output += `\n### ${name}\n${doc.description}\n**Params**: ${doc.params}\n`;
	}
	return output;
}

// Simulated full tool list
const ALL_TOOLS = [
	'read_file',
	'string_replace',
	'write_file',
	'find_files',
	'search_file_contents',
	'execute_bash',
	'list_directory',
	'delete_file',
	'move_file',
	'copy_file',
	'create_directory',
	'git_status',
	'git_diff',
	'git_log',
	'git_add',
	'git_commit',
	'git_push',
	'git_pull',
	'git_branch',
	'git_stash',
	'git_reset',
	'git_pr',
	'create_task',
	'list_tasks',
	'update_task',
	'delete_task',
	'ask_user',
	'web_search',
	'fetch_url',
	'lsp_get_diagnostics',
];

function getSectionFilePath(name: string): string {
	const normalizedName = normalize(name).replace(/^([/\\])+/, '');
	const safeName = basename(normalizedName);
	return join(sectionsDir, `${safeName}.md`);
}

function loadSection(name: string): string {
	const filePath = getSectionFilePath(name);
	try {
		return readFileSync(filePath, 'utf-8').trim();
	} catch {
		return '';
	}
}

// Tools to exclude per mode
const MODE_EXCLUDED_TOOLS: Record<DevelopmentMode, string[]> = {
	normal: [],
	'auto-accept': [],
	plan: [
		'write_file',
		'string_replace',
		'delete_file',
		'move_file',
		'copy_file',
		'create_directory',
		'execute_bash',
		'create_task',
		'update_task',
		'delete_task',
		'list_tasks',
		'git_add',
		'git_commit',
		'git_push',
		'git_pull',
		'git_branch',
		'git_stash',
		'git_reset',
	],
	scheduler: ['ask_user'],
};

const NATIVE_SEARCH_TOOLS = new Set([
	'find_files',
	'search_file_contents',
	'list_directory',
]);

function getToolSet(
	mode: DevelopmentMode,
	toolNames: string[],
	profile: ToolProfile,
): Set<string> {
	// Plan mode + minimal: curated exploration set
	if (mode === 'plan' && profile === 'minimal') {
		return new Set([
			'read_file',
			'find_files',
			'search_file_contents',
			'list_directory',
		]);
	}
	const excluded = new Set(MODE_EXCLUDED_TOOLS[mode]);
	return new Set(toolNames.filter(n => !excluded.has(n)));
}

function buildPrompt(
	mode: DevelopmentMode,
	toolNames: string[],
	profile: ToolProfile,
	toolsDisabled = false,
): string {
	const singleTool = profile === 'minimal';
	const toolSet = getToolSet(mode, toolNames, profile);
	const sections: string[] = [];

	sections.push(loadSection('identity'));
	sections.push(loadSection('core-principles'));
	sections.push(loadSection(`task-approach-${mode}`));

	let toolRules = loadSection(toolsDisabled ? 'tool-rules-xml' : 'tool-rules');
	if (singleTool) {
		toolRules +=
			'\n- **IMPORTANT**: Call exactly ONE tool per response. Wait for the result before calling the next tool.';
	}
	sections.push(toolRules);

	// File operations — only if file mutation tools are available
	if (
		toolSet.has('string_replace') ||
		toolSet.has('write_file') ||
		toolSet.has('delete_file') ||
		toolSet.has('move_file') ||
		toolSet.has('copy_file') ||
		toolSet.has('create_directory')
	) {
		sections.push(loadSection('file-editing'));
	}

	// Native tool preference — only if bash AND search tools are both available
	if (
		toolSet.has('execute_bash') &&
		[...NATIVE_SEARCH_TOOLS].some(t => toolSet.has(t))
	) {
		sections.push(loadSection('native-tool-preference'));
	}

	// Git tools — plan mode gets read-only variant
	if ([...toolSet].some(n => n.startsWith('git_'))) {
		sections.push(
			loadSection(mode === 'plan' ? 'git-tools-readonly' : 'git-tools'),
		);
	}

	// Task management — not in plan mode
	if (toolSet.has('create_task') && mode !== 'plan') {
		sections.push(loadSection('task-management'));
	}

	if (toolSet.has('web_search') || toolSet.has('fetch_url')) {
		sections.push(loadSection('web-tools'));
	}

	// Diagnostics — plan mode gets read-only variant
	if (toolSet.has('lsp_get_diagnostics')) {
		sections.push(
			loadSection(mode === 'plan' ? 'diagnostics-readonly' : 'diagnostics'),
		);
	}

	if (toolSet.has('ask_user')) {
		sections.push(loadSection('asking-questions'));
	}

	// Coding practices and constraints — not needed in plan mode
	if (mode !== 'plan') {
		sections.push(loadSection('coding-practices'));
		sections.push(loadSection('constraints'));
	}

	sections.push(
		'## SYSTEM INFORMATION\n\nOperating System: macOS\nPlatform: darwin\nDefault Shell: /bin/zsh\nHome Directory: /Users/example\nCurrent Working Directory: /Users/example/project\nCurrent Date: 2026-03-30',
	);

	return sections.filter(Boolean).join('\n\n');
}

// Define the variants to generate — 2 profiles × 4 modes = 8 variants
const variants: Variant[] = [
	// Full profile across all modes
	{name: 'full-normal', mode: 'normal', profile: 'full'},
	{name: 'full-auto-accept', mode: 'auto-accept', profile: 'full'},
	{name: 'full-plan', mode: 'plan', profile: 'full'},
	{name: 'full-scheduler', mode: 'scheduler', profile: 'full'},

	// Minimal profile across all modes (auto single-tool)
	{name: 'minimal-normal', mode: 'normal', profile: 'minimal'},
	{name: 'minimal-auto-accept', mode: 'auto-accept', profile: 'minimal'},
	{name: 'minimal-plan', mode: 'plan', profile: 'minimal'},
	{name: 'minimal-scheduler', mode: 'scheduler', profile: 'minimal'},

	// XML fallback — full profile across all modes
	{
		name: 'full-normal-xml',
		mode: 'normal',
		profile: 'full',
		toolsDisabled: true,
	},
	{
		name: 'full-auto-accept-xml',
		mode: 'auto-accept',
		profile: 'full',
		toolsDisabled: true,
	},
	{name: 'full-plan-xml', mode: 'plan', profile: 'full', toolsDisabled: true},
	{
		name: 'full-scheduler-xml',
		mode: 'scheduler',
		profile: 'full',
		toolsDisabled: true,
	},

	// XML fallback — minimal profile across all modes
	{
		name: 'minimal-normal-xml',
		mode: 'normal',
		profile: 'minimal',
		toolsDisabled: true,
	},
	{
		name: 'minimal-auto-accept-xml',
		mode: 'auto-accept',
		profile: 'minimal',
		toolsDisabled: true,
	},
	{
		name: 'minimal-plan-xml',
		mode: 'plan',
		profile: 'minimal',
		toolsDisabled: true,
	},
	{
		name: 'minimal-scheduler-xml',
		mode: 'scheduler',
		profile: 'minimal',
		toolsDisabled: true,
	},
];

// Generate
if (!existsSync(outputDir)) {
	mkdirSync(outputDir, {recursive: true});
}

console.log(`Generating ${variants.length} system prompt variants...\n`);

interface GeneratedPrompt {
	filename: string;
	lines: number;
	words: number;
	chars: number;
	label: string;
	prompt: string;
}

const results: GeneratedPrompt[] = [];

for (const v of variants) {
	const toolNames = v.profile === 'full' ? ALL_TOOLS : TOOL_PROFILES[v.profile];
	const toolSet = getToolSet(v.mode, toolNames, v.profile);
	const availableNames = [...toolSet];
	const basePrompt = buildPrompt(v.mode, toolNames, v.profile, v.toolsDisabled);
	const prompt = v.toolsDisabled
		? basePrompt + formatToolDocs(availableNames, true)
		: basePrompt;

	const filename = `${v.name}.md`;
	writeFileSync(join(outputDir, filename), prompt);

	results.push({
		filename,
		lines: prompt.split('\n').length,
		words: prompt.split(/\s+/).length,
		chars: prompt.length,
		label: [
			`mode:${v.mode}`,
			`profile:${v.profile}`,
			v.toolsDisabled ? 'xml-fallback' : '',
		]
			.filter(Boolean)
			.join(', '),
		prompt,
	});
}

// Sort by size (smallest first)
results.sort((a, b) => a.chars - b.chars);

const summary: string[] = [];
for (const r of results) {
	const tokens = Math.ceil(r.chars / 4);
	const line = `  ${r.filename.padEnd(35)} ${String(r.lines).padStart(4)} lines  ${String(r.words).padStart(5)} words  ${String(r.chars).padStart(6)} chars  ~${String(tokens).padStart(5)} tokens  (${r.label})`;
	summary.push(line);
	console.log(line);
}

// Write index
const index = `# Generated System Prompts (sorted by size)

Generated: ${new Date().toISOString()}

${summary.join('\n')}
`;
writeFileSync(join(outputDir, 'INDEX.md'), index);

console.log(`\nOutput: .generated-prompts/`);
console.log(`Index:  .generated-prompts/INDEX.md`);
