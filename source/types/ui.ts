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
	| 'catppuccin-mocha';

export type TitleShape =
	| 'rounded'
	| 'square'
	| 'double'
	| 'pill'
	| 'arrow-left'
	| 'arrow-right'
	| 'arrow-double'
	| 'angled-box'
	| 'powerline-angled'
	| 'powerline-angled-thin'
	| 'powerline-block'
	| 'powerline-block-alt'
	| 'powerline-curved'
	| 'powerline-curved-thin'
	| 'powerline-flame'
	| 'powerline-flame-thin'
	| 'powerline-graph'
	| 'powerline-ribbon'
	| 'powerline-segment'
	| 'powerline-segment-thin';

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
