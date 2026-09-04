import {useCallback, useEffect, useRef, useState} from 'react';
import {
	type PendingQuestion,
	setGlobalQuestionHandler,
} from '@/utils/question-queue';
import {
	type PendingToolApproval,
	setGlobalToolApprovalHandler,
} from '@/utils/tool-approval-queue';
import {
	type PendingToolConfirmation,
	setGlobalToolConfirmHandler,
} from '@/utils/tool-confirm-queue';
import {
	type PendingVoiceInstall,
	setGlobalVoiceInstallHandler,
} from '@/utils/voice-install-queue';

interface UseGlobalHandlerQueuesProps {
	setPendingQuestion: (question: PendingQuestion | null) => void;
	setIsQuestionMode: (mode: boolean) => void;
}

interface GlobalHandlerQueues {
	handleQuestionAnswer: (answer: string) => void;
	pendingSubagentApproval: PendingToolApproval | null;
	handleSubagentToolApproval: (confirmed: boolean) => void;
	pendingToolConfirmation: PendingToolConfirmation | null;
	handleToolConfirmation: (confirmed: boolean) => void;
	pendingVoiceInstall: PendingVoiceInstall | null;
	handleVoiceInstallConfirm: (confirmed: boolean) => void;
}

export function useGlobalHandlerQueues({
	setPendingQuestion,
	setIsQuestionMode,
}: UseGlobalHandlerQueuesProps): GlobalHandlerQueues {
	const questionResolverRef = useRef<((answer: string) => void) | null>(null);

	useEffect(() => {
		setGlobalQuestionHandler((question: PendingQuestion) => {
			return new Promise<string>(resolve => {
				questionResolverRef.current = resolve;
				setPendingQuestion(question);
				setIsQuestionMode(true);
			});
		});
	}, [setPendingQuestion, setIsQuestionMode]);

	const handleQuestionAnswer = useCallback(
		(answer: string) => {
			if (questionResolverRef.current) {
				questionResolverRef.current(answer);
				questionResolverRef.current = null;
			}
			setIsQuestionMode(false);
			setPendingQuestion(null);
		},
		[setIsQuestionMode, setPendingQuestion],
	);

	const toolApprovalResolverRef = useRef<((approved: boolean) => void) | null>(
		null,
	);
	const [pendingSubagentApproval, setPendingSubagentApproval] =
		useState<PendingToolApproval | null>(null);

	useEffect(() => {
		setGlobalToolApprovalHandler((approval: PendingToolApproval) => {
			return new Promise<boolean>(resolve => {
				toolApprovalResolverRef.current = resolve;
				setPendingSubagentApproval(approval);
			});
		});
	}, []);

	const handleSubagentToolApproval = useCallback((confirmed: boolean) => {
		if (toolApprovalResolverRef.current) {
			toolApprovalResolverRef.current(confirmed);
			toolApprovalResolverRef.current = null;
		}
		setPendingSubagentApproval(null);
	}, []);

	const toolConfirmResolverRef = useRef<((approved: boolean) => void) | null>(
		null,
	);
	const [pendingToolConfirmation, setPendingToolConfirmation] =
		useState<PendingToolConfirmation | null>(null);

	useEffect(() => {
		setGlobalToolConfirmHandler((confirmation: PendingToolConfirmation) => {
			return new Promise<boolean>(resolve => {
				toolConfirmResolverRef.current = resolve;
				setPendingToolConfirmation(confirmation);
			});
		});
	}, []);

	const handleToolConfirmation = useCallback((confirmed: boolean) => {
		if (toolConfirmResolverRef.current) {
			toolConfirmResolverRef.current(confirmed);
			toolConfirmResolverRef.current = null;
		}
		setPendingToolConfirmation(null);
	}, []);

	const voiceInstallResolverRef = useRef<((confirmed: boolean) => void) | null>(
		null,
	);
	const [pendingVoiceInstall, setPendingVoiceInstall] =
		useState<PendingVoiceInstall | null>(null);

	useEffect(() => {
		setGlobalVoiceInstallHandler((install: PendingVoiceInstall) => {
			return new Promise<boolean>(resolve => {
				voiceInstallResolverRef.current = resolve;
				setPendingVoiceInstall(install);
			});
		});
	}, []);

	const handleVoiceInstallConfirm = useCallback((confirmed: boolean) => {
		if (voiceInstallResolverRef.current) {
			voiceInstallResolverRef.current(confirmed);
			voiceInstallResolverRef.current = null;
		}
		setPendingVoiceInstall(null);
	}, []);

	return {
		handleQuestionAnswer,
		pendingSubagentApproval,
		handleSubagentToolApproval,
		pendingToolConfirmation,
		handleToolConfirmation,
		pendingVoiceInstall,
		handleVoiceInstallConfirm,
	};
}
