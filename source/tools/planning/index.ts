/**
 * Planning Tools
 *
 * Tools for iterative task planning during chat.
 * When planning mode is enabled, these tools are added to the chat
 * to help the model plan and track tasks.
 */

export {todoAddTool} from './todo-add';
export {todoUpdateTool} from './todo-update';
export {goalCompleteTool} from './goal-complete';
export * as todoStore from './todo-store';

import type {NanocoderToolExport} from '@/types/core';
import {todoAddTool} from './todo-add';
import {todoUpdateTool} from './todo-update';
import {goalCompleteTool} from './goal-complete';

/**
 * Get all planning tools as an array
 */
export function getPlanningTools(): NanocoderToolExport[] {
	return [todoAddTool, todoUpdateTool, goalCompleteTool];
}
