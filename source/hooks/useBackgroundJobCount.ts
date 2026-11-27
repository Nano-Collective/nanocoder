import React from 'react';
import {bashExecutor} from '@/services/bash-executor';

/**
 * Live count of running background bash jobs for the status bar. Jobs are
 * owned by the executor, not React state, so the count is re-read from it on
 * every start/complete event rather than mirrored in the app store.
 */
export function useBackgroundJobCount(): number {
	const [count, setCount] = React.useState(() =>
		bashExecutor.getRunningJobCount(),
	);

	React.useEffect(() => {
		const update = () => setCount(bashExecutor.getRunningJobCount());
		// 'start' also fires for foreground commands; getRunningJobCount() only
		// counts entries in the executor's background-job map.
		bashExecutor.on('start', update);
		bashExecutor.on('complete', update);
		// A job may have started between the initial render and this effect.
		update();
		return () => {
			bashExecutor.off('start', update);
			bashExecutor.off('complete', update);
		};
	}, []);

	return count;
}
