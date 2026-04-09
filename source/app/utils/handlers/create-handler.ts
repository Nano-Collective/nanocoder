import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import React from 'react';
import {ErrorMessage, SuccessMessage} from '@/components/message-box';
import {getSubagentLoader} from '@/subagents/subagent-loader';
import type {SubagentConfigWithSource} from '@/subagents/types';
import type {MessageSubmissionOptions} from '@/types/index';

/**
 * Handles /schedule start — enters scheduler mode.
 * Returns true if handled.
 */
export async function handleScheduleStart(
	commandParts: string[],
	options: MessageSubmissionOptions,
): Promise<boolean> {
	if (commandParts[0] !== 'schedule' || commandParts[1] !== 'start') {
		return false;
	}

	const {onEnterSchedulerMode, onCommandComplete} = options;

	if (onEnterSchedulerMode) {
		onEnterSchedulerMode();
		onCommandComplete?.();
	} else {
		options.onAddToChatQueue(
			React.createElement(ErrorMessage, {
				key: `schedule-error-${options.getNextComponentKey()}`,
				message: 'Scheduler mode is not available.',
			}),
		);
		onCommandComplete?.();
	}

	return true;
}

/**
 * Creates a markdown file with frontmatter template and asks the AI to help write it.
 * Shared logic for /schedule create and /commands create.
 */
async function handleFileCreate(
	fileName: string | undefined,
	dirName: string,
	entityName: string,
	aiPrompt: (safeName: string, commandBaseName: string) => string,
	options: MessageSubmissionOptions,
): Promise<boolean> {
	const {
		onAddToChatQueue,
		onHandleChatMessage,
		onCommandComplete,
		getNextComponentKey,
	} = options;

	if (!fileName) {
		onAddToChatQueue(
			React.createElement(ErrorMessage, {
				key: `${entityName}-create-error-${getNextComponentKey()}`,
				message: `Usage: /${entityName} create <name>\nExample: /${entityName} create ${entityName === 'schedule' ? 'deps-update' : 'review-code'}`,
			}),
		);
		onCommandComplete?.();
		return true;
	}

	const safeName = fileName.endsWith('.md') ? fileName : `${fileName}.md`;
	const targetDir = join(process.cwd(), '.nanocoder', dirName);
	const filePath = join(targetDir, safeName);

	if (existsSync(filePath)) {
		onAddToChatQueue(
			React.createElement(ErrorMessage, {
				key: `${entityName}-create-exists-${getNextComponentKey()}`,
				message: `${entityName === 'schedule' ? 'Schedule' : 'Command'} file already exists: .nanocoder/${dirName}/${safeName}`,
			}),
		);
		onCommandComplete?.();
		return true;
	}

	mkdirSync(targetDir, {recursive: true});

	const template = `---
description: ${safeName.replace(/\.md$/, '')} ${entityName === 'schedule' ? 'scheduled command' : 'custom command'}
---

`;

	writeFileSync(filePath, template, 'utf-8');

	onAddToChatQueue(
		React.createElement(SuccessMessage, {
			key: `${entityName}-created-${getNextComponentKey()}`,
			message: `Created ${entityName} file: .nanocoder/${dirName}/${safeName}`,
			hideBox: true,
		}),
	);

	const commandBaseName = safeName.replace(/\.md$/, '');
	await onHandleChatMessage(aiPrompt(safeName, commandBaseName));

	return true;
}

/**
 * Handles /schedule create — creates the schedule file and prompts the AI to help write it.
 * Returns true if handled.
 */
export async function handleScheduleCreate(
	commandParts: string[],
	options: MessageSubmissionOptions,
): Promise<boolean> {
	if (commandParts[0] !== 'schedule' || commandParts[1] !== 'create') {
		return false;
	}

	return handleFileCreate(
		commandParts[2],
		'schedules',
		'schedule',
		safeName =>
			`I just created a new schedule command file at .nanocoder/schedules/${safeName}. Help me write the content for this scheduled task. Ask me what I want this scheduled job to do, then write the markdown prompt into the file using the write_file tool. The file should contain a clear prompt that instructs the AI agent what to do when this schedule runs. Keep the YAML frontmatter at the top with the description field.`,
		options,
	);
}

