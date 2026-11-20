// Kept out of `cli.tsx` so that the CLI entry point has no JSX: compiled JSX
// adds a static `react/jsx-runtime` import, which would load React before
// `loadTuiRenderer` gets a chance to pick its production build.
import {type Instance, type RenderOptions, render} from 'ink';
import App from '@/app/App';
import type {AppProps} from '@/app/types';

export function renderTui(props: AppProps, options: RenderOptions): Instance {
	return render(<App {...props} />, options);
}
