/**
 * Language Server Auto-Discovery
 * Detects installed language servers on the system
 */

import {execFileSync, spawn} from 'child_process';
import {existsSync} from 'fs';
import {join} from 'path';
import {
	TIMEOUT_LSP_SPAWN_VERIFICATION_MS,
	TIMEOUT_LSP_VERIFICATION_MS,
} from '@/constants';
import {createChildLogger} from '@/utils/logging';
import type {LSPServerConfig} from './lsp-client';

const logger = createChildLogger({module: 'lsp-discovery'});

/**
 * Deno project configuration file names
 */
const DENO_CONFIG_FILES = ['deno.json', 'deno.jsonc'] as const;

interface LanguageServerDefinition {
	name: string;
	command: string;
	args: string[];
	languages: string[];
	checkCommand?: string; // Command to verify installation
	verificationMethod?: 'version' | 'lsp' | 'none'; // New verification method
	installHint?: string;
}

/**
 * Known language servers and their configurations
 */
const KNOWN_SERVERS: LanguageServerDefinition[] = [
	// TypeScript/JavaScript
	{
		name: 'typescript-language-server',
		command: 'typescript-language-server',
		args: ['--stdio'],
		languages: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'],
		checkCommand: 'typescript-language-server --version',
		verificationMethod: 'version',
		installHint: 'npm install -g typescript-language-server typescript',
	},
	// Deno
	{
		name: 'deno',
		command: 'deno',
		args: ['lsp'],
		languages: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'],
		checkCommand: 'deno --version',
		verificationMethod: 'version',
		installHint: 'Install Deno from https://deno.com/',
	},
	// Python - Pyright (preferred)
	{
		name: 'pyright',
		command: 'pyright-langserver',
		args: ['--stdio'],
		languages: ['py', 'pyi'],
		checkCommand: 'pyright-langserver --version',
		verificationMethod: 'lsp',
		installHint: 'npm install -g pyright',
	},
	// Python - pylsp (alternative)
	{
		name: 'pylsp',
		command: 'pylsp',
		args: [],
		languages: ['py', 'pyi'],
		checkCommand: 'pylsp --version',
		verificationMethod: 'version',
		installHint: 'pip install python-lsp-server',
	},
	// Rust
	{
		name: 'rust-analyzer',
		command: 'rust-analyzer',
		args: [],
		languages: ['rs'],
		checkCommand: 'rust-analyzer --version',
		verificationMethod: 'version',
		installHint: 'rustup component add rust-analyzer',
	},
	// Go
	{
		name: 'gopls',
		command: 'gopls',
		args: ['serve'],
		languages: ['go'],
		checkCommand: 'gopls version',
		verificationMethod: 'version',
		installHint: 'go install golang.org/x/tools/gopls@latest',
	},
	// C/C++
	{
		name: 'clangd',
		command: 'clangd',
		args: ['--background-index'],
		languages: ['c', 'cpp', 'cc', 'cxx', 'h', 'hpp', 'hxx'],
		checkCommand: 'clangd --version',
		verificationMethod: 'version',
		installHint: 'Install via system package manager (apt, brew, etc.)',
	},
	// JSON
	{
		name: 'vscode-json-languageserver',
		command: 'vscode-json-language-server',
		args: ['--stdio'],
		languages: ['json', 'jsonc'],
		checkCommand: 'vscode-json-language-server --version',
		verificationMethod: 'lsp',
		installHint: 'npm install -g vscode-langservers-extracted',
	},
	// HTML
	{
		name: 'vscode-html-languageserver',
		command: 'vscode-html-language-server',
		args: ['--stdio'],
		languages: ['html', 'htm'],
		checkCommand: 'vscode-html-language-server --version',
		verificationMethod: 'lsp',
		installHint: 'npm install -g vscode-langservers-extracted',
	},
	// CSS
	{
		name: 'vscode-css-languageserver',
		command: 'vscode-css-language-server',
		args: ['--stdio'],
		languages: ['css', 'scss', 'less'],
		checkCommand: 'vscode-css-language-server --version',
		verificationMethod: 'lsp',
		installHint: 'npm install -g vscode-langservers-extracted',
	},
	// YAML
	{
		name: 'yaml-language-server',
		command: 'yaml-language-server',
		args: ['--stdio'],
		languages: ['yaml', 'yml'],
		checkCommand: 'yaml-language-server --version',
		verificationMethod: 'lsp',
		installHint: 'npm install -g yaml-language-server',
	},
	// Bash/Shell
	{
		name: 'bash-language-server',
		command: 'bash-language-server',
		args: ['start'],
		languages: ['sh', 'bash', 'zsh'],
		checkCommand: 'bash-language-server --version',
		verificationMethod: 'version',
		installHint: 'npm install -g bash-language-server',
	},
	// Lua
	{
		name: 'lua-language-server',
		command: 'lua-language-server',
		args: [],
		languages: ['lua'],
		checkCommand: 'lua-language-server --version',
		verificationMethod: 'version',
		installHint: 'Install from https://github.com/LuaLS/lua-language-server',
	},

	//markdown
	{
		name: 'vscode-markdown-language-server',
		command: 'vscode-mdx-language-server',
		args: ['--stdio'],
		languages: ['md', 'markdown', 'mdx'],
		checkCommand: 'vscode-mdx-language-server --version',
		verificationMethod: 'lsp',
		installHint:
			'npm install -g @microsoft/vscode-mdx-language-server or vscode-langservers-extracted',
	},
	{
		name: 'marksman',
		command: 'marksman',
		args: ['server'],
		languages: ['md', 'markdown'],
		checkCommand: 'marksman --version',
		verificationMethod: 'version',
		installHint:
			'npm install -g marksman or download from https://github.com/artempyanykh/marksman/releases',
	},

	//graphql
	{
		name: 'graphql-lsp-server',
		command: 'graphql-lsp',
		args: ['server -s'],
		languages: ['graphql', 'gql'],
		checkCommand: 'graphql-lsp --version',
		verificationMethod: 'version',
		installHint: 'npm install -g @graphql-tools/lsp-server',
	},
	{
		name: 'graphql-language-server-cli',
		command: 'graphql-lsp',
		args: ['server', '--stdio'],
		languages: ['graphql', 'gql'],
		checkCommand: 'graphql-lsp --version',
		verificationMethod: 'version',
		installHint: 'npm install -g graphql-language-service-cli',
	},
	{
		name: 'docker-language',
		command: 'docker-langserver',
		args: ['--stdio'],
		languages: ['dockerfile'],
		checkCommand: 'docker-langserver --version',
		verificationMethod: 'version',
		installHint:
			'npm install -g docker-langserver or https://github.com/rcjsuen/dockerfile-language-server-nodejs',
	},
	{
		name: 'docker-compose-language',
		command: 'yaml-language-server',
		args: ['--stdio'],
		languages: ['yaml', 'yml', 'docker-compose'],
		checkCommand: 'yaml-language-server --version',
		verificationMethod: 'version',
		installHint: 'npm install -g yaml-language-server',
	},
];