/**
 * Handles /agents create — creates an agent definition file and prompts the AI to help write it.
 * Returns true if handled.
 */
export async function handleAgentCreate(
	commandParts: string[],
	options: MessageSubmissionOptions,
): Promise<boolean> {
	if (commandParts[0] !== 'agents' || commandParts[1] !== 'create') {
		return false;
	}

	const {
		onAddToChatQueue,
		onHandleChatMessage,
		onCommandComplete,
		getNextComponentKey,
	} = options;

	const fileName = commandParts[2];

	if (!fileName) {
		onAddToChatQueue(
			React.createElement(ErrorMessage, {
				key: `agents-create-error-${getNextComponentKey()}`,
				message:
					'Usage: /agents create <name>\nExample: /agents create code-reviewer',
			}),
		);
		onCommandComplete?.();
		return true;
	}

	const safeName = fileName.endsWith('.md') ? fileName : `${fileName}.md`;
	const targetDir = join(process.cwd(), '.nanocoder', 'agents');
	const filePath = join(targetDir, safeName);

	if (existsSync(filePath)) {
		onAddToChatQueue(
			React.createElement(ErrorMessage, {
				key: `agents-create-exists-${getNextComponentKey()}`,
				message: `Agent file already exists: .nanocoder/agents/${safeName}`,
			}),
		);
		onCommandComplete?.();
		return true;
	}

	mkdirSync(targetDir, {recursive: true});

	const agentName = safeName.replace(/\.md$/, '');
	const template = `---
name: ${agentName}
description: TODO - describe when to use this agent
model: inherit
---

TODO - write the system prompt for this agent
`;

	writeFileSync(filePath, template, 'utf-8');

	onAddToChatQueue(
		React.createElement(SuccessMessage, {
			key: `agents-created-${getNextComponentKey()}`,
			message: `Created agent file: .nanocoder/agents/${safeName}`,
			hideBox: true,
		}),
	);

	await onHandleChatMessage(
		`I just created a new subagent definition file at .nanocoder/agents/${safeName}. Help me write the content for this agent. Ask me what I want this agent to specialize in, then write the complete markdown file using the write_file tool.

Here is the frontmatter format with all available fields:

---
name: ${agentName}
description: When to use this agent (shown to the LLM)
provider:               # Optional: provider name from agents.config.json (uses parent's if not set)
model: inherit          # inherit, or a model ID available on the provider
tools:                  # Optional: restrict to specific tools
  - read_file
  - search_file_contents
  - find_files
disallowedTools:        # Optional: block specific tools
  - write_file
  - string_replace
---

The body after the frontmatter is the system prompt that instructs the agent how to behave. Make it focused and specific to the agent's purpose.`,
	);

	return true;
}

/**
 * Reconstruct the markdown file content from a SubagentConfigWithSource.
 * If the agent was loaded from a file, read the original content.
 * Otherwise, reconstruct from the parsed config.
 */
function buildAgentMarkdown(agent: SubagentConfigWithSource): string {
	// If we have the source file path, read the original content directly
	if (agent.source.filePath) {
		try {
			return readFileSync(agent.source.filePath, 'utf-8');
		} catch {
			// Fall through to reconstruction
		}
	}

	// Reconstruct from config
	const frontmatter: Record<string, unknown> = {
		name: agent.name,
		description: agent.description,
	};

	if (agent.provider) frontmatter.provider = agent.provider;
	frontmatter.model = agent.model || 'inherit';
	if (agent.tools && agent.tools.length > 0) frontmatter.tools = agent.tools;
	if (agent.disallowedTools && agent.disallowedTools.length > 0)
		frontmatter.disallowedTools = agent.disallowedTools;
	// Build YAML manually to keep it clean
	let yaml = '---\n';
	for (const [key, value] of Object.entries(frontmatter)) {
		if (Array.isArray(value)) {
			yaml += `${key}:\n`;
			for (const item of value) {
				yaml += `  - ${item}\n`;
			}
		} else {
			yaml += `${key}: ${value}\n`;
		}
	}
	yaml += '---\n\n';

	return yaml + agent.systemPrompt + '\n';
}

