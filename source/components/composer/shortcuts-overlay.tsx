import {Box, Text} from 'ink';
import {KEYBOARD_SHORTCUTS} from '@/components/composer/keymap';
import type {ShortcutsWindow} from '@/components/composer/useShortcutsOverlay';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useTheme} from '@/hooks/useTheme';

/** The `?` legend, showing the window of rows that fits the terminal. */
export function ShortcutsOverlay({
	width,
	view: {start, visibleCount, maxStart},
}: {
	width: number;
	view: ShortcutsWindow;
}) {
	const {colors} = useTheme();
	return (
		<TitledBoxWithPreferences
			title="Keyboard Shortcuts"
			width={width}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			marginTop={1}
			flexDirection="column"
		>
			{KEYBOARD_SHORTCUTS.slice(start, start + visibleCount).map(
				([keybind, label]) => (
					// One row per shortcut: a wrapped label would add rows the
					// height budget in useShortcutsOverlay does not count.
					<Text key={keybind} wrap="truncate-end">
						<Text color={colors.primary} bold>
							{keybind}
						</Text>
						<Text color={colors.text}> — {label}</Text>
					</Text>
				),
			)}
			<Box marginTop={1}>
				{/* The close hint leads so truncation drops the position first. */}
				<Text color={colors.secondary} wrap="truncate-end">
					{maxStart > 0
						? `? or Esc to close · ↑/↓ scroll · ${start + 1}-${start + visibleCount} of ${KEYBOARD_SHORTCUTS.length}`
						: 'Press ? or Esc to close'}
				</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}
