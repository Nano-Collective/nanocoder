import {Box, Text, useFocus, useInput} from 'ink';
import BigText from 'ink-big-text';
import Gradient from 'ink-gradient';
import SelectInput from 'ink-select-input';
import {useMemo, useState} from 'react';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {getNanocoderShape} from '@/config/preferences';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import type {NanocoderShape} from '@/types/ui';

interface NanocoderShapeOption {
	label: string;
	value: NanocoderShape;
}

interface NanocoderShapeSelectorProps {
	onComplete: (shape: NanocoderShape) => void;
	onCancel: () => void;
}

const DEFAULT_SHAPE: NanocoderShape = 'tiny';

export default function NanocoderShapeSelector({
	onComplete,
	onCancel,
}: NanocoderShapeSelectorProps) {
	const {boxWidth, isNarrow} = useResponsiveTerminal();
	const {colors} = useTheme();

	// Get current shape from preferences or use default
	const savedShape = getNanocoderShape();
	const initialShape = savedShape ?? DEFAULT_SHAPE;

	// Store original shape for restore on cancel
	const [originalShape] = useState<NanocoderShape>(initialShape);

	// Current preview shape
	const [previewShape, setPreviewShape] =
		useState<NanocoderShape>(initialShape);

	// Auto-focus to ensure keyboard navigation works
	useFocus({autoFocus: true, id: 'nanocoder-shape-selector'});

	// Handle escape key to cancel
	useInput((_, key) => {
		if (key.escape) {
			onCancel();
		}
	});

	// Create nanocoder shape options with descriptions
	const shapeOptions: NanocoderShapeOption[] = [
		{label: 'Tiny (default) - Compact, minimal style', value: 'tiny'},
		{label: 'Block - Bold, blocky letters', value: 'block'},
		{label: 'Simple - Clean, straightforward', value: 'simple'},
		{label: 'Simple Block - Simple with block style', value: 'simpleBlock'},
		{label: 'Slick - Sleek, modern look', value: 'slick'},
		{label: 'Grid - Grid-based pattern', value: 'grid'},
		{label: 'Pallet - Artistic palette style', value: 'pallet'},
		{label: 'Shade - Shaded 3D effect', value: 'shade'},
		{label: '3D - Full 3D perspective', value: '3d'},
		{label: 'Simple 3D - Simplified 3D look', value: 'simple3d'},
		{label: 'Chrome - Metallic chrome finish', value: 'chrome'},
		{label: 'Huge - Extra large display', value: 'huge'},
	];

	// Find index of current shape for initial selection
	const initialIndex = useMemo(() => {
		const index = shapeOptions.findIndex(
			option => option.value === originalShape,
		);
		return index >= 0 ? index : 0;
	}, [originalShape]);

	const handleSelect = (item: NanocoderShapeOption) => {
		onComplete(item.value);
	};

	// Handle shape preview during navigation
	const handleHighlight = (item: NanocoderShapeOption) => {
		setPreviewShape(item.value);
	};

	// Show "NC" on narrow terminals, "Nanocoder" on wider ones
	const displayText = isNarrow ? 'NC' : 'Nanocoder';

	return (
		<>
			<Box marginBottom={1}>
				<Gradient colors={[colors.primary, colors.tool]}>
					<BigText text={displayText} font={previewShape} />
				</Gradient>
			</Box>

			<TitledBoxWithPreferences
				title="Choose your Nanocoder branding style!"
				reversePowerline={true}
				width={boxWidth}
				borderColor={colors.primary}
				paddingX={2}
				paddingY={1}
				flexDirection="column"
				marginBottom={1}
			>
				<Box paddingBottom={1}>
					<Text color={colors.text}>
						Select a font style for the Nanocoder welcome banner:
					</Text>
				</Box>
				<Box paddingBottom={1} flexDirection="column">
					<Text color={colors.secondary}>
						1. Use arrow keys to navigate through the font options.
					</Text>
					<Text color={colors.secondary}>
						2. Watch the preview above change as you navigate.
					</Text>
					<Text color={colors.secondary}>
						3. Press Enter to select your preferred style.
					</Text>
					<Text color={colors.secondary}>
						4. Press Esc to cancel and keep your current style.
					</Text>
				</Box>
			</TitledBoxWithPreferences>

			<Box
				borderStyle="round"
				width={boxWidth}
				borderColor={colors.primary}
				paddingX={2}
				paddingY={1}
				marginBottom={1}
			>
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={colors.secondary}>Select a branding style</Text>
					</Box>

					<Box marginBottom={1}>
						<Text color={colors.secondary}>
							↑/↓ Navigate • Enter Select • Esc Cancel
						</Text>
					</Box>

					<SelectInput
						items={shapeOptions}
						initialIndex={initialIndex}
						onSelect={handleSelect}
						onHighlight={handleHighlight}
					/>
				</Box>
			</Box>
		</>
	);
}