/**
 * Check if a directory is a Deno project by looking for deno.json or deno.jsonc
 * @param projectRoot The directory to check (defaults to process.cwd())
 * @returns true if a Deno configuration file is found, false otherwise
 */
export function isDenoProject(projectRoot: string = process.cwd()): boolean {
	for (const configFile of DENO_CONFIG_FILES) {
		const configPath = join(projectRoot, configFile); // nosemgrep
		if (existsSync(configPath)) {
			return true;
		}
	}
	return false;
}

/**
 * Check if a command is available in PATH or locally in node_modules
 * Returns the path to use, or null if not found
 */
function findCommand(command: string): string | null {
	// First check PATH
	try {
		const checkCmd = process.platform === 'win32' ? 'where' : 'which';
		execFileSync(checkCmd, [command], {stdio: 'ignore'});
		return command;
	} catch (error) {
		// Not in PATH - expected for many servers
		logger.debug({command, err: error}, 'Command not in PATH');
	}

	// Check local node_modules/.bin
	// nosemgrep
	const localBinPath = join(process.cwd(), 'node_modules', '.bin', command); // nosemgrep
	if (existsSync(localBinPath)) {
		return localBinPath;
	}

	return null;
}

/**
 * Check if a command works by running a check command
 */
function verifyServer(checkCommand: string): boolean {
	try {
		// Parse command and arguments from the check command string
		const parts = checkCommand.split(/\s+/);
		const command = parts[0];
		const args = parts.slice(1);

		execFileSync(command, args, {
			stdio: 'ignore',
			timeout: TIMEOUT_LSP_VERIFICATION_MS,
		});
		return true;
	} catch (error) {
		logger.debug({checkCommand, err: error}, 'Server verification failed');
		return false;
	}
}

