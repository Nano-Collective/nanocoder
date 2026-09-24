import {createContext, useContext} from 'react';
import type {TitleShape} from '@/components/ui/styled-title';
import {
	getTitleShape as getTitleShapeFromPrefs,
	updateTitleShape as updateTitleShapeInPrefs,
} from '@/config/preferences';

interface TitleShapeContextType {
	currentTitleShape: TitleShape;
	/**
	 * Preview only — updates the in-memory shape (and thus the live app title)
	 * WITHOUT persisting to preferences. Used to show a live preview while the
	 * user navigates a shape selector, so an un-committed highlight never
	 * reaches disk.
	 */
	setCurrentTitleShape: (shape: TitleShape) => void;
	/**
	 * Commit — persists the shape to preferences and updates the in-memory
	 * shape. Used when an edit is confirmed (e.g. Enter in the Title Shape
	 * settings panel).
	 */
	commitTitleShape: (shape: TitleShape) => void;
}

export const TitleShapeContext = createContext<TitleShapeContextType | null>(
	null,
);

export function useTitleShape(): TitleShapeContextType {
	const context = useContext(TitleShapeContext);
	if (!context) {
		throw new Error('useTitleShape must be used within a TitleShapeProvider');
	}
	return context;
}

/**
 * Helper function to get initial title shape from preferences
 */
export function getInitialTitleShape(): TitleShape {
	return getTitleShapeFromPrefs() || 'pill';
}

/**
 * Helper function to update title shape in both context and preferences
 */
export function updateTitleShape(shape: TitleShape): void {
	updateTitleShapeInPrefs(shape);
}