/**
 * Handles /agents copy <name> — copies an agent (including built-in) to
 * .nanocoder/agents/ so it can be customized.
 * Returns true if handled.
 */
export async function handleAgentCopy(
	commandParts: string[],
	options: MessageSubmissionOptions,
): Promise<boolean> {
	if (commandParts[0] !== 'agents' || commandParts[1] !== 'copy') {
		return false;
	}

	const {onAddToChatQueue, onCommandComplete, getNextComponentKey} = options;

	const agentName = commandParts[2];

	if (!agentName) {
		onAddToChatQueue(
			React.createElement(ErrorMessage, {
				key: `agents-copy-error-${getNextComponentKey()}`,
				message: 'Usage: /agents copy <name>\nExample: /agents copy explore',
			}),
		);
		onCommandComplete?.();
		return true;
	}

	const loader = getSubagentLoader();
	const agent = await loader.getSubagent(agentName);

	if (!agent) {
		const available = await loader.listSubagents();
		const names = available.map(a => a.name).join(', ');
		onAddToChatQueue(
			React.createElement(ErrorMessage, {
				key: `agents-copy-notfound-${getNextComponentKey()}`,
				message: `Agent '${agentName}' not found. Available agents: ${names}`,
			}),
		);
		onCommandComplete?.();
		return true;
	}

	const safeName = `${agentName}.md`;
	const targetDir = join(process.cwd(), '.nanocoder', 'agents');
	const filePath = join(targetDir, safeName);

	if (existsSync(filePath)) {
		onAddToChatQueue(
			React.createElement(ErrorMessage, {
				key: `agents-copy-exists-${getNextComponentKey()}`,
				message: `Agent file already exists: .nanocoder/agents/${safeName}\nTo modify it, edit the file directly.`,
			}),
		);
		onCommandComplete?.();
		return true;
	}

	mkdirSync(targetDir, {recursive: true});

	const content = buildAgentMarkdown(agent);
	writeFileSync(filePath, content, 'utf-8');

	onAddToChatQueue(
		React.createElement(SuccessMessage, {
			key: `agents-copied-${getNextComponentKey()}`,
			message: `Copied agent '${agentName}' to .nanocoder/agents/${safeName}\nYou can now modify this file to customize the agent.`,
			hideBox: true,
		}),
	);

	// Reload so the project-level copy takes priority
	await loader.reload();

	onCommandComplete?.();
	return true;
}

/**
 * Handles /commands create — creates the command file and prompts the AI to help write it.
 * Returns true if handled.
 */
export async function handleCommandCreate(
	commandParts: string[],
	options: MessageSubmissionOptions,
): Promise<boolean> {
	if (
		(commandParts[0] !== 'commands' && commandParts[0] !== 'custom-commands') ||
		commandParts[1] !== 'create'
	) {
		return false;
	}

	return handleFileCreate(
		commandParts[2],
		'commands',
		'commands',
		(safeName, commandBaseName) =>
			`I just created a new custom command file at .nanocoder/commands/${safeName}. Help me write the content for this command. Ask me what I want this command to do, then write the markdown prompt into the file using the write_file tool. The file should contain a clear prompt that instructs the AI what to do when this command is invoked via /${commandBaseName}. Keep the YAML frontmatter at the top.

Here is an example of the frontmatter format with all available fields:

---
description: Generate unit tests for a file
aliases: [test, unittest]
parameters: [filename]
tags: [testing, quality]
triggers: [write tests, unit test]
estimated-tokens: 2000
resources: true
category: testing
version: 1.0.0
author: user
examples:
  - /gen-tests src/utils.ts
  - /gen-tests lib/parser.ts
references: [docs/testing-guide.md]
dependencies: [lint]
---
Generate comprehensive unit tests for {{filename}}...

All fields are optional except description. Use whichever fields are appropriate for the user's needs. Parameters defined here can be used as {{param}} placeholders in the prompt body.`,
		options,
	);
}
