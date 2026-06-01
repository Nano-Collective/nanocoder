import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {getSubagentLoader} from '@/subagents/subagent-loader';
import type {SubagentConfigWithSource} from '@/subagents/types';
import type {MessageSubmissionOptions} from '@/types/index';
import {errorMsg, successMsg} from '@/utils/message-factory';

/**
 * Per-entity differences for the single-file `/<kind> create <name>` flows.
 * Everything else (arg validation, existence check, mkdir, write, success
 * message, chained AI prompt) is shared by `handleFileCreate`.
 */
interface FileCreateSpec {
	/** Subdirectory under `.nanocoder/` and `generateKey`/usage prefix (e.g. 'agents'). */
	entityName: string;
	/** Example shown in the usage hint (e.g. 'code-reviewer'). */
	usageExample: string;
	/** Capitalised noun for the "already exists" message (e.g. 'Agent file'). */
	existsNoun: string;
	/** Noun for the "Created … " success message (e.g. 'agent file'). */
	createdNoun: string;
	/** Derive the in-file name from the base filename. Defaults to identity. */
	deriveName?: (baseName: string) => string;
	/** Build the file's initial contents from the safe filename + derived name. */
	template: (safeName: string, derivedName: string) => string;
	/** The chained prompt asking the AI to fill the scaffold in. */
	aiPrompt: (safeName: string, derivedName: string) => string;
}

/**
 * Creates a markdown file with a frontmatter template and asks the AI to help
 * write it. Shared logic for the /<command|tool|agent> create flows.
 */
async function handleFileCreate(
	fileName: string | undefined,
	spec: FileCreateSpec,
	options: MessageSubmissionOptions,
): Promise<boolean> {
	const {onAddToChatQueue, onHandleChatMessage, onCommandComplete} = options;
	const {entityName} = spec;

	if (!fileName) {
		onAddToChatQueue(
			errorMsg(
				`Usage: /${entityName} create <name>\nExample: /${entityName} create ${spec.usageExample}`,
				`${entityName}-create-error`,
			),
		);
		onCommandComplete?.();
		return true;
	}

	const safeName = fileName.endsWith('.md') ? fileName : `${fileName}.md`;
	const targetDir = join(process.cwd(), '.nanocoder', entityName);
	const filePath = join(targetDir, safeName);

	if (existsSync(filePath)) {
		onAddToChatQueue(
			errorMsg(
				`${spec.existsNoun} already exists: .nanocoder/${entityName}/${safeName}`,
				`${entityName}-create-exists`,
			),
		);
		onCommandComplete?.();
		return true;
	}

	mkdirSync(targetDir, {recursive: true});

	const baseName = safeName.replace(/\.md$/, '');
	const derivedName = spec.deriveName ? spec.deriveName(baseName) : baseName;

	writeFileSync(filePath, spec.template(safeName, derivedName), 'utf-8');

	onAddToChatQueue(
		successMsg(
			`Created ${spec.createdNoun}: .nanocoder/${entityName}/${safeName}`,
			`${entityName}-created`,
		),
	);

	await onHandleChatMessage(spec.aiPrompt(safeName, derivedName));

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

	return handleFileCreate(
		commandParts[2],
		{
			entityName: 'agents',
			usageExample: 'code-reviewer',
			existsNoun: 'Agent file',
			createdNoun: 'agent file',
			template: (_safeName, agentName) => `---
name: ${agentName}
description: A brief description of when this agent should be used.
model: inherit
---

Write the system prompt that describes this agent's role, the tools it should use, and any important constraints.
`,
			aiPrompt: buildAgentDesignPrompt,
		},
		options,
	);
}

/**
 * The chained prompt that runs after `/agents create <name>` scaffolds an
 * empty agent file. Same shape as `buildSkillBundleDesignPrompt`: a
 * conversational opener, a complete frontmatter schema, anti-gotcha rules,
 * and an explicit "ask me first, then write_file" kickoff.
 */
