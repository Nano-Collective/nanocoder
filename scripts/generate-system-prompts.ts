/**
 * Generates all system prompt variants for review.
 * Run: pnpm generate:system-prompts
 * Output: .generated-prompts/ (git-ignored)
 *
 * Uses the real tool definitions and formatters — never goes stale.
 */

import {existsSync, mkdirSync, writeFileSync} from 'fs';
import {dirname, join} from 'path';
import {fileURLToPath} from 'url';
import {formatToolsForPrompt} from '@/ai-sdk-client/tools/tool-prompt-formatter';
import {allToolExports} from '@/tools/index';
import {getToolsForProfile} from '@/tools/tool-profiles';
import {ToolRegistry} from '@/tools/tool-registry';
import type {ToolProfile, TuneConfig} from '@/types/config';
import type {AISDKCoreTool, DevelopmentMode} from '@/types/core';
import {buildSystemPrompt} from '@/utils/prompt-builder';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const outputDir = join(__dirname, '../.generated-prompts');

// Build a real ToolRegistry from actual tool exports
const registry = ToolRegistry.fromToolExports(allToolExports);

interface Variant {
	name: string;
	mode: DevelopmentMode;
	profile: ToolProfile;
	toolsDisabled?: boolean;
}

// Mode exclusions (mirrored from tool-manager.ts)
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

function getAvailableNames(
	mode: DevelopmentMode,
	profile: ToolProfile,
): string[] {
	let names = registry.getToolNames();

	if (profile !== 'full') {
		const profileTools = getToolsForProfile(profile);
		if (profileTools.length > 0) {
			names = profileTools;
		}
	}

	const excluded = MODE_EXCLUDED_TOOLS[mode];
	if (excluded.length > 0) {
		const excludeSet = new Set(excluded);
		names = names.filter(n => !excludeSet.has(n));
	}

	return names;
}

function buildFullPrompt(v: Variant): string {
	const availableNames = getAvailableNames(v.mode, v.profile);

	// Build the base system prompt using the real builder
	const tuneConfig: TuneConfig | undefined =
		v.profile === 'minimal'
			? {enabled: true, toolProfile: 'minimal', aggressiveCompact: false}
			: undefined;
	let prompt = buildSystemPrompt(
		v.mode,
		tuneConfig,
		availableNames,
		v.toolsDisabled,
	);

	// For XML fallback variants, append real tool definitions
	if (v.toolsDisabled) {
		const nativeTools = registry.getNativeToolsWithoutExecute();
		const nameSet = new Set(availableNames);
		const filteredTools: Record<string, AISDKCoreTool> = {};
		for (const [name, tool] of Object.entries(nativeTools)) {
			if (nameSet.has(name)) {
				filteredTools[name] = tool;
			}
		}

		// Always use full formatter — examples help small models get XML right
		const toolDefs = formatToolsForPrompt(filteredTools);
		if (toolDefs) {
			prompt += toolDefs;
		}
	}

	return prompt;
}

// Define variants: 2 profiles × 4 modes × 2 tool modes = 16 variants
const variants: Variant[] = [
	// Native tool calling
	{name: 'full-normal', mode: 'normal', profile: 'full'},
	{name: 'full-auto-accept', mode: 'auto-accept', profile: 'full'},
	{name: 'full-plan', mode: 'plan', profile: 'full'},
	{name: 'full-scheduler', mode: 'scheduler', profile: 'full'},
	{name: 'minimal-normal', mode: 'normal', profile: 'minimal'},
	{name: 'minimal-auto-accept', mode: 'auto-accept', profile: 'minimal'},
	{name: 'minimal-plan', mode: 'plan', profile: 'minimal'},
	{name: 'minimal-scheduler', mode: 'scheduler', profile: 'minimal'},

	// XML fallback
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
}

const results: GeneratedPrompt[] = [];

for (const v of variants) {
	const prompt = buildFullPrompt(v);
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
