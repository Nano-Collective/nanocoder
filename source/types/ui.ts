export interface Colors {
	text: string;
	base: string;
	primary: string;
	tool: string;
	secondary: string;
	success: string;
	error: string;
	info: string;
	warning: string;
	// Diff highlight colors
	diffAdded: string;
	diffRemoved: string;
	diffAddedText: string;
	diffRemovedText: string;
	// Gradient colors (optional)
	gradientColors?: string[];
}

export interface Theme {
	name: string;
	displayName: string;
	colors: Colors;
	themeType: 'light' | 'dark';
}

export type ThemePreset =
	| 'tokyo-night'
	| 'synthwave-84'
	| 'forest-night'
	| 'material-ocean'
	| 'sunset-glow'
	| 'nord-frost'
	| 'rose-pine-dawn'
	| 'neon-jungle'
	| 'midnight-amethyst'
	| 'desert-mirage'
	| 'cherry-blossom'
	| 'electric-storm'
	| 'deep-sea'
	| 'volcanic-ash'
	| 'cyberpunk-mint'
	| 'dracula'
	| 'catppuccin-latte'
	| 'catppuccin-frappe'
	| 'catppuccin-macchiato'
	| 'catppuccin-mocha'
	| 'gruvbox-dark'
	| 'gruvbox-light'
	| 'solarized-dark'
	| 'solarized-light'
	| 'one-dark'
	| 'one-light'
	| 'monokai'
	| 'github-dark'
	| 'github-light'
	| 'rose-pine'
	| 'rose-pine-moon'
	| 'ayu-dark'
	| 'ayu-mirage'
	| 'ayu-light'
	| 'night-owl'
	| 'palenight'
	| 'horizon';

export type NanocoderShape =
	| 'block'
	| 'slick'
	| 'tiny'
	| 'grid'
	| 'pallet'
	| 'shade'
	| 'simple'
	| 'simpleBlock'
	| '3d'
	| 'simple3d'
	| 'chrome'
	| 'huge';
