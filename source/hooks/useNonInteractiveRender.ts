import {createContext, useContext} from 'react';

/**
 * Provides a flag to shared rendering components so they can switch to a
 * stripped-down, stdout-friendly layout when the app is running under
 * `nanocoder run ...`.
 *
 * The interactive shell leaves this at `false`; NonInteractiveShell sets
 * it to `true`. Components that care (assistant/user/streaming messages,
 * boot summary) read the flag and render compact variants.
 */
export const NonInteractiveRenderContext = createContext<boolean>(false);

export function useNonInteractiveRender(): boolean {
	return useContext(NonInteractiveRenderContext);
}
