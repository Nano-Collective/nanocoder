import React from 'react';
import AssistantMessage from '@/components/assistant-message';
import {errorMsg, infoMsg} from '@/components/message-factory';
import {ReviewActivity} from '@/components/review-activity';
import {markRunFailed} from '@/conversation/run-outcome';
import {ReviewActivityStore} from '@/review/review-activity';
import {renderGroundedReviewReport} from '@/review/review-report';
import {createReviewMessage} from '@/review/review-session';
import {resolveReviewToolMode} from '@/review/review-tool-mode';
import type {ReviewFoundationTools} from '@/review/review-tools';
import {runDeepReview} from '@/review/run-deep-review';
import {runGroundedReview} from '@/review/run-grounded-review';
import type {CommandCompletion, CommandContext} from '@/types/commands';
import {formatError} from '@/utils/error-formatter';
import {generateKey} from '@/utils/key-generator';

export type GroundedReviewDependencies = {tools?: ReviewFoundationTools};

// Contexts change between submissions; the React live-slot setter is stable
// for the lifetime of one app and does not retain an unmounted app.
const runningReviews = new WeakSet<CommandContext['setLiveComponent']>();

/**
 * Runs `work` unless a review already owns the live slot. A second review
 * would replace the running one's activity view and its Escape handler.
 */
export async function runExclusiveReview(
	context: CommandContext,
	work: () => Promise<CommandCompletion>,
): Promise<CommandCompletion> {
	if (runningReviews.has(context.setLiveComponent)) {
		return {
			show: infoMsg(
				'A review is already running. Press Esc to cancel it first.',
				'review-already-running',
			),
		};
	}
	runningReviews.add(context.setLiveComponent);
	try {
		return await work();
	} finally {
		runningReviews.delete(context.setLiveComponent);
	}
}

/**
 * The default `/review` (Grounded) and `/review deep`: an agent review with a
 * live activity view (Escape cancels) whose result is saved to the transcript
 * for session resume.
 */
export async function runGroundedReviewCommand(
	context: CommandContext,
	tier: 'Grounded' | 'Deep',
	request: string,
	dependencies: GroundedReviewDependencies = {},
): Promise<CommandCompletion> {
	const {
		addToChatQueue,
		client,
		setLiveComponent,
		setLiveComponentCapturesInput,
		setIsToolExecuting,
	} = context;
	if (!client) {
		return {show: errorMsg('No active LLM client available.', 'review')};
	}

	const activity = new ReviewActivityStore();
	const controller = new AbortController();
	try {
		setIsToolExecuting(true);
		setLiveComponentCapturesInput(true);
		setLiveComponent(
			React.createElement(ReviewActivity, {
				key: generateKey('review-activity-live'),
				store: activity,
				title: `${tier} review`,
				interactive: true,
				onCancel: () => controller.abort(),
			}),
		);
		const runReview = tier === 'Deep' ? runDeepReview : runGroundedReview;
		const result = await runReview({
			request,
			client,
			toolMode: resolveReviewToolMode(
				context.provider,
				context.model,
				context.handlerMetadata().tune,
			),
			activity,
			signal: controller.signal,
			...(dependencies.tools ? {tools: dependencies.tools} : {}),
		});
		const report = renderGroundedReviewReport(result, tier);
		if (result.status === 'failed') {
			markRunFailed(result.message ?? 'review failed');
		}
		setLiveComponent(null);
		addToChatQueue(
			React.createElement(ReviewActivity, {
				key: generateKey('review-activity-final'),
				summary: result.activity,
				title: `${tier} review`,
				recentCount: 0,
				outcome: result.status,
			}),
		);
		addToChatQueue(
			React.createElement(AssistantMessage, {
				key: generateKey('review-report'),
				message: report,
				model: context.model,
				showUsageFooter: false,
			}),
		);
		context.appendMessages([
			createReviewMessage({
				report,
				tier,
				status: result.status,
				activity: result.activity,
			}),
		]);
	} catch (error) {
		markRunFailed(formatError(error));
		setLiveComponent(null);
		addToChatQueue(
			errorMsg(`Review failed: ${formatError(error)}`, 'review-error'),
		);
	} finally {
		setLiveComponentCapturesInput(false);
		setIsToolExecuting(false);
	}
	return 'done-after-render';
}
