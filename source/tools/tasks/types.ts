export type TaskStatus = 'pending' | 'in_progress' | 'completed';

export interface Task {
	id: string;
	title: string;
	description?: string;
	status: TaskStatus;
	createdAt: string;
	updatedAt: string;
	completedAt?: string;
}
