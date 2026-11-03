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
import {getAllToolExports} from '@/tools/index';
import {getToolsForProfile} from '@/tools/tool-profiles';
import {ToolRegistry} from '@/tools/tool-registry';
import type {ToolProfile, TuneConfig} from '@/types/config';
import type {AISDKCoreTool, DevelopmentMode} from '@/types/core';
import {buildSystemPrompt} from '@/utils/prompt-builder';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const outputDir = join(__dirname, '../.generated-prompts');

// Build a real ToolRegistry from actual tool exports
const registry = ToolRegistry.fromToolExports(getAllToolExports());

interface Variant {
	name: string;
	mode: DevelopmentMode;
	profile: ToolProfile;
	toolsDisabled?: boolean;
}

// Mode exclusions (mirrored from source/tools/tool-manager.ts)
const MODE_EXCLUDED_TOOLS: Record<DevelopmentMode, string[]> = {
	normal: ['write_plan'],
	'auto-accept': ['write_plan'],
	yolo: ['write_plan'],
	plan: [
		'write_file',
		'string_replace',
		'diff_edit',
		'file_op',
		'lsp_format_document',
		'execute_bash',
		'browser',
		'write_tasks',
		'write_walkthrough',
		'git_add',
		'git_commit',
		'git_pr',
	],
	headless: ['ask_user', 'agent', 'write_plan'],
	architect: ['write_plan', 'git_commit', 'git_pr'],
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
		v.profile === 'full'
			? undefined
			: {enabled: true, toolProfile: v.profile, aggressiveCompact: false};
	let prompt = buildSystemPrompt(
		v.mode,
		tuneConfig,
		availableNames,
		v.toolsDisabled,
	);

	// For XML fallback variants, append real tool definitions
	if (v.toolsDisabled) {
		const nativeTools = registry.getNativeTools();
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

// Define variants: 3 profiles × 6 modes × 2 tool modes = 36 variants
const modes = Object.keys(MODE_EXCLUDED_TOOLS) as DevelopmentMode[];
const profiles: ToolProfile[] = ['full', 'minimal', 'nano'];
const variants: Variant[] = [];
for (const toolsDisabled of [false, true]) {
	for (const profile of profiles) {
		for (const mode of modes) {
			variants.push({
				name: `${profile}-${mode}${toolsDisabled ? '-xml' : ''}`,
				mode,
				profile,
				...(toolsDisabled ? {toolsDisabled} : {}),
			});
		}
	}
}

function main(): void {
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
}

try {
	main();
} catch (error) {
	console.error('Failed to generate system prompts:');
	console.error(error);
	process.exit(1);
}
