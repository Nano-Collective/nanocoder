import {Box, Text} from 'ink';
import React from 'react';
import {getLogger} from '@/utils/logging';

interface RenderErrorBoundaryProps {
	children: React.ReactNode;
	/** Short label for the fallback line, e.g. the tool name. */
	label?: string;
}

interface RenderErrorBoundaryState {
	message: string | null;
}

/**
 * Isolates a single rendered chat/live item so a throw during its render
 * (most commonly a malformed model tool-call arg reaching JSX — e.g. an object
 * where a string was expected) degrades to one inline error line instead of
 * tearing down the whole Ink tree. Without this, any such bug crashes the TUI.
 *
 * Must be a class component: error boundaries require getDerivedStateFromError.
 */
export class RenderErrorBoundary extends React.Component<
	RenderErrorBoundaryProps,
	RenderErrorBoundaryState
> {
	state: RenderErrorBoundaryState = {message: null};

	static getDerivedStateFromError(error: unknown): RenderErrorBoundaryState {
		return {
			message: error instanceof Error ? error.message : String(error),
		};
	}

	componentDidCatch(error: unknown): void {
		try {
			getLogger().error('Failed to render chat item', {
				label: this.props.label,
				error: error instanceof Error ? error.message : String(error),
			});
		} catch {
			// The boundary must never throw — swallow logging failures.
		}
	}

	render(): React.ReactNode {
		if (this.state.message !== null) {
			const what = this.props.label ? ` ${this.props.label}` : '';
			return (
				<Box>
					<Text color="yellow">
						⚠ Could not render{what} output ({this.state.message})
					</Text>
				</Box>
			);
		}
		return this.props.children;
	}
}
