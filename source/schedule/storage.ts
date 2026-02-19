import {randomUUID} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {
	Schedule,
	ScheduleRun,
	ScheduleRunsData,
	SchedulesData,
} from './types';

const SCHEDULES_DIR = '.nanocoder';
const SCHEDULES_FILE = 'schedules.json';
const SCHEDULE_RUNS_FILE = 'schedule-runs.json';
const MAX_RUNS = 100;

function getSchedulesPath(): string {
	return join(process.cwd(), SCHEDULES_DIR, SCHEDULES_FILE);
}

function getScheduleRunsPath(): string {
	return join(process.cwd(), SCHEDULES_DIR, SCHEDULE_RUNS_FILE);
}

export function generateScheduleId(): string {
	return randomUUID().slice(0, 8);
}

export async function loadSchedules(): Promise<Schedule[]> {
	try {
		const path = getSchedulesPath();
		const content = await readFile(path, 'utf-8');
		const data = JSON.parse(content) as SchedulesData;
		return data.schedules ?? [];
	} catch {
		return [];
	}
}

export async function saveSchedules(schedules: Schedule[]): Promise<void> {
	const dirPath = join(process.cwd(), SCHEDULES_DIR);
	await mkdir(dirPath, {recursive: true});
	const path = getSchedulesPath();
	const data: SchedulesData = {schedules};
	await writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
}

export async function loadScheduleRuns(): Promise<ScheduleRun[]> {
	try {
		const path = getScheduleRunsPath();
		const content = await readFile(path, 'utf-8');
		const data = JSON.parse(content) as ScheduleRunsData;
		return data.runs ?? [];
	} catch {
		return [];
	}
}

export async function saveScheduleRuns(runs: ScheduleRun[]): Promise<void> {
	const dirPath = join(process.cwd(), SCHEDULES_DIR);
	await mkdir(dirPath, {recursive: true});
	const path = getScheduleRunsPath();
	// Cap at MAX_RUNS entries
	const cappedRuns = runs.slice(-MAX_RUNS);
	const data: ScheduleRunsData = {runs: cappedRuns};
	await writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
}

export async function addScheduleRun(run: ScheduleRun): Promise<void> {
	const runs = await loadScheduleRuns();
	runs.push(run);
	await saveScheduleRuns(runs);
}

export async function updateScheduleRun(
	runId: string,
	updates: Partial<Pick<ScheduleRun, 'completedAt' | 'status' | 'error'>>,
): Promise<void> {
	const runs = await loadScheduleRuns();
	const index = runs.findIndex(r => r.id === runId);
	if (index !== -1) {
		runs[index] = {...runs[index], ...updates};
		await saveScheduleRuns(runs);
	}
}
