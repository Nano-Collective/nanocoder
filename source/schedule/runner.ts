import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {Cron} from 'croner';
import {parseCommandFile} from '@/custom-commands/parser';
import {
	addScheduleRun,
	generateScheduleId,
	loadSchedules,
	saveSchedules,
	updateScheduleRun,
} from './storage';
import type {Schedule, ScheduleRun} from './types';

export interface ScheduleRunnerCallbacks {
	handleMessageSubmit: (message: string) => Promise<void>;
	clearMessages: () => Promise<void>;
	onJobStart: (schedule: Schedule) => void;
	onJobComplete: (schedule: Schedule, run: ScheduleRun) => void;
	onJobError: (schedule: Schedule, error: string) => void;
	waitForConversationComplete: () => Promise<void>;
}

export class ScheduleRunner {
	private cronJobs: Map<string, Cron> = new Map();
	private queue: Schedule[] = [];
	private isRunning = false;
	private isProcessing = false;
	private callbacks: ScheduleRunnerCallbacks;

	constructor(callbacks: ScheduleRunnerCallbacks) {
		this.callbacks = callbacks;
	}

	/**
	 * Start all scheduled cron jobs
	 */
	async start(): Promise<void> {
		if (this.isRunning) return;
		this.isRunning = true;

		const schedules = await loadSchedules();
		const enabledSchedules = schedules.filter(s => s.enabled);

		for (const schedule of enabledSchedules) {
			this.registerCronJob(schedule);
		}
	}

	/**
	 * Stop all cron jobs and clear the queue
	 */
	stop(): void {
		this.isRunning = false;
		for (const [, job] of this.cronJobs) {
			job.stop();
		}
		this.cronJobs.clear();
		this.queue = [];
	}

	/**
	 * Get the number of active cron jobs
	 */
	getActiveJobCount(): number {
		return this.cronJobs.size;
	}

	/**
	 * Get the current queue length
	 */
	getQueueLength(): number {
		return this.queue.length;
	}

	/**
	 * Check if currently processing a job
	 */
	getIsProcessing(): boolean {
		return this.isProcessing;
	}

	private registerCronJob(schedule: Schedule): void {
		const job = new Cron(schedule.cron, () => {
			this.enqueueJob(schedule);
		});
		this.cronJobs.set(schedule.id, job);
	}

	private enqueueJob(schedule: Schedule): void {
		// Don't duplicate — if this schedule is already queued, skip
		if (this.queue.some(s => s.id === schedule.id)) return;
		this.queue.push(schedule);
		void this.processQueue();
	}

	private async processQueue(): Promise<void> {
		if (this.isProcessing || this.queue.length === 0) return;
		this.isProcessing = true;

		while (this.queue.length > 0 && this.isRunning) {
			const schedule = this.queue.shift();
			if (schedule) {
				await this.executeJob(schedule);
			}
		}

		this.isProcessing = false;
	}

	private async executeJob(schedule: Schedule): Promise<void> {
		const run: ScheduleRun = {
			id: `run-${generateScheduleId()}`,
			scheduleId: schedule.id,
			command: schedule.command,
			startedAt: new Date().toISOString(),
			completedAt: null,
			status: 'running',
		};

		await addScheduleRun(run);
		this.callbacks.onJobStart(schedule);

		try {
			// Clear messages for fresh context
			await this.callbacks.clearMessages();

			// Load the schedule file from .nanocoder/schedules/
			const filePath = join(
				process.cwd(),
				'.nanocoder',
				'schedules',
				schedule.command,
			);

			if (!existsSync(filePath)) {
				throw new Error(
					`Schedule file not found: ${schedule.command}. Ensure it exists in .nanocoder/schedules/`,
				);
			}

			const parsed = parseCommandFile(filePath);
			const prompt = `[Executing scheduled command: ${schedule.command}]\n\n${parsed.content}`;
			await this.callbacks.handleMessageSubmit(prompt);

			// Wait for the conversation to complete
			await this.callbacks.waitForConversationComplete();

			// Update run status
			run.completedAt = new Date().toISOString();
			run.status = 'success';
			await updateScheduleRun(run.id, {
				completedAt: run.completedAt,
				status: 'success',
			});

			// Update lastRunAt on the schedule
			const schedules = await loadSchedules();
			const idx = schedules.findIndex(s => s.id === schedule.id);
			if (idx !== -1 && schedules[idx]) {
				schedules[idx].lastRunAt = run.completedAt;
				await saveSchedules(schedules);
			}

			this.callbacks.onJobComplete(schedule, run);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			run.completedAt = new Date().toISOString();
			run.status = 'error';
			run.error = errorMsg;
			await updateScheduleRun(run.id, {
				completedAt: run.completedAt,
				status: 'error',
				error: errorMsg,
			});

			this.callbacks.onJobError(schedule, errorMsg);
		}
	}
}
