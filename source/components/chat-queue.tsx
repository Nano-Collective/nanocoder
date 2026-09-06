import {Box, Static} from 'ink';
import {type Key, memo, type ReactNode, useMemo} from 'react';
import {RenderErrorBoundary} from '@/components/render-error-boundary';
import type {ChatQueueProps} from '@/types/index';

/**
 * In fullscreen mode only the visible bottom slice of the transcript can
 * ever be seen (the viewport clips the rest), but Yoga still lays out every
 * mounted component. Cap the rendered tail so layout cost stays bounded in
 * long sessions. 60 components is comfortably more than any terminal is
 * tall.
 */
const FULLSCREEN_TAIL_CAP = 60;

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
	leftMargin = 0,
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
		return allStaticComponents.slice(-FULLSCREEN_TAIL_CAP);
	}, [disableStatic, allStaticComponents]);

	if (disableStatic) {
		// Fullscreen (alt-screen): this transcript renders inside the scroll
		// viewport, which clips with overflow="hidden". It must NOT use a
		// negative margin — that would push content one column left of the
		// viewport's clip window and Ink would slice off the first character of
		// every line. Keep it in normal flow at the padded column.
		return (
			<Box flexDirection="column" marginLeft={leftMargin}>
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
			    marginLeft would not move it horizontally. The left-align margin has
			    to live on each item instead, inside the render prop. */}
			{allStaticComponents.length > 0 && (
				<Static key={clearKey} items={allStaticComponents}>
					{(component, index) => (
						<Box
							key={componentKey(component, `static-${index}`)}
							marginLeft={leftMargin}
						>
							<RenderErrorBoundary>{component}</RenderErrorBoundary>
						</Box>
					)}
				</Static>
			)}
			{/* Live content renders below. marginLeft=-1 already corrects for an
			    inherent 1-column offset between normal-flow content and the
			    absolutely-positioned Static block above it; leftMargin adds the
			    same left-align shift as the static items and the input box. */}
			{liveQueuedComponents.length > 0 && (
				<Box marginLeft={leftMargin - 1} flexDirection="column">
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