/**
 * Verify an LSP server by attempting to start it with its required LSP arguments
 * and confirming that the process spawns successfully without immediate errors.
 */
function verifyLSPServerWithCommunication(
	command: string,
	args: string[],
): Promise<boolean> {
	return new Promise(resolve => {
		// nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
		// command and args come from KNOWN_SERVERS configuration, not user input
		const child = spawn(command, args, {stdio: ['pipe', 'pipe', 'pipe']}); // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process

		// Set a timeout to prevent the process from hanging indefinitely
		const timeout = setTimeout(() => {
			child.kill();
			resolve(false);
		}, TIMEOUT_LSP_SPAWN_VERIFICATION_MS);

		// Listen for errors during startup (e.g., command not found)
		child.on('error', () => {
			clearTimeout(timeout);
			child.kill();
			resolve(false);
		});

		// If the process spawns successfully, we consider it valid.
		// We can then kill it immediately.
		child.on('spawn', () => {
			clearTimeout(timeout);
			child.kill(); // Clean up the successfully spawned process
			resolve(true);
		});

		// Handle cases where the process exits very quickly (either success or failure)
		child.on('exit', _code => {
			clearTimeout(timeout);
			// A clean exit can also indicate success for some servers
			// However, for LSP servers waiting for input, an immediate exit is often a failure
			// The 'spawn' event is a more reliable indicator for our purpose
		});
	});
}

/**
 * Get servers ordered by project context
 * Prioritizes Deno over TypeScript LSP when in a Deno project
 * @param projectRoot The project root to check for Deno config (defaults to process.cwd())
 * @returns Ordered array of server definitions with Deno first if in a Deno project
 */
export function getOrderedServers(
	projectRoot?: string,
): LanguageServerDefinition[] {
	const root = projectRoot ?? process.cwd();
	const servers = [...KNOWN_SERVERS];

	if (isDenoProject(root)) {
		// Move Deno server to the front for Deno projects
		// Skip if Deno is already first (index 0) or not found (index -1)
		const denoIndex = servers.findIndex(s => s.name === 'deno');
		if (denoIndex > 0) {
			const [denoServer] = servers.splice(denoIndex, 1);
			servers.unshift(denoServer);
		}
	}

	return servers;
}

/**
 * Discover all installed language servers
 * @param projectRoot Optional project root for context-aware server selection
 */
export async function discoverLanguageServers(
	projectRoot?: string,
): Promise<LSPServerConfig[]> {
	const discovered: LSPServerConfig[] = [];
	const coveredLanguages = new Set<string>();
	const orderedServers = getOrderedServers(projectRoot);

	for (const server of orderedServers) {
		// Skip if we already have a server for all of this server's languages
		const hasNewLanguages = server.languages.some(
			lang => !coveredLanguages.has(lang),
		);
		if (!hasNewLanguages) continue;

		// Check if command exists (in PATH or local node_modules)
		const commandPath = findCommand(server.command);
		if (!commandPath) continue;

		// Verify server works based on verification method
		// Use the resolved command path for verification
		const verificationMethod = server.verificationMethod || 'version';

		let verified = true;
		switch (verificationMethod) {
			case 'version':
				// Use the existing check command approach
				if (server.checkCommand) {
					const checkCmd = server.checkCommand.replace(
						server.command,
						commandPath,
					);
					verified = verifyServer(checkCmd);
				}
				break;

			case 'lsp':
				// Use the new LSP verification approach
				verified = await verifyLSPServerWithCommunication(
					commandPath,
					server.args,
				);
				break;

			case 'none':
				// Skip verification, only check if command exists
				break;
		}

		if (!verified) continue;

		// Add to discovered servers with resolved command path
		discovered.push({
			name: server.name,
			command: commandPath,
			args: server.args,
			languages: server.languages,
		});

		// Mark languages as covered
		for (const lang of server.languages) {
			coveredLanguages.add(lang);
		}
	}

	return discovered;
}

