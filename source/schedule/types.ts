export interface Schedule {
	id: string;
	cron: string;
	command: string;
	enabled: boolean;
	createdAt: string;
	lastRunAt: string | null;
}

export interface ScheduleRun {
	id: string;
	scheduleId: string;
	command: string;
	startedAt: string;
	completedAt: string | null;
	status: 'running' | 'success' | 'error';
	error?: string;
}

export interface SchedulesData {
	schedules: Schedule[];
}

export interface ScheduleRunsData {
	runs: ScheduleRun[];
}
