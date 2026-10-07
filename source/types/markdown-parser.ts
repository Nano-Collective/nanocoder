import type {Colors as FullColors} from '@/types/ui';

/**
 * The palette subset used for rendering: the markdown parser, and the
 * cli-highlight theme derived from it in `@/config/themes`. Named for the job
 * rather than the source now that it is shared by both.
 */
export type RenderPalette = Pick<
	FullColors,
	| 'primary'
	| 'secondary'
	| 'success'
	| 'error'
	| 'warning'
	| 'info'
	| 'text'
	| 'tool'
>;

/**
 * @deprecated Prefer {@link RenderPalette}. Kept so the markdown-parser call
 * sites and its re-export keep working without a rename sweep.
 */
export type Colors = RenderPalette;
