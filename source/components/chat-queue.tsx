import {Box, Static} from 'ink';
import {type Key, memo, type ReactNode, useMemo} from 'react';
import {RenderErrorBoundary} from '@/components/render-error-boundary';
import type {ChatQueueProps} from '@/types/index';

/**
 * In fullscreen mode only the visible bottom slice of the transcript can
 * ever be seen (the viewport clips the rest), but Yoga still lays out every
 * mounted component. Cap the rendered tail so layout cost stays bounded in
 * long sessions. 60 components is comfortably more than any terminal is
 * tall - it's the hard ceiling computeFullscreenTailCap clamps to, and the
 * default used when no terminal-derived cap is supplied.
 */
const FULLSCREEN_TAIL_CAP = 60;

/** Floor for computeFullscreenTailCap, below which scrollback would feel unusably shallow. */
const FULLSCREEN_TAIL_MIN = 10;

/**
 * Scales the fullscreen tail to terminal height instead of the flat
 * FULLSCREEN_TAIL_CAP: messages are typically several rows tall, so roughly
 * half as many mounted components as terminal rows comfortably covers what
 * can be visible plus a page of scrollback, without paying Yoga layout cost
 * for components that can never be seen.
 */
export function computeFullscreenTailCap(terminalRows: number): number {
	return Math.min(
		FULLSCREEN_TAIL_CAP,
		Math.max(FULLSCREEN_TAIL_MIN, Math.ceil(terminalRows / 2)),
	);
}

const componentKey = (component: ReactNode, fallback: string): Key => {
	if (
		component &&
		typeof component === 'object' &&
		'key' in component &&
		component.key
	) {
		return component.key;
	}
	return fallback;
};

export default memo(function ChatQueue({
	staticComponents = [],
	queuedComponents = [],
	renderLastQueuedComponentLive = false,
	clearKey,
	disableStatic = false,
	fullscreenTailCap = FULLSCREEN_TAIL_CAP,
}: ChatQueueProps) {
	const {staticQueuedComponents, liveQueuedComponents} = useMemo(() => {
		if (!renderLastQueuedComponentLive) {
			return {
				staticQueuedComponents: queuedComponents,
				liveQueuedComponents: [],
			};
		}

		return {
			staticQueuedComponents: queuedComponents.slice(0, -1),
			liveQueuedComponents: queuedComponents.slice(-1),
		};
	}, [queuedComponents, renderLastQueuedComponentLive]);

	// Combine static and queued components for Static rendering
	const allStaticComponents = useMemo(
		() => [...staticComponents, ...staticQueuedComponents],
		[staticComponents, staticQueuedComponents],
	);

	// Fullscreen path: no Static — render a bounded tail in regular flow so
	// the bottom-anchored viewport in ChatHistory can clip it at the top.
	const flowComponents = useMemo(() => {
		if (!disableStatic) return [];
		return allStaticComponents.slice(-fullscreenTailCap);
	}, [disableStatic, allStaticComponents, fullscreenTailCap]);

	if (disableStatic) {
		// Fullscreen (alt-screen): this transcript renders inside the scroll
		// viewport, which clips with overflow="hidden". It must NOT use a
		// negative margin — that would push content one column left of the
		// viewport's clip window and Ink would slice off the first character of
		// every line. Keep it in normal flow at the padded column.
		return (
			<Box flexDirection="column">
				{flowComponents.map((component, index) => (
					<RenderErrorBoundary key={componentKey(component, `flow-${index}`)}>
						{component}
					</RenderErrorBoundary>
				))}
				{liveQueuedComponents.length > 0 && (
					<Box flexDirection="column">
						{liveQueuedComponents.map((component, index) => (
							<RenderErrorBoundary
								key={componentKey(component, `live-${index}`)}
							>
								{component}
							</RenderErrorBoundary>
						))}
					</Box>
				)}
			</Box>
		);
	}

	return (
		<Box flexDirection="column">
			{/* Static content renders at top and persists. <Static> positions its
			    output absolutely (position:absolute in Ink), so it ignores any
			    surrounding margin and anchors to the layout origin — a wrapper
			    marginLeft would not move it horizontally. Leave it unwrapped. */}
			{allStaticComponents.length > 0 && (
				<Static key={clearKey} items={allStaticComponents}>
					{(component, index) => (
						<RenderErrorBoundary
							key={componentKey(component, `static-${index}`)}
						>
							{component}
						</RenderErrorBoundary>
					)}
				</Static>
			)}
			{/* Live content renders below */}
			{liveQueuedComponents.length > 0 && (
				<Box marginLeft={-1} flexDirection="column">
					{liveQueuedComponents.map((component, index) => (
						<RenderErrorBoundary key={componentKey(component, `live-${index}`)}>
							{component}
						</RenderErrorBoundary>
					))}
				</Box>
			)}
		</Box>
	);
});
