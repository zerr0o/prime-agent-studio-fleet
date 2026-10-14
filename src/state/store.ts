// Application state (zustand vanilla store, usable from React and from Node tests).
import { createStore } from 'zustand/vanilla';

import type { MessageItem, Model, Project, Run } from '../api/types';
import type { Language } from '../domain/instructions';
import type {
  FleetProject,
  MachineConfig,
  MachineRuntime,
  Pipeline,
  RoadmapCopy,
} from '../domain/types';

/** A message for the person, translated at render time. */
export type Notice = { key: string; params?: Record<string, string | number> };

export type ToolTrace = { id: string; name: string; status: 'running' | 'done' | 'error'; at: number };

export type RunLive = {
  key: string; // `${machineKey}:${runId}`
  machineKey: string;
  run: Run;
  projectKey?: string;
  nodeId?: string; // pipeline node started by Prime Fleet
  text: string; // assistant text being streamed
  messages: MessageItem[]; // finished messages seen in the stream (last ones)
  tools: ToolTrace[];
  statusNote?: string; // e.g. provider retry message
  lastSeq: number;
  watching: boolean;
  streamError?: Notice;
  seenAt: number;
};

export type ActivityItem = {
  id: string;
  at: number;
  tone: 'info' | 'success' | 'warning' | 'error';
  notice: Notice;
  projectKey?: string;
  machineKey?: string;
  runKey?: string;
};

export type SyncJob = {
  running: boolean;
  phase?: 'send' | 'receive' | 'read';
  machineKey?: string;
  startedAt: number;
  endedAt?: number;
  warnings: Notice[];
  error?: Notice;
};

export type Prefs = {
  theme: 'dark' | 'light' | 'system';
  language: Language | 'system';
};

export type FleetState = {
  hydrated: boolean;
  machines: MachineConfig[];
  tokens: Record<string, string>; // machineKey -> token (memory; persisted in secure storage)
  runtimes: Record<string, MachineRuntime>;
  projectLists: Record<string, Project[]>; // machineKey -> projects
  projects: FleetProject[];
  copies: Record<string, Record<string, RoadmapCopy>>; // projectKey -> machineKey -> copy
  copyErrors: Record<string, Record<string, Notice>>;
  runs: Record<string, RunLive>;
  pipelines: Record<string, Pipeline>;
  syncJobs: Record<string, SyncJob>;
  launches: Record<string, { at: number; error?: Notice }>; // `${projectKey}|${nodeId}` -> last launch attempt
  models: Record<string, Model[]>; // machineKey -> catalog
  sessionTitles: Record<string, string>; // sessionId -> title
  activity: ActivityItem[];
  prefs: Prefs;
};

export const initialState = (): FleetState => ({
  hydrated: false,
  machines: [],
  tokens: {},
  runtimes: {},
  projectLists: {},
  projects: [],
  copies: {},
  copyErrors: {},
  runs: {},
  pipelines: {},
  syncJobs: {},
  launches: {},
  models: {},
  sessionTitles: {},
  activity: [],
  prefs: { theme: 'dark', language: 'system' },
});

export const createFleetStore = () => createStore<FleetState>()(() => initialState());
export type FleetStore = ReturnType<typeof createFleetStore>;

export const runKeyOf = (machineKey: string, runId: string) => `${machineKey}:${runId}`;

// ---------- Selectors ----------

export const machineByKey = (state: FleetState, key: string) => state.machines.find((machine) => machine.key === key);

export const machineKeyById = (state: FleetState, machineId: string | null | undefined) =>
  machineId ? state.machines.find((machine) => (machine.machineId ?? state.runtimes[machine.key]?.info?.machineId) === machineId)?.key : undefined;

export const machineLabel = (state: FleetState, machineId: string | null | undefined) => {
  const key = machineKeyById(state, machineId);
  return key ? machineByKey(state, key)?.label ?? '' : '';
};

export const projectByKey = (state: FleetState, key: string) => state.projects.find((project) => project.key === key);

export function projectKeyForRun(state: FleetState, machineKey: string, projectId: string) {
  return state.projects.find((project) =>
    project.members.some((member) => member.machineKey === machineKey && member.projectId === projectId),
  )?.key;
}

export const activeRunsOf = (state: FleetState, projectKey: string): Run[] =>
  Object.values(state.runs)
    .filter((live) => live.projectKey === projectKey && (live.run.status === 'running' || live.run.status === 'stopping'))
    .map((live) => live.run);

export const pendingQuestions = (state: FleetState) =>
  Object.values(state.runs).flatMap((live) =>
    (live.run.interactions ?? [])
      .filter((interaction) => interaction.status === 'pending')
      .map((interaction) => ({ live, interaction })),
  );
