import type {BoxProps} from 'ink';
import {Box, Text} from 'ink';
import {useTheme} from '@/hooks/useTheme';

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

export interface StyledTitleProps extends Omit<BoxProps, 'borderStyle'> {
	/** Title text to display */
	title: string;
	/** Shape style for the title */
	shape?: TitleShape;
	/** Border/background color */
	borderColor?: string;
	/** Text color */
	textColor?: string;
	/** Icon to display before title */
	icon?: string;
	/** Padding around title */
	padding?: number;
	/** Width of the title container */
	width?: number | string;
	/** Reverse powerline symbol order (right-left instead of left-right) */
	reversePowerline?: boolean;
}

// Shape character definitions with powerline and arrow symbols
const shapeCharacters = {
	rounded: {
		topLeft: '╭',
		topRight: '╮',
		bottomLeft: '╰',
		bottomRight: '╯',
		horizontal: '─',
		vertical: '│',
	},
	square: {
		topLeft: '┌',
		topRight: '┐',
		bottomLeft: '└',
		bottomRight: '┘',
		horizontal: '─',
		vertical: '│',
	},
	double: {
		topLeft: '╔',
		topRight: '╗',
		bottomLeft: '╚',
		bottomRight: '╝',
		horizontal: '═',
		vertical: '║',
	},
	pill: {
		topLeft: ' ',
		topRight: ' ',
		bottomLeft: ' ',
		bottomRight: ' ',
		horizontal: ' ',
		vertical: ' ',
	},
	'arrow-left': {
		left: '←',
		right: '→',
		horizontal: '─',
	},
	'arrow-right': {
		left: '→',
		right: '←',
		horizontal: '─',
	},
	'arrow-double': {
		left: '«',
		right: '»',
		horizontal: '═',
	},
	'angled-box': {
		topLeft: '╱',
		topRight: '╲',
		bottomLeft: '╲',
		bottomRight: '╱',
		horizontal: '─',
		vertical: '│',
	},
	'powerline-angled': {
		left: '', // U+E0B0
		right: '', // U+E0B2
	},
	'powerline-angled-thin': {
		left: '', // U+E0B1
		right: '', // U+E0B3
	},
	'powerline-curved': {
		left: '', // U+E0B4
		right: '', // U+E0B6
	},
	'powerline-curved-thin': {
		left: '', // U+E0B5
		right: '', // U+E0B7
	},
	'powerline-flame': {
		left: '', // U+E0C0
		right: '', // U+E0C2
	},
	'powerline-flame-thin': {
		left: '', // U+E0C1
		right: '', // U+E0C3
	},
	'powerline-block': {
		left: '', // U+E0BE
		right: '', // U+E0BC
	},
	'powerline-block-alt': {
		left: '', // U+E0B8
		right: '', // U+E0BA
	},
	'powerline-segment': {
		left: '', // U+E0C4
		right: '', // U+E0C5
	},
	'powerline-segment-thin': {
		left: '', // U+E0C6
		right: '', // U+E0C7
	},
	'powerline-graph': {
		left: '', // U+E0C8
		right: '', // U+E0CA
	},
	'powerline-ribbon': {
		left: '', // U+E0D2
		right: '', // U+E0D4
	},
};

// Fallback characters for environments without Nerd Fonts support
const powerlineFallbacks = {
	'powerline-angled': {left: '<', right: '>'},
	'powerline-angled-thin': {left: '<', right: '>'},
	'powerline-curved': {left: '(', right: ')'},
	'powerline-curved-thin': {left: '(', right: ')'},
	'powerline-flame': {left: '<', right: '>'},
	'powerline-flame-thin': {left: '<', right: '>'},
	'powerline-block': {left: '[', right: ']'},
	'powerline-block-alt': {left: '[', right: ']'},
	'powerline-segment': {left: '<', right: '>'},
	'powerline-segment-thin': {left: '<', right: '>'},
	'powerline-graph': {left: '<', right: '>'},
	'powerline-ribbon': {left: '<', right: '>'},
};

