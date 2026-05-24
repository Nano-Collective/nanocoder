import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import React from 'react';
import {ErrorMessage, SuccessMessage} from '@/components/message-box';
import {generateKey} from '@/session/key-generator';
import {getSubagentLoader} from '@/subagents/subagent-loader';
import type {SubagentConfigWithSource} from '@/subagents/types';
import type {MessageSubmissionOptions} from '@/types/index';

/**
 * Creates a markdown file with frontmatter template and asks the AI to help
 * write it. Shared logic for the /<command|tool|agent> create flows.
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
				message: `Usage: /${entityName} create <name>\nExample: /${entityName} create review-code`,
				hideBox: true,
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
				message: `Command file already exists: .nanocoder/${dirName}/${safeName}`,
				hideBox: true,
			}),
		);
		onCommandComplete?.();
		return true;
	}

	mkdirSync(targetDir, {recursive: true});

	const template = `---
description: ${safeName.replace(/\.md$/, '')} custom command
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
				hideBox: true,
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
				hideBox: true,
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
				hideBox: true,
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
				hideBox: true,
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
				hideBox: true,
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
				hideBox: true,
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
				hideBox: true,
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
/**
 * Handles `/skills create <name>` — scaffolds a new bundle directory
 * under `.nanocoder/skills/<name>/`. Single-file skills (one command,
 * one agent, one tool) continue to use `/agents create`, `/tools create`,
 * and `/commands create`. The bundle form is for multi-piece features
 * (subagent + tools + command that ship together).
 */
const BUNDLE_NAME_REGEX = /^[a-z][a-z0-9-]*$/;

export async function handleSkillsCreate(
	commandParts: string[],
	options: MessageSubmissionOptions,
): Promise<boolean> {
	if (commandParts[0] !== 'skills' || commandParts[1] !== 'create') {
		return false;
	}

	const {onAddToChatQueue, onHandleChatMessage, onCommandComplete} = options;
	const name = commandParts[2];

	if (!name) {
		onAddToChatQueue(
			React.createElement(ErrorMessage, {
				key: generateKey('skills-create-error'),
				message:
					'Usage: /skills create <name>\nExample: /skills create pr-reviewer\n\nFor single-piece skills, use /commands create, /agents create, or /tools create instead.',
				hideBox: true,
			}),
		);
		onCommandComplete?.();
		return true;
	}

	if (!BUNDLE_NAME_REGEX.test(name)) {
		onAddToChatQueue(
			React.createElement(ErrorMessage, {
				key: generateKey('skills-create-invalid-name'),
				message: `Skill names must match ${BUNDLE_NAME_REGEX} (kebab-case starting with a letter).`,
				hideBox: true,
			}),
		);
		onCommandComplete?.();
		return true;
	}

	const bundleRoot = join(process.cwd(), '.nanocoder', 'skills', name);
	if (existsSync(bundleRoot)) {
		onAddToChatQueue(
			React.createElement(ErrorMessage, {
				key: generateKey('skills-create-exists'),
				message: `Skill bundle already exists: .nanocoder/skills/${name}/`,
				hideBox: true,
			}),
		);
		onCommandComplete?.();
		return true;
	}

	mkdirSync(join(bundleRoot, 'commands'), {recursive: true});
	mkdirSync(join(bundleRoot, 'agents'), {recursive: true});
	mkdirSync(join(bundleRoot, 'tools'), {recursive: true});
	writeFileSync(
		join(bundleRoot, 'skill.yaml'),
		`name: ${name}\ndescription: A brief description of what this skill does.\n`,
		'utf-8',
	);
	writeFileSync(
		join(bundleRoot, 'README.md'),
		`# ${name}\n\nA new nanocoder skill bundle. Drop \`.md\` files into \`commands/\`, \`agents/\`, or \`tools/\` and run \`/skills show ${name}\` to inspect what loaded.\n`,
		'utf-8',
	);

	onAddToChatQueue(
		React.createElement(SuccessMessage, {
			key: generateKey('skills-created'),
			message: `Created skill bundle: .nanocoder/skills/${name}/`,
			hideBox: true,
		}),
	);

	await onHandleChatMessage(buildSkillBundleDesignPrompt(name));

	return true;
}

/**
 * The chained prompt that runs after `/skills create <name>` scaffolds an
 * empty bundle. Embeds the full schema for each member kind so the model
 * generates files that actually parse the first time, instead of producing
 * OpenAPI-style or kebab-case shapes the parsers reject.
 */
