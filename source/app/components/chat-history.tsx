import {Box, measureElement, Text, useInput} from 'ink';
import React from 'react';
import ChatQueue from '@/components/chat-queue';
import {RenderErrorBoundary} from '@/components/render-error-boundary';
import {useTerminalRows} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {wheelEvents} from '@/utils/terminal-mouse';

export interface ChatHistoryProps {
	/** Whether the chat has started (ready to display) */
	startChat: boolean;
	/** Static components that are frozen at the top (welcome, status) */
	staticComponents: React.ReactNode[];
	/** Dynamic components added during the chat session */
	queuedComponents: React.ReactNode[];
	/** Live component rendered below the transcript (streaming updates) */
	liveComponent?: React.ReactNode;
	renderLastQueuedComponentLive?: boolean;
	/** Key to force a full transcript reset (e.g., on /clear) */
	clearKey?: string;
	/**
	 * Fullscreen (alternate-screen) mode: render a bottom-anchored viewport
	 * that clips overflowing history at the top, instead of an append-only
	 * Static transcript. Ink's Static is useless on the alternate screen —
	 * the alt buffer has no scrollback for it to print into.
	 */
	fullscreen?: boolean;
	/**
	 * Whether PageUp/PageDown scrolling is active. Off while a modal
	 * (model selector, wizard, explorer) is open so those keys reach the
	 * modal instead — Ink runs ALL useInput handlers for every keypress.
	 */
	scrollActive?: boolean;
}

/**
 * Chat history for two rendering worlds:
 *
 * - Fullscreen (interactive TUI on the alt screen): a fixed-height viewport.
 *   Content is bottom-anchored via justifyContent="flex-end"; when it grows
 *   taller than the viewport, the top (banner, oldest messages) clips away —
 *   the same model OpenClaude/Codex use for their fullscreen modes. The
 *   inner wrapper MUST keep flexShrink={0}: without it Yoga shrinks each
 *   child to fit and every other line disappears. PageUp/PageDown scroll
 *   the viewport by applying a negative marginBottom to the content, which
 *   pushes it down past the clip edge and reveals older rows at the top.
 *
 * - Transcript (non-interactive `run` mode, main screen buffer): the classic
 *   Ink Static append-only flow, which prints finished turns into the
 *   terminal's native scrollback.
 */