function buildAgentDesignPrompt(safeName: string, agentName: string): string {
	return `I just created a new subagent definition at .nanocoder/agents/${safeName}. Ask me what I want this agent to specialize in (purpose, when the main agent should delegate to it, what tools it needs), then write the complete file with \`write_file\`. After writing, summarize what you wrote so I can verify.

# \`agents/${safeName}\` schema (required fields marked *)

\`\`\`markdown
---
name: ${agentName}                    # * snake_case or kebab-case; MUST match the filename
description: One-line summary.        # * shown to the main agent so it knows when to delegate
provider:                             # optional; provider name from agents.config.json (inherits parent's if omitted)
model: inherit                        # optional; 'inherit' or a model ID available on the provider
tools:                                # optional; if set, ONLY these tool names are visible to the agent
  - read_file
  - search_file_contents
  - find_files
disallowedTools:                      # optional; block specific tools (applied after \`tools:\`)
  - write_file
  - string_replace
contextWindow: 200000                 # optional; override the model's default context window
---
You are a specialized agent. Describe your role, the tools you should use, and any constraints.
The body is the system prompt the subagent sees on every invocation.
\`\`\`

# Rules that catch out AI-generated agents

1. **\`name:\` matches the filename.** \`docs-agent.md\` → \`name: docs-agent\`. The parser cross-checks.
2. **\`description:\` is for the main agent, not the user.** It's how the main agent decides when to delegate. Write it as instructions, not marketing.
3. **\`tools:\` is a whitelist.** If you list any, ONLY those are visible - including read-only essentials. Easier to use \`disallowedTools:\` for blocking specific dangerous tools while keeping the rest.
4. **No \`subscribe:\` on a single-file agent unless you want it triggered.** If you do add one, omit \`target:\` - the implicit target is the agent itself.
5. **Use \`write_file\`** to author the file. Do not inline the markdown in chat.

Now: ask me what this agent should specialize in, then design it.`;
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
			errorMsg(
				'Usage: /agents copy <name>\nExample: /agents copy explore',
				'agents-copy-error',
			),
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
			errorMsg(
				`Agent '${agentName}' not found. Available agents: ${names}`,
				'agents-copy-notfound',
			),
		);
		onCommandComplete?.();
		return true;
	}

	const safeName = `${agentName}.md`;
	const targetDir = join(process.cwd(), '.nanocoder', 'agents');
	const filePath = join(targetDir, safeName);

	if (existsSync(filePath)) {
		onAddToChatQueue(
			errorMsg(
				`Agent file already exists: .nanocoder/agents/${safeName}\nTo modify it, edit the file directly.`,
				'agents-copy-exists',
			),
		);
		onCommandComplete?.();
		return true;
	}

	mkdirSync(targetDir, {recursive: true});

	const content = buildAgentMarkdown(agent);
	writeFileSync(filePath, content, 'utf-8');

	onAddToChatQueue(
		successMsg(
			`Copied agent '${agentName}' to .nanocoder/agents/${safeName}\nYou can now modify this file to customize the agent.`,
			'agents-copied',
		),
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

	return handleFileCreate(
		commandParts[2],
		{
			entityName: 'tools',
			usageExample: 'k8s-pods',
			existsNoun: 'Custom tool file',
			createdNoun: 'custom tool file',
			// Tool names must match ^[a-z][a-z0-9_]*$ — convert dashes to
			// underscores so a filename like "k8s-pods.md" becomes a valid
			// tool name "k8s_pods".
			deriveName: baseName => baseName.replace(/-/g, '_').toLowerCase(),
			template: (_safeName, toolName) => `---
name: ${toolName}
description: A short description of what this tool does (shown to the LLM)
parameters: {}
approval: always
---

# Shell script body. Use {{ param }} to substitute parameters (shell-quoted).
# Use {{# param }}...{{/ param }} for sections that include only when the
# parameter is provided.

echo "TODO: replace this body with the command you want to run"
`,
			aiPrompt: buildToolDesignPrompt,
		},
		options,
	);
}

/**
 * The chained prompt that runs after `/tools create <name>` scaffolds an
 * empty tool file. Same shape as the agent / skill design prompts:
 * conversational opener, complete schema, anti-gotcha rules, and a
 * "Now: ask me…" kickoff.
 */
