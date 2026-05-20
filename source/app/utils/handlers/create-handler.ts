import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import React from 'react';
import {ErrorMessage, SuccessMessage} from '@/components/message-box';
import {generateKey} from '@/session/key-generator';
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
				key: generateKey('schedule-error'),
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
	const {onAddToChatQueue, onHandleChatMessage, onCommandComplete} = options;

	if (!fileName) {
		onAddToChatQueue(
			React.createElement(ErrorMessage, {
				key: generateKey(`${entityName}-create-error`),
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
				key: generateKey(`${entityName}-create-exists`),
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
			key: generateKey(`${entityName}-created`),
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

	const {onAddToChatQueue, onHandleChatMessage, onCommandComplete} = options;

	const fileName = commandParts[2];

	if (!fileName) {
		onAddToChatQueue(
			React.createElement(ErrorMessage, {
				key: generateKey('agents-create-error'),
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
				key: generateKey('agents-create-exists'),
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
description: A brief description of when this agent should be used.
model: inherit
---

Write the system prompt that describes this agent's role, the tools it should use, and any important constraints.
`;

	writeFileSync(filePath, template, 'utf-8');

	onAddToChatQueue(
		React.createElement(SuccessMessage, {
			key: generateKey('agents-created'),
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

	const {onAddToChatQueue, onCommandComplete} = options;

	const agentName = commandParts[2];

	if (!agentName) {
		onAddToChatQueue(
			React.createElement(ErrorMessage, {
				key: generateKey('agents-copy-error'),
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
				key: generateKey('agents-copy-notfound'),
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
				key: generateKey('agents-copy-exists'),
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
			key: generateKey('agents-copied'),
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
 * Handles /tools create — creates a custom-tool definition file and prompts
 * the AI to help write it. Returns true if handled.
 */
export async function handleToolCreate(
	commandParts: string[],
	options: MessageSubmissionOptions,
): Promise<boolean> {
	if (commandParts[0] !== 'tools' || commandParts[1] !== 'create') {
		return false;
	}

	const {onAddToChatQueue, onHandleChatMessage, onCommandComplete} = options;
	const fileName = commandParts[2];

	if (!fileName) {
		onAddToChatQueue(
			React.createElement(ErrorMessage, {
				key: generateKey('tools-create-error'),
				message: 'Usage: /tools create <name>\nExample: /tools create k8s-pods',
			}),
		);
		onCommandComplete?.();
		return true;
	}

	const safeName = fileName.endsWith('.md') ? fileName : `${fileName}.md`;
	const targetDir = join(process.cwd(), '.nanocoder', 'tools');
	const filePath = join(targetDir, safeName);

	if (existsSync(filePath)) {
		onAddToChatQueue(
			React.createElement(ErrorMessage, {
				key: generateKey('tools-create-exists'),
				message: `Custom tool file already exists: .nanocoder/tools/${safeName}`,
			}),
		);
		onCommandComplete?.();
		return true;
	}

	// Tool names must match ^[a-z][a-z0-9_]*$ — convert dashes to underscores
	// so a filename like "k8s-pods.md" becomes a valid tool name "k8s_pods".
	const baseName = safeName.replace(/\.md$/, '');
	const toolName = baseName.replace(/-/g, '_').toLowerCase();

	mkdirSync(targetDir, {recursive: true});

	const template = `---
name: ${toolName}
description: A short description of what this tool does (shown to the LLM)
parameters: {}
approval: always
---

# Shell script body. Use {{ param }} to substitute parameters (shell-quoted).
# Use {{# param }}...{{/ param }} for sections that include only when the
# parameter is provided.

echo "TODO: replace this body with the command you want to run"
`;

	writeFileSync(filePath, template, 'utf-8');

	onAddToChatQueue(
		React.createElement(SuccessMessage, {
			key: generateKey('tools-created'),
			message: `Created custom tool file: .nanocoder/tools/${safeName}`,
			hideBox: true,
		}),
	);

	await onHandleChatMessage(
		`I just created a new custom tool definition file at .nanocoder/tools/${safeName}. Help me write the content for this tool. Ask me what shell command this tool should run, what parameters it needs, and whether it's read-only or mutates state. Then write the complete markdown file using the write_file tool.

Here is the full frontmatter format for custom tools:

---
name: ${toolName}                     # snake_case, must match ^[a-z][a-z0-9_]*$
description: Description shown to the LLM   # required
parameters:                           # optional, default {}
  param_name:
    type: string | number | integer | boolean | array
    description: shown to the LLM
    required: true | false            # default false
    default: any                      # used when not provided
    enum: [a, b, c]                   # restrict values
    pattern: '^regex$'                # string only
    minLength: 1                      # string only
    maxLength: 100                    # string only
    min: 0                            # number/integer only
    max: 1000                         # number/integer only
    items: {type: string}             # array only
approval: never | always | destructive   # default: always
read_only: true | false               # default: (approval == never)
timeout_ms: 30000                     # default 30000, max 300000
cwd: ./scripts                        # default: project root; supports \${VAR}
env:                                  # extra env vars; values support \${VAR}
  FOO: bar
shell: bash | sh                      # default: bash if available, else sh
---

The body is a shell script. Use {{ name }} to substitute parameters (values are shell-quoted automatically — safe against injection). Use {{# name }}...{{/ name }} for conditional sections that include only when the param is truthy.

Picking approval:
- "never" — runs without prompting (only for safe, read-only operations like \`ls\`, \`cat\`, \`git status\`)
- "always" (default) — always asks the user before running
- "destructive" — prompts in normal mode, auto-approves in auto-accept/yolo (matches built-in file mutation tools)

Once you know what the user wants, replace the placeholder body with the real shell command and update the frontmatter accordingly.`,
	);

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
