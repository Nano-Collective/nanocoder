/**
 * Context management module - Public API
 * Provides token estimation, budget enforcement, and prompt trimming
 */

export type {BudgetResult} from './context-budget';
export {checkBudget, computeMaxInputTokens} from './context-budget';
export type {TrimOptions} from './context-trimmer';
export {enforceContextLimit, trimConversation} from './context-trimmer';
export type {PromptResult} from './prompt-builder';
export {buildFinalPrompt, ContextOverflowError} from './prompt-builder';
export type {SummarizerOptions, SummaryResult} from './summarizer';
export {Summarizer} from './summarizer';
export {RuleBasedSummarizer} from './summarizers/rule-based';
export type {ConversationSummary} from './summary-store';
export {SummaryStore} from './summary-store';
export {
	estimateMessageTokens,
	estimateTokens,
	getTokenizer,
} from './token-estimator';
