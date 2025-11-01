import {readFileSync, existsSync} from 'fs';
import {join} from 'path';
import {platform, homedir, release} from 'os';
import {promptPath} from '../config/index';
import type {AISDKCoreTool} from '../types/index';
import type {InputState} from '../types/hooks';
import {PlaceholderType} from '../types/hooks';

/**
 * Get the default shell for the current platform
 */
function getDefaultShell(): string {
	const shellEnv = process.env.SHELL;
	if (shellEnv) {
		return shellEnv;
	}

	switch (platform()) {
		case 'win32':
			return process.env.COMSPEC || 'cmd.exe';
		case 'darwin':
			return '/bin/zsh';
		default:
			return '/bin/bash';
	}
}

/**
 * Get a human-readable OS name
 */
function getOSName(): string {
	const plat = platform();
	switch (plat) {
		case 'darwin':
			return 'macOS';
		case 'win32':
			return 'Windows';
		case 'linux':
			return 'Linux';
		default:
			return plat;
	}
}

/**
 * Generate system information string
 */
function generateSystemInfo(): string {
	const now = new Date();
	const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
	const timeStr = now.toTimeString().split(' ')[0]; // HH:MM:SS

	return `Operating System: ${getOSName()}
OS Version: ${release()}
Platform: ${platform()}
Default Shell: ${getDefaultShell()}
Home Directory: ${homedir()}
Current Working Directory: ${process.cwd()}
Current Date: ${dateStr}
Current Time: ${timeStr}`;
}

/**
 * Inject system information into the prompt template
 */
function injectSystemInfo(prompt: string): string {
	const systemInfo = generateSystemInfo();

	return prompt.replace(
		/<!-- DYNAMIC_SYSTEM_INFO_START -->[\s\S]*?<!-- DYNAMIC_SYSTEM_INFO_END -->/,
		systemInfo,
	);
}

/**
 * Process the main prompt template by injecting dynamic tool documentation and system info
 */
export function processPromptTemplate(
	tools: Record<string, AISDKCoreTool>,
): string {
	let systemPrompt = 'You are a helpful AI assistant.'; // fallback

	// Load base prompt
	if (existsSync(promptPath)) {
		try {
			systemPrompt = readFileSync(promptPath, 'utf-8');
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			console.warn(
				`Failed to load system prompt from ${promptPath}: ${errorMessage}`,
			);
		}
	}

	// Inject system information
	systemPrompt = injectSystemInfo(systemPrompt);

	// Inject dynamic tool documentation
	systemPrompt = injectToolDocumentation(systemPrompt, tools);

	// Check for AGENTS.md in current working directory and append it
	const agentsPath = join(process.cwd(), 'AGENTS.md');
	if (existsSync(agentsPath)) {
		try {
			const agentsContent = readFileSync(agentsPath, 'utf-8');
			systemPrompt += `\n\nAdditional Context...\n\n${agentsContent}`;
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			console.warn(
				`Failed to load AGENTS.md from ${agentsPath}: ${errorMessage}`,
			);
		}
	}

	return systemPrompt;
}

/**
 * Inject dynamic tool documentation into the prompt template
 */
function injectToolDocumentation(
	prompt: string,
	tools: Record<string, AISDKCoreTool>,
): string {
	if (Object.keys(tools).length === 0) {
		return prompt.replace(
			/<!-- DYNAMIC_TOOLS_SECTION_START -->[\s\S]*?<!-- DYNAMIC_TOOLS_SECTION_END -->/,
			'No additional tools are currently available.',
		);
	}

	// Generate tool documentation
	const toolDocs = generateToolDocumentation(tools);

	// Replace the dynamic section
	return prompt.replace(
		/<!-- DYNAMIC_TOOLS_SECTION_START -->[\s\S]*?<!-- DYNAMIC_TOOLS_SECTION_END -->/,
		toolDocs,
	);
}

/**
 * Generate formatted documentation for all available tools
 */
function generateToolDocumentation(
	tools: Record<string, AISDKCoreTool>,
): string {
	const sections = ['Available Tools\n'];

	// Convert tools record to array of [name, tool] entries
	const toolEntries = Object.entries(tools);

	// Group tools by category (built-in vs MCP)
	const builtInTools = toolEntries.filter(([name]) => !name.includes('__'));
	const mcpTools = toolEntries.filter(([name]) => name.includes('__'));

	if (builtInTools.length > 0) {
		sections.push('Built-in Tools:\n');
		builtInTools.forEach(([name, tool]) => {
			sections.push(formatToolDocumentation(name, tool));
		});
	}

	if (mcpTools.length > 0) {
		sections.push('\nMCP Tools:\n');
		mcpTools.forEach(([name, tool]) => {
			sections.push(formatToolDocumentation(name, tool));
		});
	}

	// Note: XML format examples omitted since AI SDK tools don't expose parameter schemas
	// The model will learn tool usage from function calling or from the system prompt

	return sections.join('\n');
}

/**
 * Format documentation for a single tool
 */
function formatToolDocumentation(name: string, _tool: AISDKCoreTool): string {
	// AI SDK's Tool type doesn't expose description or parameters directly
	// We just list the tool name - the model will learn from usage
	return `${name}\n`;
}

/**
 * Assemble the final prompt by replacing all placeholders with their full content
 * This function is called before sending the prompt to the AI
 */
export function assemblePrompt(inputState: InputState): string {
	let assembledPrompt = inputState.displayValue;

	// Replace each placeholder with its full content
	Object.entries(inputState.placeholderContent).forEach(
		([placeholderId, placeholderContent]) => {
			// Each placeholder type can have its own replacement logic
			let replacementContent = placeholderContent.content || '';

			// Type-specific content assembly (extensible for future types)
			switch (placeholderContent.type) {
				case PlaceholderType.PASTE: {
					// For paste, use content directly
					replacementContent = placeholderContent.content;
					break;
				}
				case PlaceholderType.FILE: {
					// For file, could add file headers or other formatting
					replacementContent = placeholderContent.content;
					break;
				}
				default: {
					// TypeScript will ensure this is unreachable with proper enum usage
					// Exhaustiveness check to ensure all enum cases are handled
					placeholderContent satisfies never;
					// Fallback for safety, though this should never be reached
					replacementContent = '';
					break;
				}
			}

			// Use the displayText to find and replace the placeholder
			const displayText = placeholderContent.displayText;
			if (displayText) {
				assembledPrompt = assembledPrompt.replace(
					displayText,
					replacementContent,
				);
			} else {
				// Fallback for legacy paste format
				const placeholderPattern = `\\[Paste #${placeholderId}: \\d+ chars\\]`;
				const regex = new RegExp(placeholderPattern, 'g');
				assembledPrompt = assembledPrompt.replace(regex, replacementContent);
			}
		},
	);

	return assembledPrompt;
}
