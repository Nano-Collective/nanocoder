import test from 'ava';
import {
	buildSystemPrompt,
	getLastBuiltPrompt,
	resetSectionCache,
	setLastBuiltPrompt,
} from './prompt-builder.js';
import type {TuneConfig} from '@/types/config';
import {TUNE_DEFAULTS} from '@/types/config';

console.log('\nprompt-builder.spec.ts');

// Reset section cache between tests to ensure clean state
test.beforeEach(() => {
	resetSectionCache();
});

const ALL_TOOLS = [
	'read_file', 'string_replace', 'write_file', 'find_files',
	'search_file_contents', 'execute_bash', 'list_directory',
	'delete_file', 'move_file', 'copy_file', 'create_directory',
	'git_status', 'git_diff', 'git_log', 'git_add', 'git_commit',
	'git_push', 'git_pull', 'git_branch', 'git_stash', 'git_reset', 'git_pr',
	'create_task', 'list_tasks', 'update_task', 'delete_task',
	'ask_user', 'web_search', 'fetch_url', 'lsp_get_diagnostics',
];

const TUNE_MINIMAL: TuneConfig = {
	enabled: true,
	toolProfile: 'minimal',
	aggressiveCompact: false,
};

const TUNE_FULL: TuneConfig = {
	enabled: true,
	toolProfile: 'full',
	aggressiveCompact: false,
};

// ============================================================================
// buildSystemPrompt — identity and core principles always present
// ============================================================================

test('buildSystemPrompt - always includes identity section', t => {
	const result = buildSystemPrompt('normal', undefined, ALL_TOOLS);
	t.true(result.includes('Nanocoder'));
	t.true(result.includes('NEVER assist with malicious'));
});

test('buildSystemPrompt - always includes core principles', t => {
	const result = buildSystemPrompt('normal', undefined, ALL_TOOLS);
	t.true(result.includes('CORE PRINCIPLES'));
	t.true(result.includes('Technical accuracy'));
});

test('buildSystemPrompt - always includes system information', t => {
	const result = buildSystemPrompt('normal', undefined, ALL_TOOLS);
	t.true(result.includes('SYSTEM INFORMATION'));
	t.true(result.includes('Operating System:'));
	t.true(result.includes('Current Date:'));
});

// ============================================================================
// buildSystemPrompt — mode-specific task approach
// ============================================================================

test('buildSystemPrompt - normal mode includes standard task approach', t => {
	const result = buildSystemPrompt('normal', undefined, ALL_TOOLS);
	t.true(result.includes('TASK APPROACH'));
	t.true(result.includes('Simple tasks'));
	t.true(result.includes('Complex tasks'));
});

test('buildSystemPrompt - auto-accept mode includes autonomous approach', t => {
	const result = buildSystemPrompt('auto-accept', undefined, ALL_TOOLS);
	t.true(result.includes('Work autonomously'));
});

test('buildSystemPrompt - plan mode includes planning approach', t => {
	const result = buildSystemPrompt('plan', undefined, ALL_TOOLS);
	t.true(result.includes('PLANNING MODE'));
	t.true(result.includes('Do NOT make changes'));
	t.true(result.includes('structured plan'));
});

test('buildSystemPrompt - scheduler mode includes scheduler approach', t => {
	const result = buildSystemPrompt('scheduler', undefined, ALL_TOOLS);
	t.true(result.includes('scheduled task autonomously'));
});

// ============================================================================
// buildSystemPrompt — tool-based section inclusion
// ============================================================================

test('buildSystemPrompt - includes file operations when edit tools available', t => {
	const result = buildSystemPrompt('normal', undefined, ['read_file', 'string_replace']);
	t.true(result.includes('FILE OPERATIONS'));
});

test('buildSystemPrompt - excludes file operations when no edit tools', t => {
	const result = buildSystemPrompt('normal', undefined, ['read_file', 'find_files']);
	t.false(result.includes('FILE OPERATIONS'));
});

test('buildSystemPrompt - includes git section when git tools available', t => {
	const result = buildSystemPrompt('normal', undefined, ['git_status', 'git_diff']);
	t.true(result.includes('GIT'));
});

test('buildSystemPrompt - excludes git section when no git tools', t => {
	const result = buildSystemPrompt('normal', undefined, ['read_file', 'execute_bash']);
	t.false(result.includes('## GIT'));
});

test('buildSystemPrompt - includes task management when create_task available', t => {
	const result = buildSystemPrompt('normal', undefined, ['create_task']);
	t.true(result.includes('TASK MANAGEMENT'));
});

test('buildSystemPrompt - excludes task management in plan mode', t => {
	const result = buildSystemPrompt('plan', undefined, ['create_task', 'read_file']);
	t.false(result.includes('TASK MANAGEMENT'));
});

test('buildSystemPrompt - includes web tools when web_search available', t => {
	const result = buildSystemPrompt('normal', undefined, ['web_search']);
	t.true(result.includes('WEB ACCESS'));
});

test('buildSystemPrompt - includes diagnostics when lsp available', t => {
	const result = buildSystemPrompt('normal', undefined, ['lsp_get_diagnostics']);
	t.true(result.includes('DIAGNOSTICS'));
});

test('buildSystemPrompt - includes asking questions when ask_user available', t => {
	const result = buildSystemPrompt('normal', undefined, ['ask_user']);
	t.true(result.includes('ASKING QUESTIONS'));
});

test('buildSystemPrompt - includes native tool preference when bash + search tools', t => {
	const result = buildSystemPrompt('normal', undefined, ['execute_bash', 'find_files', 'search_file_contents']);
	t.true(result.includes('TOOL SELECTION'));
	t.true(result.includes('Anti-patterns'));
});

