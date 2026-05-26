/**
 * Router + Specialist architecture for local models.
 *
 * @module router
 *
 * When a local provider is active, user messages are classified into a
 * specialist category so the model only sees a small, focused set of tools
 * instead of the full tool registry.
 *
 * Usage:
 *   import { classifyMessage, shouldActivateRouter, CATEGORY_TOOL_SETS } from '@/router';
 */

export {
	classifyMessage,
	getRouterClient,
	isActiveProviderLocal,
	resetRouterClient,
	shouldActivateRouter,
} from './classifier';

export {KEYWORD_HINTS, PRE_MODEL_OVERRIDES} from './keyword-hints';

export {buildRouterPrompt, cleanCategoryResponse} from './prompt';

export {
	CATEGORY_DESCRIPTIONS,
	CATEGORY_TOOL_SETS,
	type ClassifyResult,
	type RouterConfig,
	SPECIALIST_CATEGORIES,
	type SpecialistCategory,
	STICKY_CATEGORIES,
} from './types';
