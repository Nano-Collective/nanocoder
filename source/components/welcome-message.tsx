import fs from 'fs';
import {Box, Text} from 'ink';
import BigText from 'ink-big-text';
import Gradient from 'ink-gradient';
import path from 'path';
import {memo, useState} from 'react';
import {fileURLToPath} from 'url';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {getNanocoderShape} from '@/config/preferences';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import type {NanocoderShape} from '@/types/ui';
import {getRandomTip} from '@/utils/tips';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read package.json once at module load time to avoid repeated file reads
const packageJson = JSON.parse(
	fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'),
) as {version: string};

const DEFAULT_SHAPE: NanocoderShape = 'tiny';

type WelcomeMessageProps = {
	/**
	 * Pin the tip shown under the banner. Defaults to a random one held for
	 * the life of the component; tests pass an explicit tip so they can assert
	 * exact text instead of scanning the catalogue.
	 */
	tip?: string;
};

export default memo(function WelcomeMessage({tip}: WelcomeMessageProps) {
	const {boxWidth, isNarrow, isNormal} = useResponsiveTerminal();
	const {colors} = useTheme();
	const [randomTip] = useState(getRandomTip);
	const shownTip = tip ?? randomTip;

	// Get the user's preferred nanocoder shape or use default
	const nanocoderShape = getNanocoderShape() ?? DEFAULT_SHAPE;

	return (
		<>
			{/* Narrow terminal: simple text without boxes */}
			{isNarrow ? (
				<>
					<Gradient colors={[colors.primary, colors.tool]}>
						<BigText text="NC" font={nanocoderShape} />
					</Gradient>
					<Box
						flexDirection="column"
						marginBottom={1}
						borderStyle="round"
						borderColor={colors.primary}
						paddingY={1}
						paddingX={2}
					>
						<Box marginBottom={1}>
							<Text color={colors.primary} bold>
								✻ Version {packageJson.version} ✻
							</Text>
						</Box>

						<Text color={colors.text}>Quick tips:</Text>
						<Text color={colors.secondary}>• Use natural language</Text>
						<Text color={colors.secondary}>• /help for commands</Text>
						<Text color={colors.secondary}>• Ctrl+C to quit</Text>
					</Box>
				</>
			) : (
				/* Normal/Wide terminal: full version with TitledBoxWithPreferences */
				<>
					<Gradient colors={[colors.primary, colors.tool]}>
						<BigText text="Nanocoder" font={nanocoderShape} />
					</Gradient>

					<TitledBoxWithPreferences
						title={`✻ Welcome to Nanocoder ${packageJson.version} ✻`}
						width={boxWidth}
						borderColor={colors.primary}
						paddingX={2}
						paddingY={1}
						flexDirection="column"
						marginBottom={1}
					>
						<Box paddingBottom={1}>
							<Text color={colors.text}>Tips for getting started:</Text>
						</Box>
						<Box paddingBottom={1} flexDirection="column">
							<Text color={colors.secondary}>
								{isNormal
									? '1. Use natural language to describe your task.'
									: '1. Use natural language to describe what you want to build.'}
							</Text>
							<Text color={colors.secondary}>
								2. Ask for file analysis, editing, bash commands and more.
							</Text>
							<Text color={colors.secondary}>
								{isNormal
									? '3. Be specific for best results.'
									: '3. Be specific as you would with another engineer for best results.'}
							</Text>
							<Text color={colors.secondary}>
								4. Type /exit or press Ctrl+C to quit.
							</Text>
						</Box>
						<Text color={colors.text}>/help for help</Text>
					</TitledBoxWithPreferences>
				</>
			)}
			{/*
			 * No paddingX: the tip sits flush with the left border of the box
			 * above it, which renders at column 0 in both layouts. Indenting it
			 * to the box's inner text instead leaves it visibly off-grid.
			 */}
			<Box marginBottom={1}>
				<Text color={colors.secondary} dimColor>
					Tip: {shownTip}
				</Text>
			</Box>
		</>
	);
});