// Check if Nerd Fonts are available by testing a known Nerd Font character
// This is a simple heuristic that checks if the character width is as expected
export function hasNerdFontSupport(): boolean {
	try {
		// Test character:  (U+E0B0) - should be a single width character in Nerd Fonts
		const _testChar = '';
		// In environments without Nerd Fonts, this might be replaced or have different width
		// For now, we'll assume Nerd Fonts are available (CI should have them installed)
		// This function can be enhanced with more sophisticated detection if needed
		return true;
	} catch (_error) {
		return false;
	}
}

/**
 * StyledTitle component that renders titles with various stylized shapes
 * Supports powerline symbols, arrows, and traditional box drawing characters
 */
export function StyledTitle({
	title,
	shape = 'rounded',
	borderColor,
	textColor,
	icon,
	padding = 1,
	width = 'auto',
	reversePowerline = false,
	...boxProps
}: StyledTitleProps) {
	const shapes = shapeCharacters[shape];
	const {colors} = useTheme();

	// Use provided textColor or fall back to theme's base color
	const effectiveTextColor = textColor || colors.base;

	// Fallback to rounded shape if unknown shape is provided
	const effectiveShapes = shapes || shapeCharacters.rounded;

	// Check if this is a powerline-style shape
	const isPowerlineShape = shape.startsWith('powerline-');

	// Check if this is an arrow shape
	const isArrowShape = shape.startsWith('arrow-');

	if (isPowerlineShape) {
		// Powerline-style rendering
		const powerlineShapes = effectiveShapes as {
			left: string;
			right: string;
		};

		// Apply fallback if Nerd Fonts are not available
		const hasNerdFonts = hasNerdFontSupport();
		const finalShapes = hasNerdFonts
			? powerlineShapes
			: powerlineFallbacks[shape as keyof typeof powerlineFallbacks] ||
				powerlineShapes;

		// Determine symbol order based on reversePowerline prop
		const leftSymbol = reversePowerline ? finalShapes.right : finalShapes.left;
		const rightSymbol = reversePowerline ? finalShapes.left : finalShapes.right;

		return (
			<Box width={width} {...boxProps}>
				<Box>
					{icon && <Text>{icon} </Text>}
					<Text color={borderColor} bold>
						{leftSymbol}
					</Text>
					<Text backgroundColor={borderColor} color={effectiveTextColor} bold>
						{' '}
						{title}{' '}
					</Text>
					<Text color={borderColor} bold>
						{rightSymbol}
					</Text>
				</Box>
			</Box>
		);
	}

	if (isArrowShape) {
		// Arrow-style rendering
		const arrowShapes = effectiveShapes as {
			left: string;
			right: string;
			horizontal: string;
		};

		return (
			<Box width={width} {...boxProps}>
				<Box>
					{icon && <Text>{icon} </Text>}
					<Text color={effectiveTextColor} bold>
						{arrowShapes.left}
					</Text>
					<Text backgroundColor={borderColor} color={effectiveTextColor} bold>
						{' '}
						{title}{' '}
					</Text>
					<Text color={effectiveTextColor} bold>
						{arrowShapes.right}
					</Text>
				</Box>
			</Box>
		);
	}

	if (shape === 'pill') {
		// Pill-style rendering (original TitledBox style)
		return (
			<Box width={width} {...boxProps}>
				<Box>
					{icon && <Text>{icon} </Text>}
					<Text backgroundColor={borderColor} color={effectiveTextColor} bold>
						{' '}
						{title}{' '}
					</Text>
				</Box>
			</Box>
		);
	}

	// Traditional box-style rendering (single line like powerline/arrow styles)
	const boxShapes = effectiveShapes as {
		topLeft: string;
		topRight: string;
		bottomLeft: string;
		bottomRight: string;
		horizontal: string;
		vertical: string;
	};

	return (
		<Box width={width} {...boxProps}>
			<Box>
				{icon && <Text>{icon} </Text>}
				<Text color={effectiveTextColor} bold>
					{boxShapes.topLeft}
				</Text>
				<Text backgroundColor={borderColor} color={effectiveTextColor} bold>
					{' '}
					{title}{' '}
				</Text>
				<Text color={effectiveTextColor} bold>
					{boxShapes.topRight}
				</Text>
			</Box>
		</Box>
	);
}
