import type {renderTui} from '@/app/render-tui';

type RenderTuiModule = {renderTui: typeof renderTui};

/**
 * Load the TUI renderer with React's production build.
 *
 * `react` and `react-reconciler` pick their development or production build
 * from `NODE_ENV` when they are first loaded, and the development build
 * validates keys, captures owner stacks and records `performance` marks on
 * every render. nanocoder never set `NODE_ENV`, so the TUI always ran the
 * development build.
 *
 * `NODE_ENV` defaults to `production` only while the renderer (and with it
 * React, Ink and the App) is imported, then goes back to unset, so tool
 * calls such as `execute_bash` still pass the launching shell's environment
 * to child processes (`npm install` skips devDependencies under
 * `NODE_ENV=production`). An explicit `NODE_ENV` is left as it is.
 */
export async function loadTuiRenderer(
	importRenderer: () => Promise<RenderTuiModule> = () =>
		import('@/app/render-tui'),
): Promise<typeof renderTui> {
	const wasUnset = process.env.NODE_ENV === undefined;
	if (wasUnset) {
		process.env.NODE_ENV = 'production';
	}
	try {
		return (await importRenderer()).renderTui;
	} finally {
		if (wasUnset) {
			delete process.env.NODE_ENV;
		}
	}
}