export const ChatHistory = React.memo(function ChatHistory({
	startChat,
	staticComponents,
	queuedComponents,
	liveComponent,
	renderLastQueuedComponentLive,
	clearKey,
	fullscreen = false,
	scrollActive = false,
}: ChatHistoryProps): React.ReactElement {
	const {colors} = useTheme();
	const terminalRows = useTerminalRows();
	const viewportRef = React.useRef(null);
	const contentRef = React.useRef(null);
	const [scrollOffset, setScrollOffset] = React.useState(0);

	// New content or a vertical resize snaps the view back to the bottom
	// (sticky scroll) — matching every chat TUI's behavior.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the deps are intentional TRIGGERS (new chat content / resize), not values read inside the effect.
	React.useEffect(() => {
		setScrollOffset(0);
	}, [queuedComponents, liveComponent, terminalRows]);

	// Scroll by `delta` rows (positive = towards older content), clamped to
	// the measured content extent. Shared by PageUp/PageDown and the mouse
	// wheel. `halfPage: true` scales the step to half the viewport height.
	const scrollBy = React.useCallback((delta: number, halfPage = false) => {
		const viewport = viewportRef.current
			? measureElement(viewportRef.current)
			: undefined;
		const content = contentRef.current
			? measureElement(contentRef.current)
			: undefined;
		const viewportHeight = viewport?.height ?? 0;
		const contentHeight = content?.height ?? 0;
		const maxOffset = Math.max(0, contentHeight - viewportHeight);
		const step = halfPage
			? Math.max(1, Math.floor(viewportHeight / 2)) * Math.sign(delta)
			: delta;

		setScrollOffset(current => {
			if (step > 0) return Math.min(current + step, maxOffset);
			// The indicator row shifts the viewport height by 1 between
			// scrolled/unscrolled states, so clamping can strand the view
			// a couple of rows above the bottom — snap those to 0.
			const next = Math.max(current + step, 0);
			return next <= 2 ? 0 : next;
		});
	}, []);

	useInput(
		(_input, key) => {
			if (key.pageUp) scrollBy(1, true);
			else if (key.pageDown) scrollBy(-1, true);
		},
		{isActive: fullscreen && scrollActive},
	);

	// Mouse wheel (SGR mouse reporting, stripped from stdin in cli.tsx and
	// re-emitted on this bus). Three rows per tick, like most pagers.
	React.useEffect(() => {
		if (!fullscreen || !scrollActive) return;
		const onWheel = (direction: 'up' | 'down') => {
			scrollBy(direction === 'up' ? 3 : -3);
		};
		wheelEvents.on('wheel', onWheel);
		return () => {
			wheelEvents.off('wheel', onWheel);
		};
	}, [fullscreen, scrollActive, scrollBy]);

	// Fullscreen: the banner renders in regular flow as the first row of the
	// scrolling content (it clips away with old history, like OpenClaude).
	// Inline: the banner stays INSIDE Static so it prints exactly once into
	// the terminal's native scrollback — rendering it in the live region was
	// the original "banner disappears" bug: Ink erases and rewrites the
	// whole non-Static region on every keystroke, and clips its top first
	// once it outgrows the terminal.
	const banner = fullscreen ? staticComponents[0] : undefined;
	const frozenComponents = React.useMemo(
		() => (fullscreen ? staticComponents.slice(1) : staticComponents),
		[fullscreen, staticComponents],
	);

	const chatQueueProps = React.useMemo(
		() => ({
			staticComponents: frozenComponents,
			queuedComponents,
			renderLastQueuedComponentLive,
			clearKey,
			disableStatic: fullscreen,
		}),
		[
			frozenComponents,
			queuedComponents,
			renderLastQueuedComponentLive,
			clearKey,
			fullscreen,
		],
	);

	const content = (
		<>
			{startChat && banner && (
				<RenderErrorBoundary label="banner">{banner}</RenderErrorBoundary>
			)}

			{startChat && <ChatQueue {...chatQueueProps} />}

			{liveComponent && (
				// Inline: Static renders at column 0, so live content shifts -1 to
				// match. Fullscreen: viewport already starts at column 1 (Static
				// disabled), so no compensation is needed.
				<Box marginLeft={fullscreen ? 0 : -1} flexDirection="column">
					<RenderErrorBoundary label="live">
						{liveComponent}
					</RenderErrorBoundary>
				</Box>
			)}
		</>
	);

	if (!fullscreen) {
		return (
			<Box flexGrow={1} flexDirection="column" minHeight={0}>
				{content}
			</Box>
		);
	}

	return (
		// flexBasis={0} is load-bearing: without it the flex basis is the
		// full transcript height, so Yoga shrinks the input/status footer
		// proportionally along with the chat area and crushes it. Basis 0 +
		// grow 1 means this box only ever receives the space left over
		// after the (flexShrink=0) footer takes its natural height.
		<Box flexGrow={1} flexBasis={0} flexDirection="column" minHeight={0}>
			{scrollOffset > 0 && (
				<Box flexShrink={0}>
					<Text color={colors.secondary}>
						{`── ↑ ${scrollOffset} rows · PgUp/PgDn · new output returns to bottom ──`}
					</Text>
				</Box>
			)}
			<Box
				ref={viewportRef}
				flexGrow={1}
				flexBasis={0}
				flexDirection="column"
				minHeight={0}
				overflow="hidden"
				justifyContent="flex-end"
			>
				<Box
					ref={contentRef}
					flexDirection="column"
					flexShrink={0}
					marginBottom={-scrollOffset}
				>
					{content}
				</Box>
			</Box>
		</Box>
	);
});
