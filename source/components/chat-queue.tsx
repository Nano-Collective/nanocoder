import type {ChatQueueProps} from '@/types/index';
import {getLogger} from '@/utils/logging';
import {Box, Static} from 'ink';
import React, {Fragment, memo, useMemo} from 'react';

export default memo(function ChatQueue({
	staticComponents = [],
	queuedComponents = [],
}: ChatQueueProps) {
	const logger = getLogger();

	// Move ALL messages to static - prevents any re-renders
	// All messages are now immutable once rendered
	const allStaticComponents = useMemo(
		() => [...staticComponents, ...queuedComponents],
		[staticComponents, queuedComponents],
	);

	return (
		<Box flexDirection="column">
			{/* All content is static to prevent re-renders */}
			{allStaticComponents.length > 0 && (
				<Static items={allStaticComponents}>
					{(component, index) => {
						const extractedKey =
							component && typeof component === 'object' && 'key' in component
								? component.key
								: null;

						const key =
							typeof extractedKey === 'string' && extractedKey
								? extractedKey
								: `static-${index}`;

						const componentType = React.isValidElement(component)
							? ((component.type as {name?: string})?.name ?? 'unknown')
							: typeof component;

						logger.debug('ChatQueue rendering item', {
							index,
							extractedKey,
							usedKey: key,
							componentType,
							isUsingFallbackKey: key === `static-${index}`,
						});

						return <Fragment key={key}>{component}</Fragment>;
					}}
				</Static>
			)}
		</Box>
	);
});
