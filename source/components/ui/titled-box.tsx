import type {BoxProps} from 'ink';
import {Box} from 'ink';
import {useTheme} from '@/hooks/useTheme';
import {useTitleShape} from '@/hooks/useTitleShape';
import type {TitleShape} from '@/types/ui';
import {StyledTitle} from './styled-title';

export interface TitledBoxProps extends Omit<BoxProps, 'borderStyle'> {
	/** Title to display in the top border */
	title: string;
	/** Border color */
	borderColor?: string;
	/** Shape style for the title */
	shape?: TitleShape;
	/** Icon to display before title */
	icon?: string;
	/** Reverse powerline symbol order (right-left instead of left-right) */
	reversePowerline?: boolean;
	/** Children to render inside the box */
	children: React.ReactNode;
}

/**
 * A simple titled box component that displays a title with stylized shapes
 * above a bordered box. Replacement for @mishieck/ink-titled-box.
 */
export function TitledBox({
	title,
	borderColor,
	shape = 'pill',
	icon,
	reversePowerline = false,
	children,
	width,
	paddingX,
	paddingY,
	flexDirection,
	marginBottom,
	...boxProps
}: TitledBoxProps) {
	const {colors} = useTheme();

	return (
		<Box
			flexDirection="column"
			width={width}
			marginBottom={marginBottom}
			{...boxProps}
		>
			{/* Title row with stylized shape */}
			<StyledTitle
				title={title}
				shape={shape}
				borderColor={borderColor}
				textColor={colors.base}
				icon={icon}
				reversePowerline={reversePowerline}
				width={width}
			/>

			{/* Content box with border */}
			<Box
				borderStyle="round"
				borderColor={borderColor}
				paddingX={paddingX}
				paddingY={paddingY}
				flexDirection={flexDirection}
				width={width}
			>
				{children}
			</Box>
		</Box>
	);
}

/**
 * A titled box component that respects user's preferred title shape from context
 * Falls back to the explicit shape if provided, then to user preference, then to 'pill'
 */
export function TitledBoxWithPreferences({
	title,
	borderColor,
	shape,
	icon,
	reversePowerline = false,
	children,
	width,
	paddingX,
	paddingY,
	flexDirection,
	marginBottom,
}: TitledBoxProps) {
	// Get the user's preferred title shape from context
	const {currentTitleShape} = useTitleShape();

	// Use explicit shape if provided, otherwise use preferred shape, otherwise default to 'pill'
	const finalShape = shape || currentTitleShape || 'pill';

	return (
		<TitledBox
			title={title}
			borderColor={borderColor}
			shape={finalShape}
			icon={icon}
			reversePowerline={reversePowerline}
			children={children}
			width={width}
			paddingX={paddingX}
			paddingY={paddingY}
			flexDirection={flexDirection}
			marginBottom={marginBottom}
		/>
	);
}
