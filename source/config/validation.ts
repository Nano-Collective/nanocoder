import type {MCPServerConfig} from '@/types/config';
import {logWarning} from '@/utils/message-queue';

/**
 * Validate MCP configuration for security issues
 * Checks for hardcoded credentials and other security concerns
 */
export function validateMCPConfigSecurity(mcpServers: MCPServerConfig[]): void {
	for (const server of mcpServers) {
		// Check for hardcoded credentials in environment variables
		if (server.env) {
			for (const [key, value] of Object.entries(server.env)) {
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
					logWarning(
						`Security warning: Hardcoded credential detected in MCP server "${server.name}" for environment variable "${key}". ` +
							'Consider using environment variable references (e.g., "$API_KEY") instead of hardcoded values.',
					);
				}
			}
		}

		// Check for hardcoded credentials in auth configuration
		if (server.auth) {
			if (server.auth.token && !server.auth.token.startsWith('$')) {
				logWarning(
					`Security warning: Hardcoded token detected in MCP server "${server.name}". ` +
						'Consider using environment variable references (e.g., "$TOKEN") instead of hardcoded values.',
				);
			}
			if (server.auth.username && !server.auth.username.startsWith('$')) {
				logWarning(
					`Security warning: Hardcoded username detected in MCP server "${server.name}". ` +
						'Consider using environment variable references (e.g., "$USERNAME") instead of hardcoded values.',
				);
			}
			if (server.auth.password && !server.auth.password.startsWith('$')) {
				logWarning(
					`Security warning: Hardcoded password detected in MCP server "${server.name}". ` +
						'Consider using environment variable references (e.g., "$PASSWORD") instead of hardcoded values.',
				);
			}
			if (server.auth.apiKey && !server.auth.apiKey.startsWith('$')) {
				logWarning(
					`Security warning: Hardcoded API key detected in MCP server "${server.name}". ` +
						'Consider using environment variable references (e.g., "$API_KEY") instead of hardcoded values.',
				);
			}
		}

		// Check for hardcoded credentials in headers
		if (server.headers) {
			for (const [key, value] of Object.entries(server.headers)) {
				if (
					typeof value === 'string' &&
					(key.toLowerCase().includes('authorization') ||
						key.toLowerCase().includes('auth') ||
						key.toLowerCase().includes('token')) &&
					!value.startsWith('$')
				) {
					logWarning(
						`Security warning: Hardcoded header value detected in MCP server "${server.name}" for header "${key}". ` +
							'Consider using environment variable references (e.g., "$HEADER_VALUE") instead of hardcoded values.',
					);
				}
			}
		}
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
