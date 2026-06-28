import {Box, Static} from 'ink';
import {memo, useMemo} from 'react';
import {RenderErrorBoundary} from '@/components/render-error-boundary';
import type {ChatQueueProps} from '@/types/index';

export default memo(function ChatQueue({
	staticComponents = [],
	queuedComponents = [],
	renderLastQueuedComponentLive = false,
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

	// Move ALL messages to static - prevents any re-renders
	// All messages are now immutable once rendered
	const allStaticComponents = useMemo(
		() => [...staticComponents, ...staticQueuedComponents],
		[staticComponents, staticQueuedComponents],
	);

	return (
		<Box flexDirection="column">
			{/* All content is static to prevent re-renders */}
			{allStaticComponents.length > 0 && (
				<Static items={allStaticComponents}>
					{(component, index) => {
						const key =
							component &&
							typeof component === 'object' &&
							'key' in component &&
							component.key
								? component.key
								: `static-${index}`;

						return (
							<RenderErrorBoundary key={key}>{component}</RenderErrorBoundary>
						);
					}}
				</Static>
			)}
			{liveQueuedComponents.map((component, index) => {
				const key =
					component &&
					typeof component === 'object' &&
					'key' in component &&
					component.key
						? component.key
						: `live-${index}`;

				return <RenderErrorBoundary key={key}>{component}</RenderErrorBoundary>;
			})}
		</Box>
	);
});