test('buildSystemPrompt - excludes native tool preference when no search tools', t => {
	// Only read_file as exploration tool — not enough for anti-pattern guidance
	const result = buildSystemPrompt('normal', undefined, ['execute_bash', 'read_file']);
	t.false(result.includes('Anti-patterns'));
});

// ============================================================================
// buildSystemPrompt — plan mode specifics
// ============================================================================

test('buildSystemPrompt - plan mode uses readonly git section', t => {
	const result = buildSystemPrompt('plan', undefined, ['git_status', 'git_diff', 'git_log']);
	t.true(result.includes('GIT'));
	t.true(result.includes('understand the current state'));
	t.false(result.includes('Reserve bash'));
});

test('buildSystemPrompt - plan mode uses readonly diagnostics', t => {
	const result = buildSystemPrompt('plan', undefined, ['lsp_get_diagnostics']);
	t.true(result.includes('DIAGNOSTICS'));
	t.true(result.includes('existing errors'));
	t.false(result.includes('Fix diagnostics issues you introduce'));
});

test('buildSystemPrompt - plan mode excludes coding practices', t => {
	const result = buildSystemPrompt('plan', undefined, ALL_TOOLS);
	t.false(result.includes('CODING PRACTICES'));
});

test('buildSystemPrompt - plan mode excludes constraints', t => {
	const result = buildSystemPrompt('plan', undefined, ALL_TOOLS);
	t.false(result.includes('## CONSTRAINTS'));
});

// ============================================================================
// buildSystemPrompt — single-tool enforcement
// ============================================================================

test('buildSystemPrompt - minimal profile appends single-tool instruction', t => {
	const result = buildSystemPrompt('normal', TUNE_MINIMAL, ['read_file', 'write_file', 'string_replace', 'execute_bash', 'find_files', 'search_file_contents', 'list_directory']);
	t.true(result.includes('Call exactly ONE tool per response'));
});

test('buildSystemPrompt - full profile does not append single-tool instruction', t => {
	const result = buildSystemPrompt('normal', TUNE_FULL, ALL_TOOLS);
	t.false(result.includes('Call exactly ONE tool per response'));
});

test('buildSystemPrompt - disabled tune does not append single-tool instruction', t => {
	const result = buildSystemPrompt('normal', TUNE_DEFAULTS, ALL_TOOLS);
	t.false(result.includes('Call exactly ONE tool per response'));
});

// ============================================================================
// buildSystemPrompt — XML fallback
// ============================================================================

test('buildSystemPrompt - native mode uses standard tool rules', t => {
	const result = buildSystemPrompt('normal', undefined, ALL_TOOLS, false);
	t.true(result.includes('TOOL USE'));
	t.false(result.includes('does not support native tool calling'));
});

test('buildSystemPrompt - XML fallback uses XML tool rules', t => {
	const result = buildSystemPrompt('normal', undefined, ALL_TOOLS, true);
	t.true(result.includes('does not support native tool calling'));
	t.true(result.includes('<tool_name>'));
	t.true(result.includes('<param1>value1</param1>'));
});

// ============================================================================
// getLastBuiltPrompt
// ============================================================================

test('getLastBuiltPrompt - returns fallback before any build', t => {
	const result = getLastBuiltPrompt();
	t.true(result.includes('Nanocoder'));
});

test('getLastBuiltPrompt - returns last built prompt after build', t => {
	buildSystemPrompt('normal', undefined, ALL_TOOLS);
	const result = getLastBuiltPrompt();
	t.true(result.includes('CORE PRINCIPLES'));
	t.true(result.includes('TASK APPROACH'));
});

// ============================================================================
// buildSystemPrompt — prompt size varies by config
// ============================================================================

test('buildSystemPrompt - minimal profile produces smaller prompt than full', t => {
	const fullPrompt = buildSystemPrompt('normal', TUNE_FULL, ALL_TOOLS);
	const minimalPrompt = buildSystemPrompt('normal', TUNE_MINIMAL, ['read_file', 'write_file', 'string_replace', 'execute_bash', 'find_files', 'search_file_contents', 'list_directory']);
	t.true(minimalPrompt.length < fullPrompt.length);
});

test('buildSystemPrompt - plan mode produces smaller prompt than normal', t => {
	const normalPrompt = buildSystemPrompt('normal', undefined, ALL_TOOLS);
	const planPrompt = buildSystemPrompt('plan', undefined, ALL_TOOLS);
	t.true(planPrompt.length < normalPrompt.length);
});

// ============================================================================
// setLastBuiltPrompt — cache override for post-processing
// ============================================================================

test('setLastBuiltPrompt - overrides the cached prompt', t => {
	buildSystemPrompt('normal', undefined, ALL_TOOLS);
	const before = getLastBuiltPrompt();

	const augmented = before + '\n\n## EXTRA TOOL DEFINITIONS\n...lots of XML...';
	setLastBuiltPrompt(augmented);

	const after = getLastBuiltPrompt();
	t.is(after, augmented);
	t.true(after.length > before.length);
});

test('buildSystemPrompt - XML fallback prompt differs from native prompt', t => {
	const nativePrompt = buildSystemPrompt('normal', undefined, ALL_TOOLS, false);
	const xmlPrompt = buildSystemPrompt('normal', undefined, ALL_TOOLS, true);

	// They should differ — XML version has different tool rules section
	t.not(nativePrompt, xmlPrompt);
	// XML version includes XML format instructions
	t.true(xmlPrompt.includes('does not support native tool calling'));
	t.false(nativePrompt.includes('does not support native tool calling'));
});