/**
 * Get language server config for a specific file extension
 */
export function getServerForLanguage(
	servers: LSPServerConfig[],
	extension: string,
): LSPServerConfig | undefined {
	const ext = extension.startsWith('.') ? extension.slice(1) : extension;
	return servers.find(server => server.languages.includes(ext));
}

/**
 * Get the file extension to LSP language ID mapping
 */
export function getLanguageId(extension: string): string {
	const ext = extension.startsWith('.') ? extension.slice(1) : extension;

	// Handle Docker Compose filename patterns
	if (
		ext === 'docker-compose.yml' ||
		ext === 'docker-compose.yaml' ||
		ext === 'compose.yml' ||
		ext === 'compose.yaml'
	) {
		return 'docker-compose';
	}

	const languageMap: Record<string, string> = {
		ts: 'typescript',
		tsx: 'typescriptreact',
		js: 'javascript',
		jsx: 'javascriptreact',
		mjs: 'javascript',
		cjs: 'javascript',
		py: 'python',
		pyi: 'python',
		rs: 'rust',
		go: 'go',
		c: 'c',
		cpp: 'cpp',
		cc: 'cpp',
		cxx: 'cpp',
		h: 'c',
		hpp: 'cpp',
		hxx: 'cpp',
		json: 'json',
		jsonc: 'jsonc',
		html: 'html',
		htm: 'html',
		css: 'css',
		scss: 'scss',
		less: 'less',
		yaml: 'yaml',
		yml: 'yaml',
		sh: 'shellscript',
		bash: 'shellscript',
		zsh: 'shellscript',
		lua: 'lua',
		md: 'markdown',
		markdown: 'markdown',
		mdx: 'markdown',
		toml: 'toml',
		xml: 'xml',
		sql: 'sql',
		java: 'java',
		kt: 'kotlin',
		swift: 'swift',
		rb: 'ruby',
		php: 'php',
		graphql: 'graphql',
		gql: 'graphql',
		dockerfile: 'dockerfile',
	};

	return languageMap[ext] || ext;
}

/**
 * Get install hints for missing language servers
 */
export function getMissingServerHints(extensions: string[]): string[] {
	const hints: string[] = [];
	const checkedServers = new Set<string>();

	for (const ext of extensions) {
		const e = ext.startsWith('.') ? ext.slice(1) : ext;

		for (const server of KNOWN_SERVERS) {
			if (checkedServers.has(server.name)) continue;
			if (!server.languages.includes(e)) continue;

			checkedServers.add(server.name);

			if (!findCommand(server.command) && server.installHint) {
				hints.push(`${server.name}: ${server.installHint}`);
			}
		}
	}

	return hints;
}

/**
 * Try to find language server from node_modules (project-local)
 */
export function findLocalServer(
	projectRoot: string,
	serverName: string,
): string | null {
	// nosemgrep
	const localPaths = [
		join(projectRoot, 'node_modules', '.bin', serverName), // nosemgrep
		join(projectRoot, 'node_modules', serverName, 'bin', serverName), // nosemgrep
	];

	for (const path of localPaths) {
		if (existsSync(path)) {
			return path;
		}
	}

	return null;
}

/**
 * Get all known language servers with their availability status
 */
export function getKnownServersStatus(): Array<{
	name: string;
	available: boolean;
	languages: string[];
	installHint?: string;
}> {
	return KNOWN_SERVERS.map(server => ({
		name: server.name,
		available: findCommand(server.command) !== null,
		languages: server.languages,
		installHint: server.installHint,
	}));
}
