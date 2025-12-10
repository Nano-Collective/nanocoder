/**
 * Todo Store
 *
 * Simple in-memory store for planning todos.
 * Shared across planning tools to maintain state during a session.
 */

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface TodoItem {
	id: string;
	title: string;
	status: TodoStatus;
	createdAt: number;
	updatedAt: number;
}

export interface TodoState {
	goal: string;
	todos: TodoItem[];
	goalComplete: boolean;
	completionReason?: string;
}

/**
 * Generate a short unique ID
 */
function generateId(): string {
	return Math.random().toString(36).substring(2, 8);
}

/**
 * Global todo state for the current session
 */
let currentState: TodoState = {
	goal: '',
	todos: [],
	goalComplete: false,
};

/**
 * Event listeners for state changes
 */
type StateListener = (state: TodoState) => void;
const listeners: StateListener[] = [];

/**
 * Notify all listeners of state change
 */
function notifyListeners(): void {
	for (const listener of listeners) {
		listener(currentState);
	}
}

/**
 * Subscribe to state changes
 */
export function subscribe(listener: StateListener): () => void {
	listeners.push(listener);
	return () => {
		const index = listeners.indexOf(listener);
		if (index > -1) {
			listeners.splice(index, 1);
		}
	};
}

/**
 * Get current state
 */
export function getState(): TodoState {
	return currentState;
}

/**
 * Set the goal for this planning session
 */
export function setGoal(goal: string): void {
	currentState = {
		goal,
		todos: [],
		goalComplete: false,
	};
	notifyListeners();
}

/**
 * Add a new todo item
 */
export function addTodo(title: string): TodoItem {
	const todo: TodoItem = {
		id: generateId(),
		title,
		status: 'pending',
		createdAt: Date.now(),
		updatedAt: Date.now(),
	};
	currentState = {
		...currentState,
		todos: [...currentState.todos, todo],
	};
	notifyListeners();
	return todo;
}

/**
 * Update a todo's status
 */
export function updateTodo(id: string, status: TodoStatus): TodoItem | null {
	const todoIndex = currentState.todos.findIndex(t => t.id === id);
	if (todoIndex === -1) {
		return null;
	}

	const updatedTodo = {
		...currentState.todos[todoIndex],
		status,
		updatedAt: Date.now(),
	};

	const newTodos = [...currentState.todos];
	newTodos[todoIndex] = updatedTodo;

	currentState = {
		...currentState,
		todos: newTodos,
	};
	notifyListeners();
	return updatedTodo;
}

/**
 * Mark a todo as in progress (and others as pending if they were in_progress)
 */
export function startTodo(id: string): TodoItem | null {
	// First, set any in_progress todos back to pending
	const newTodos = currentState.todos.map(t =>
		t.status === 'in_progress' ? {...t, status: 'pending' as TodoStatus, updatedAt: Date.now()} : t
	);

	// Then set the target todo to in_progress
	const todoIndex = newTodos.findIndex(t => t.id === id);
	if (todoIndex === -1) {
		return null;
	}

	newTodos[todoIndex] = {
		...newTodos[todoIndex],
		status: 'in_progress',
		updatedAt: Date.now(),
	};

	currentState = {
		...currentState,
		todos: newTodos,
	};
	notifyListeners();
	return newTodos[todoIndex];
}

/**
 * Mark the goal as complete
 */
export function completeGoal(reason: string): void {
	currentState = {
		...currentState,
		goalComplete: true,
		completionReason: reason,
	};
	notifyListeners();
}

/**
 * Clear all state (for new session)
 */
export function clearState(): void {
	currentState = {
		goal: '',
		todos: [],
		goalComplete: false,
	};
	notifyListeners();
}

/**
 * Get summary stats
 */
export function getStats(): {
	total: number;
	pending: number;
	inProgress: number;
	completed: number;
	failed: number;
} {
	const todos = currentState.todos;
	return {
		total: todos.length,
		pending: todos.filter(t => t.status === 'pending').length,
		inProgress: todos.filter(t => t.status === 'in_progress').length,
		completed: todos.filter(t => t.status === 'completed').length,
		failed: todos.filter(t => t.status === 'failed').length,
	};
}