function buildToolDesignPrompt(safeName: string, toolName: string): string {
	return `I just created a new custom tool definition at .nanocoder/tools/${safeName}. Ask me what shell command this tool should run, what parameters it needs, and whether it's read-only or mutates state. Then write the complete file with \`write_file\`. After writing, summarize what you wrote so I can verify.

# \`tools/${safeName}\` schema (required fields marked *)

\`\`\`markdown
---
name: ${toolName}                       # * MUST match ^[a-z][a-z0-9_]*$
                                       #   - snake_case ONLY, no hyphens, no camelCase
                                       #   - the name is interpolated into shell; the regex
                                       #     is part of the injection-safety surface
description: One-line summary.         # * shown to the LLM
approval: never | always | destructive # * required choice (see picking guide below)
read_only: true | false                # default: (approval == 'never'); set false for writes
timeout_ms: 30000                      # default 30000, max 300000
shell: bash | sh                       # default: bash if available, else sh
cwd: ./scripts                         # optional; default project root; supports \${VAR}
env:                                   # optional; values support \${VAR}
  FOO: bar

# Parameters MUST be a MAPPING (paramName: {definition}).
# Do NOT use a list-of-objects ([{name, type, ...}]) - that's the OpenAPI shape.
parameters:
  namespace:
    type: string                       # 'string' | 'number' | 'integer' | 'boolean' | 'array'
    description: Kubernetes namespace.
    required: false                    # default false
    default: default                   # optional
    enum: [default, kube-system]       # optional; restrict to listed values
    pattern: '^[a-z0-9-]+$'            # string only
    minLength: 1                       # string only
    maxLength: 63                      # string only
    min: 0                             # number/integer only
    max: 1000                          # number/integer only
  items:
    type: array
    items: {type: string}              # required when type is 'array'
---

# The body is a shell script.
# Use {{ name }} to substitute a parameter (values are shell-quoted - safe against injection).
# Use {{# name }}...{{/ name }} for conditional sections (include only when the param is truthy).

kubectl get pods -n {{ namespace }} -o wide
{{# label }}kubectl get pods -l {{ label }}{{/ label }}
\`\`\`

# Picking \`approval\`

- **\`never\`** — runs without prompting. Use for read-only operations: \`ls\`, \`cat\`, \`git status\`, \`kubectl get\`, \`gh pr list\`, etc.
- **\`always\`** — prompts the user every time. Use when the tool mutates state and you want a confirmation per invocation.
- **\`destructive\`** — prompts in normal mode, auto-approves in auto-accept/yolo. Use for file-mutation-style tools that should match the built-in \`write_file\` posture.

# Rules that catch out AI-generated tools

1. **\`name:\` is snake_case.** Hyphens fail validation. \`k8s_list_pods\` ✓, \`k8s-list-pods\` ✗.
2. **\`parameters:\` is a mapping**, not a list. Don't write \`- name: namespace\\n  type: ...\` (OpenAPI shape, wrong here).
3. **\`approval: never\`** for read-only ops only. If the tool can write, delete, or call a remote API that changes state, use \`destructive\` (or \`always\` if you want a prompt every time).
4. **Shell-quoted substitution is safe by default.** \`echo "{{ name }}"\` is fine even if \`name\` contains spaces or shell metacharacters - don't add your own escaping.
5. **Use \`write_file\`** to author the file. Do not inline the markdown in chat.

Now: ask me what this tool should do, then design it.`;
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
			errorMsg(
				'Usage: /skills create <name>\nExample: /skills create pr-reviewer\n\nFor single-piece skills, use /commands create, /agents create, or /tools create instead.',
				'skills-create-error',
			),
		);
		onCommandComplete?.();
		return true;
	}

	if (!BUNDLE_NAME_REGEX.test(name)) {
		onAddToChatQueue(
			errorMsg(
				`Skill names must match ${BUNDLE_NAME_REGEX} (kebab-case starting with a letter).`,
				'skills-create-invalid-name',
			),
		);
		onCommandComplete?.();
		return true;
	}

	const bundleRoot = join(process.cwd(), '.nanocoder', 'skills', name);
	if (existsSync(bundleRoot)) {
		onAddToChatQueue(
			errorMsg(
				`Skill bundle already exists: .nanocoder/skills/${name}/`,
				'skills-create-exists',
			),
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
		successMsg(
			`Created skill bundle: .nanocoder/skills/${name}/`,
			'skills-created',
		),
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
		{
			entityName: 'commands',
			usageExample: 'review-code',
			existsNoun: 'Command file',
			createdNoun: 'commands file',
			template: (safeName, _commandBaseName) => `---
description: ${safeName.replace(/\.md$/, '')} custom command
---

`,
			aiPrompt: buildCommandDesignPrompt,
		},
		options,
	);
}

/**
 * The chained prompt that runs after `/commands create <name>` scaffolds
 * an empty command file. Same shape as the agent / tool / skill design
 * prompts: conversational opener, complete schema, anti-gotcha rules,
 * "Now: ask me…" kickoff.
 */
function buildCommandDesignPrompt(
	safeName: string,
	commandBaseName: string,
): string {
	return `I just created a new custom command at .nanocoder/commands/${safeName}. Ask me what \`/${commandBaseName}\` should do, what parameters it takes (if any), and whether it should auto-inject on certain keywords. Then write the complete file with \`write_file\`. After writing, summarize what you wrote so I can verify.

# \`commands/${safeName}\` schema (required fields marked *)

\`\`\`markdown
---
description: One-line summary.        # * shown in /commands and to the user
aliases: [short, c]                   # optional; alternate slash names
parameters: [filename]                # optional; positional args become {{filename}} placeholders
tags: [testing, quality]              # optional; categorize for /commands grouping
triggers: [write tests, unit test]    # optional; auto-inject when the user mentions these phrases
estimated-tokens: 2000                # optional; rough token cost shown in the auto-injectable list
resources: true                       # optional; expose sibling files in .nanocoder/commands/<name>/resources/
category: testing                     # optional; free-form group label
version: 1.0.0                        # optional
author: you                           # optional
examples:                             # optional; rendered in /commands show
  - /${commandBaseName} src/utils.ts
  - /${commandBaseName} lib/parser.ts
references: [docs/testing-guide.md]   # optional; pointers shown in /commands show
---
The body is the prompt the LLM receives when the user runs /${commandBaseName}.
Use {{paramName}} placeholders to interpolate positional arguments.
\`\`\`

# Rules that catch out AI-generated commands

1. **\`description:\` is required.** Everything else is optional.
2. **Parameters are positional**, not named. \`parameters: [filename, mode]\` means \`/${commandBaseName} foo.ts review\` → \`{{filename}} = foo.ts\`, \`{{mode}} = review\`.
3. **Don't \`subscribe:\` from a one-off command** unless you want the daemon to fire it on a schedule. If you do, omit \`target:\` - the implicit target is the command itself.
4. **Body is the prompt**, not surrounding chatter. The model sees the body verbatim with placeholders substituted.
5. **Use \`write_file\`** to author the file. Do not inline the markdown in chat.

Now: ask me what this command should do, then design it.`;
}
