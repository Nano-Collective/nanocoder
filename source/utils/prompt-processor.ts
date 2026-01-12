import {existsSync, readFileSync} from 'fs';
import {homedir, platform, release} from 'os';
import {join} from 'path';
import {promptPath} from '../config/index';
import type {InputState} from '../types/hooks';
import {PlaceholderType} from '../types/hooks';
import {getLogger} from './logging';
import {getCurrentMode, getPlanId, getPlanPhase} from '../context/mode-context';
import {getPlanModePrompt} from './plan/plan-prompt';

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
 * Process the main prompt template by injecting system info and plan mode instructions
 */
export function processPromptTemplate(): string {
	let systemPrompt = 'You are a helpful AI assistant.'; // fallback

	// Load base prompt
	if (existsSync(promptPath)) {
		try {
			systemPrompt = readFileSync(promptPath, 'utf-8');
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			const logger = getLogger();
			logger.warn(
				`Failed to load system prompt from ${promptPath}: ${errorMessage}`,
			);
		}
	}

	// Inject system information
	systemPrompt = injectSystemInfo(systemPrompt);

	// Check for AGENTS.md in current working directory and append it
	const agentsPath = join(process.cwd(), 'AGENTS.md');
	if (existsSync(agentsPath)) {
		try {
			const agentsContent = readFileSync(agentsPath, 'utf-8');
			systemPrompt += `\n\nAdditional Context...\n\n${agentsContent}`;
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			const logger = getLogger();
			logger.warn(
				`Failed to load AGENTS.md from ${agentsPath}: ${errorMessage}`,
			);
		}
	}

	// Inject plan mode instructions if plan mode is active
	const currentMode = getCurrentMode();
	if (currentMode === 'plan') {
		const planId = getPlanId();
		const planPhase = getPlanPhase();

		if (planId) {
			// Get plan mode specific instructions and inject them
			const planPrompt = getPlanModePrompt(planPhase, planId);
			systemPrompt += `\n\n${planPrompt}`;
		}
	}

	return systemPrompt;
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
					// Format file content with header for LLM context
					const fileName =
						placeholderContent.filePath.split('/').pop() ||
						placeholderContent.filePath;
					const header = `=== File: ${fileName} ===`;
					const footer = '='.repeat(header.length);
					replacementContent = `${header}\n${placeholderContent.content}\n${footer}`;
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
