import type {ChangeDiff} from './settings-keep-discard-prompt';

/**
 * Shared types, constants, and menu definitions for the hierarchical settings system.
 */

// ─── Category Definitions ────────────────────────────────────────────────────

export type SettingsCategory =
	| 'appearance'
	| 'input'
	| 'behavior'
	| 'providers'
	| 'mcp'
	| 'webSearch'
	| 'environment'
	| 'advanced';

export interface SettingsCategoryDef {
	key: SettingsCategory;
	label: string;
	description: string;
	/** Icon or emoji to display */
	icon?: string;
	/** Whether to show a warning on entry */
	warning?: string;
}

export const CATEGORIES: SettingsCategoryDef[] = [
	{
		key: 'appearance',
		label: 'Appearance',
		description: 'Theme, title shapes, and branding',
		icon: '🎨',
	},
	{
		key: 'input',
		label: 'Input',
		description: 'Paste threshold and input behavior',
		icon: '⌨️',
	},
	{
		key: 'behavior',
		label: 'Behavior',
		description: 'Notifications, auto-compact, sessions, and modes',
		icon: '⚙️',
	},
	{
		key: 'providers',
		label: 'Providers',
		description: 'AI providers, logins, and tool approvals',
		icon: '🤖',
	},
	{
		key: 'mcp',
		label: 'MCPs',
		description: 'Model Context Protocol server configuration',
		icon: '🔌',
	},
	{
		key: 'webSearch',
		label: 'Web Search',
		description: 'Web search provider and API key',
		icon: '🌐',
	},
	{
		key: 'environment',
		label: 'Environment',
		description: 'Active environment variables (read-only)',
		icon: '🖥️',
	},
	{
		key: 'advanced',
		label: 'Advanced',
		description: 'Config files, IDE, tune, and developer settings',
		icon: '⚠️',
		warning:
			'Advanced settings can break your configuration if misused. Proceed with caution.',
	},
];

export function getCategoryByKey(
	key: SettingsCategory,
): SettingsCategoryDef | undefined {
	return CATEGORIES.find(c => c.key === key);
}

// ─── Navigation Path ─────────────────────────────────────────────────────────

/**
 * A navigation path represents the user's current location in the settings tree.
 * Examples:
 *   ['settings']                    — top-level menu
 *   ['settings', 'appearance']      — Appearance sub-menu
 *   ['settings', 'appearance', 'theme'] — Theme panel
 */
export type SettingsPath = string[];

export const ROOT_PATH: SettingsPath = ['settings'];

/** Check if the path is at the top-level settings menu */
export function isRootPath(path: SettingsPath): boolean {
	return path.length === 1 && path[0] === 'settings';
}

/** Get the parent path (one level up) */
export function parentPath(path: SettingsPath): SettingsPath {
	if (isRootPath(path)) return ROOT_PATH;
	return path.slice(0, -1);
}

/** Navigate to a child path */
export function childPath(path: SettingsPath, segment: string): SettingsPath {
	return [...path, segment];
}

/**
 * Build the breadcrumb title for the box header.
 * Examples:
 *   ['settings']                    → "Settings"
 *   ['settings', 'appearance']      → "Settings · Appearance"
 *   ['settings', 'appearance', 'theme'] → "Settings · Appearance · Theme"
 */
export function buildBreadcrumbTitle(path: SettingsPath): string {
	return path.map(segment => formatSegmentLabel(segment)).join(' · ');
}

/** Convert a path segment (kebab-case) to a display label */
function formatSegmentLabel(segment: string): string {
	return segment
		.replace(/[-_](.)/g, (_match, char) => char.toUpperCase())
		.replace(/^./, str => str.toUpperCase());
}

// ─── Menu Item Definitions ───────────────────────────────────────────────────

/** A leaf menu item that navigates to a specific settings panel */
export interface SettingsMenuItem {
	/** Unique key for this item — also used as the path segment */
	key: string;
	/** Display label */
	label: string;
	/** Description shown next to the label */
	description: string;
}

/** A category-level menu entry (has sub-items) */
export interface SettingsCategoryMenuItem {
	/** The category key */
	category: SettingsCategory;
	/** Sub-items within this category */
	items: SettingsMenuItem[];
}

// ─── Category-to-Items Mapping ───────────────────────────────────────────────

/**
 * Returns the menu items for a given category.
 * Categories that launch existing wizards return a single "Configure" item.
 */
export function getItemsForCategory(
	category: SettingsCategory,
): SettingsMenuItem[] {
	switch (category) {
		case 'appearance':
			return [
				{
					key: 'theme',
					label: 'Theme',
					description: 'Change color scheme',
				},
				{
					key: 'title-shape',
					label: 'Title Shape',
					description: 'Customize box title styles',
				},
				{
					key: 'nanocoder-shape',
					label: 'Nanocoder Shape',
					description: 'Change welcome banner font',
				},
			];

		case 'input':
			return [
				{
					key: 'paste-threshold',
					label: 'Paste Threshold',
					description: 'Set single-line paste character limit',
				},
			];

		case 'behavior':
			return [
				{
					key: 'notifications',
					label: 'Notifications',
					description: 'Desktop notification preferences',
				},
				{
					key: 'auto-compact',
					label: 'Auto-Compact',
					description: 'Context compression settings',
				},
				{
					key: 'sessions',
					label: 'Sessions',
					description: 'Session save and retention settings',
				},
				{
					key: 'default-mode',
					label: 'Default Mode',
					description: 'Initial development mode for new sessions',
				},
				{
					key: 'reasoning-traces',
					label: 'Reasoning Traces',
					description: 'Expand/collapse reasoning traces by default',
				},
			];

		case 'providers':
			return [
				{
					key: 'configure-providers',
					label: 'Configure Providers',
					description: 'Add, edit, or remove AI providers',
				},
				{
					key: 'copilot-login',
					label: 'GitHub Copilot Login',
					description: 'Authenticate with GitHub Copilot',
				},
				{
					key: 'codex-login',
					label: 'ChatGPT Codex Login',
					description: 'Authenticate with ChatGPT Codex',
				},
				{
					key: 'tool-approval',
					label: 'Tool Auto-Approval',
					description: 'Configure tools that run without confirmation',
				},
			];

		case 'mcp':
			return [
				{
					key: 'configure-mcp',
					label: 'Configure MCP Servers',
					description: 'Add, edit, or remove MCP servers',
				},
			];

		case 'webSearch':
			return [
				{
					key: 'api-key',
					label: 'API Key',
					description: 'Brave Search API key for web search',
				},
			];

		case 'environment':
			// Environment is a single read-only view — no sub-items needed
			return [];

		case 'advanced':
			return [
				{
					key: 'edit-config',
					label: 'Edit Config Files',
					description: 'Open configuration files in your editor',
				},
				{
					key: 'connect-ide',
					label: 'Connect IDE',
					description: 'Connect to a VS Code server',
				},
				{
					key: 'tune',
					label: 'Tune Model',
					description: 'Model parameters, tool profiles, and prompt tuning',
				},
			];
	}
}

// ─── Dirty State Tracking ────────────────────────────────────────────────────

/**
 * Tracks whether the user has made unsaved changes in a sub-menu.
 * Used to determine whether to show the Keep/Discard prompt.
 */
export interface DirtyState {
	/** Whether changes have been made but not yet persisted */
	isDirty: boolean;
	/** The category where dirty state originated */
	category: SettingsCategory;
	/** Detailed list of changed settings with old/new values */
	changes: ChangeDiff[];
}
