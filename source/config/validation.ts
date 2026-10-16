import type {MCPServerConfig} from '@/types/config';
import {logWarning} from '@/utils/message-queue';

/**
 * Collect MCP security findings as strings (no logging). Exported so tests
 * and callers can assert on the scanner without capturing logWarning, which
 * is a module binding and not monkey-patchable from globalThis.
 *
 * Prefers rawEnv/rawHeaders (pre-substitution snapshots from the loader) so
 * `$API_KEY` is not reported as a hardcoded credential after env expansion.
 */
export function collectMCPSecurityFindings(
	mcpServers: MCPServerConfig[],
): string[] {
	const findings: string[] = [];

	for (const server of mcpServers) {
		const env = server.rawEnv ?? server.env;
		if (env) {
			for (const [key, value] of Object.entries(env)) {
				// Check if the value is hardcoded (not an environment variable reference)
				if (
					typeof value === 'string' &&
					!value.startsWith('$') && // Not an environment variable reference
					(key.toLowerCase().includes('token') ||
						key.toLowerCase().includes('key') ||
						key.toLowerCase().includes('secret') ||
						key.toLowerCase().includes('password') ||
						key.toLowerCase().includes('auth'))
				) {
					findings.push(
						`Security warning: Hardcoded credential detected in MCP server "${server.name}" for environment variable "${key}". ` +
							'Consider using environment variable references (e.g., "$API_KEY") instead of hardcoded values.',
					);
				}
			}
		}

		const headers = server.rawHeaders ?? server.headers;
		if (headers) {
			for (const [key, value] of Object.entries(headers)) {
				if (
					typeof value === 'string' &&
					(key.toLowerCase().includes('authorization') ||
						key.toLowerCase().includes('auth') ||
						key.toLowerCase().includes('token')) &&
					!value.startsWith('$')
				) {
					findings.push(
						`Security warning: Hardcoded header value detected in MCP server "${server.name}" for header "${key}". ` +
							'Consider using environment variable references (e.g., "$HEADER_VALUE") instead of hardcoded values.',
					);
				}
			}
		}
	}

	return findings;
}

/**
 * Validate MCP configuration for security issues
 * Checks for hardcoded credentials and other security concerns
 */
export function validateMCPConfigSecurity(mcpServers: MCPServerConfig[]): void {
	for (const finding of collectMCPSecurityFindings(mcpServers)) {
		logWarning(finding);
	}
}

/**
 * Validate that project-level config files don't contain sensitive data
 */
export function validateProjectConfigSecurity(
	mcpServers: MCPServerConfig[],
): void {
	// Only run security validation for project-level configs
	const projectServers = mcpServers.filter(server => {
		// Check if the server has a project-level source
		return server.source === 'project';
	});

	if (projectServers.length > 0) {
		validateMCPConfigSecurity(projectServers);
	}
}
