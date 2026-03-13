import React, {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
} from 'react';
import {Completion} from '@/types/index';

type UIState = {
	showClearMessage: boolean;
	showCompletions: boolean;
	completions: Completion[];
	pendingFileMentions: string[];
	setShowClearMessage: React.Dispatch<React.SetStateAction<boolean>>;
	setShowCompletions: React.Dispatch<React.SetStateAction<boolean>>;
	setCompletions: React.Dispatch<React.SetStateAction<Completion[]>>;
	setPendingFileMentions: React.Dispatch<React.SetStateAction<string[]>>;
	resetUIState: () => void;
};

const UIStateContext = createContext<UIState | undefined>(undefined);

// Existing hook that builds the UI state (kept to separate creation from context)
function useUIState(): UIState {
	const [showClearMessage, setShowClearMessage] = useState(false);
	const [showCompletions, setShowCompletions] = useState(false);
	const [completions, setCompletions] = useState<Completion[]>([]);
	const [pendingFileMentions, setPendingFileMentions] = useState<string[]>([]);

	const resetUIState = useCallback(() => {
		setShowClearMessage(false);
		setShowCompletions(false);
		setCompletions([]);
		setPendingFileMentions([]);
	}, []);

	return useMemo(
		() => ({
			showClearMessage,
			showCompletions,
			completions,
			pendingFileMentions,
			setShowClearMessage,
			setShowCompletions,
			setCompletions,
			setPendingFileMentions,
			resetUIState,
		}),
		[
			showClearMessage,
			showCompletions,
			completions,
			pendingFileMentions,
			resetUIState,
		],
	);
}

// Provider to expose a single shared UI state instance to the subtree
export function UIStateProvider({children}: {children: React.ReactNode}) {
	const state = useUIState();
	return React.createElement(UIStateContext.Provider, {value: state}, children);
}

// Hook to consume the shared UI state from context (preferred for consumers)
export function useUIStateContext(): UIState {
	const ctx = useContext(UIStateContext);
	if (!ctx) {
		throw new Error('useUIStateContext must be used within a UIStateProvider');
	}
	return ctx;
}