function buildSkillBundleDesignPrompt(name: string): string {
	return `I just created a new skill bundle at .nanocoder/skills/${name}/. Ask me what this skill should do, then write the members using \`write_file\`. After writing, summarize the resulting tree so I can verify.

# Bundle layout

A bundle is a directory under \`.nanocoder/skills/<name>/\` with:

- \`skill.yaml\` — the manifest (required).
- \`commands/\`  — **any number** of \`.md\` files become slash commands.
  Each is auto-namespaced under the bundle name (e.g. \`commands/status.md\`
  in bundle \`k8s\` invokes as \`/k8s:status\`). Exception: \`commands/<bundleName>.md\`
  (e.g. \`commands/k8s.md\` in bundle \`k8s\`) keeps the bare name (\`/k8s\`).
- \`agents/\`    — **at most one** \`.md\` becomes the subagent. The agent IS the bundle's brain;
  if you want multiple agents, split into multiple skills.
- \`tools/\`     — **any number** of \`.md\` files become shell-script tools.

The bundle's name comes from the directory name. The skill is loaded as a single unit.

# \`skill.yaml\` schema (required fields marked *)

\`\`\`yaml
name: ${name}                                 # * kebab-case, matches ^[a-z][a-z0-9-]*$
description: One-line summary.               # * shown in /skills
version: 0.1.0                               # optional, free string
author: you@example.com                      # optional
tags: [git, ci, review]                      # optional

# Tool visibility. Shorthand 'scoped' / 'global' OR the mapping form.
# Default: scoped (tools are visible only to this bundle's own subagent).
tools_visibility: scoped                     # optional; or { default: scoped }

# Event subscriptions (optional). Members of THIS bundle only.
# Use \`target:\` HERE (manifest), NEVER in a member's frontmatter.
subscribe:
  - kind: file.changed
    target: agent:${name}-agent             # MUST be 'command:<name>' | 'agent:<name>' | 'tool:<name>'
    paths: ["src/**/*.ts"]                   # relative globs only, no leading '/' or '..'
    eventKinds: [add, change]                # optional whitelist; default fires on all
    confirm: true                            # optional; runs target in plan mode
  - kind: schedule.cron
    target: command:weekly-report
    cron: "0 9 * * MON"
\`\`\`

# \`commands/<name>.md\` schema

\`\`\`markdown
---
description: One-line summary.               # required
aliases: [short, c]                          # optional
# subscribe: omit target here (implicit self).
---
The prompt body the LLM receives when the user runs /<command>.
\`\`\`

# \`agents/<name>.md\` schema

\`\`\`markdown
---
name: ${name}-agent                          # required, must match this file
description: When to delegate to this agent. # required
model: inherit                               # optional; usually 'inherit'
tools:                                       # optional; if set, ONLY these names are visible
  - tool_one
  - tool_two
disallowedTools: []                          # optional
---
You are a specialized agent. Describe the role, the tools you should use,
and any constraints. The body is the system prompt the subagent sees.
\`\`\`

If \`tools:\` is omitted, the agent automatically gets the bundle's sibling
tools. Bundle-scoped tools are ALWAYS visible to this subagent (the
\`tools_visibility: scoped\` setting hides them from \`/tools\` and from the
main agent, but not from this skill's own subagent).

# \`tools/<name>.md\` schema  (read very carefully)

\`\`\`markdown
---
name: my_tool                                # * MUST match ^[a-z][a-z0-9_]*$
                                             #   - snake_case ONLY, no hyphens, no camelCase
                                             #   - this name is interpolated into shell; the regex
                                             #     is part of the injection-safety surface
description: One-line summary.               # *
approval: never                              # * 'never' | 'always' | 'destructive'
                                             #   - never: read-only ops (ls, cat, git status, kubectl get)
                                             #   - always: prompts the user every time
                                             #   - destructive: prompts in normal mode, auto in auto-accept/yolo
read_only: true                              # default: (approval == 'never'); set false for writes
timeout_ms: 30000                            # default 30000, max 300000
shell: bash                                  # 'bash' | 'sh'; default bash if available else sh
cwd: ./scripts                               # optional; default project root; supports \${VAR}
env:                                         # optional; values support \${VAR}
  FOO: bar

# Parameters: MUST be a MAPPING (paramName: {definition}).
# Do NOT use a list-of-objects ([{name, type, ...}]) - that's the OpenAPI
# shape and is wrong here. The parser will tolerate it but the canonical
# shape is the mapping below.
parameters:
  namespace:
    type: string                             # 'string' | 'number' | 'integer' | 'boolean' | 'array'
    description: Kubernetes namespace.
    required: false                          # default false
    default: default                         # optional
    enum: [default, kube-system]             # optional; restrict to listed values
    pattern: '^[a-z0-9-]+$'                  # string only
    minLength: 1                             # string only
    maxLength: 63                            # string only
    min: 0                                   # number/integer only
    max: 1000                                # number/integer only
  items:
    type: array
    items: {type: string}                    # required when type is 'array'
---

# The body is a shell script.
# Use {{ name }} to substitute a parameter (values are shell-quoted -
# safe against injection). Use {{# name }}...{{/ name }} for conditional
# sections that include only when the param is truthy.

kubectl get pods -n {{ namespace }} -o wide
{{# label }}kubectl get pods -l {{ label }}{{/ label }}
\`\`\`

# Rules that catch out AI-generated bundles

1. **Tool \`name:\` is snake_case.** Hyphens fail validation. \`k8s_list_pods\` ✓, \`k8s-list-pods\` ✗.
2. **\`parameters\` is a mapping**, not a list. Don't write \`- name: namespace\\n  type: ...\`.
3. **No \`target:\` on member frontmatter** in a bundle. Targets live in \`skill.yaml\`.
4. **Many commands, one agent, many tools.** Multiple \`.md\` files in \`commands/\` are auto-namespaced (\`/bundle:verb\`). Two \`.md\` files in \`agents/\` is an error.
5. **\`approval: never\`** for read-only operations (\`ls\`, \`cat\`, \`git status\`, \`kubectl get\`, \`gh ...\` queries). Use \`always\` only if the tool mutates state and you want a prompt every run. Use \`destructive\` only for file-mutation-style tools.
6. **Paths in subscriptions are relative globs.** \`docs/**\`, \`src/**/*.ts\` ✓. \`/etc/...\` ✗, \`../...\` ✗.
7. **Use \`write_file\` to author each file**, including \`skill.yaml\`. Do not concatenate content into a single file.

Now: ask me what the skill should do, then design it.`;
}

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
