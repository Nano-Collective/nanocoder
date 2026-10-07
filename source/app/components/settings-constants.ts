/**
 * Settings tab identifiers. Extracted to a constants module so validation
 * code (e.g. app-util.ts handling /settings arguments) can reference the
 * tab list without pulling the entire settings-tabs.tsx module and all its
 * panel dependencies into its graph.
 */

export type SettingsTabId =
	| 'appearance'
	| 'input'
	| 'behavior'
	| 'providers'
	| 'mcp'
	| 'advanced';

/** Canonical tab order. settings-tabs.tsx derives its TABS list from this. */
export const SETTINGS_TAB_IDS: readonly SettingsTabId[] = [
	'appearance',
	'input',
	'behavior',
	'providers',
	'mcp',
	'advanced',
] as const;
