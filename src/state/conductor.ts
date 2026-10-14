// The conductor: polls the machines, follows runs (SSE), runs the end-of-run sync and
// starts the next pipeline tasks. No React Native import: it also runs in Node tests.
import { StudioClient } from '../api/client';
import { ApiError, isApiError } from '../api/errors';
import { isRunActive, type InteractionResponse, type MessageItem, type Run, type RunEvent, type RoadmapDocument } from '../api/types';
import { groupProjects, memberOn, type MachineProjects } from '../domain/fleet';
import { composeInstructions, DEFAULT_GIT_TEXT, type Language } from '../domain/instructions';
import * as pl from '../domain/pipeline';
import { fingerprint, taskInfo } from '../domain/roadmap';
import { copyFrom, memberStatuses } from '../domain/syncStatus';
import type { FleetProject, MachineConfig, MachineRuntime, Pipeline, PipelineNode, RoadmapCopy, TaskRef } from '../domain/types';
import {
  activeRunsOf,
  machineByKey,
  machineKeyById,
  projectByKey,
  projectKeyForRun,
  runKeyOf,
  type ActivityItem,
  type FleetState,
  type FleetStore,
  type Notice,
  type RunLive,
} from './store';

export type ConductorOptions = {
  store: FleetStore;
  createClient(machine: MachineConfig, token: string): StudioClient;
  language(): Language;
  now?: () => number;
  intervals?: Partial<{ tick: number; machines: number; projects: number; roadmaps: number }>;
};

const MAX_TEXT = 24_000;
const MAX_MESSAGES = 40;
const MAX_TOOLS = 60;
const MAX_ACTIVITY = 200;

/** Same message seen in the persisted history and in the live stream: keep one, in order. */
const messageKey = (message: MessageItem) =>
  message.id ?? `${message.role ?? ''}|${message.timestamp ?? ''}|${(message.text ?? '').slice(0, 80)}`;

export function mergeMessages(base: MessageItem[], extra: MessageItem[]): MessageItem[] {
  const out = [...base];
  const index = new Map(out.map((message, i) => [messageKey(message), i]));
  for (const message of extra) {
    const key = messageKey(message);
    const at = index.get(key);
    if (at === undefined) {
      index.set(key, out.length);
      out.push(message);
    } else out[at] = message;
  }
  return out.slice(-MAX_MESSAGES);
}

let sequence = 0;
const uid = () => `${Date.now().toString(36)}-${(sequence++).toString(36)}`;

export class Conductor {
  private readonly store: FleetStore;
  private readonly options: ConductorOptions;
  private readonly now: () => number;
  private readonly intervals: { tick: number; machines: number; projects: number; roadmaps: number };
  private clients = new Map<string, { client: StudioClient; baseUrl: string; token: string }>();
  private watchers = new Map<string, AbortController>();
  private syncQueues = new Map<string, Promise<unknown>>();
  private launching = new Set<string>();
  private endHandled = new Set<string>(); // end-of-run sequence done (this session)
  private seenActive = new Set<string>(); // runs seen running during this session
  private textBuffer = new Map<string, string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private due = { machines: 0, projects: 0, roadmaps: 0 };
  private focus: string | null = null;
  private stopped = true;

  constructor(options: ConductorOptions) {
    this.options = options;
    this.store = options.store;
    this.now = options.now ?? Date.now;
    this.intervals = { tick: 5_000, machines: 20_000, projects: 60_000, roadmaps: 45_000, ...options.intervals };
  }

  // ---------- state helpers ----------

  private get state(): FleetState {
    return this.store.getState();
  }
  private set(patch: Partial<FleetState> | ((state: FleetState) => Partial<FleetState>)) {
    this.store.setState(patch as never);
  }

  log(tone: ActivityItem['tone'], notice: Notice, refs: Omit<ActivityItem, 'id' | 'at' | 'tone' | 'notice'> = {}) {
    const item: ActivityItem = { id: uid(), at: this.now(), tone, notice, ...refs };
    this.set((state) => ({ activity: [item, ...state.activity].slice(0, MAX_ACTIVITY) }));
  }

  clientFor(machineKey: string): StudioClient | null {
    const machine = machineByKey(this.state, machineKey);
    const token = this.state.tokens[machineKey];
    if (!machine || !token) return null;
    const cached = this.clients.get(machineKey);
    if (cached && cached.baseUrl === machine.baseUrl && cached.token === token) return cached.client;
    const client = this.options.createClient(machine, token);
    this.clients.set(machineKey, { client, baseUrl: machine.baseUrl, token });
    return client;
  }

  private setRuntime(machineKey: string, patch: Partial<MachineRuntime>) {
    this.set((state) => ({
      runtimes: { ...state.runtimes, [machineKey]: { ...(state.runtimes[machineKey] ?? { state: 'unknown' }), ...patch } },
    }));
  }

  private runtimeError(machineKey: string, error: unknown) {
    const now = this.now();
    if (!isApiError(error)) return this.setRuntime(machineKey, { state: 'error', checkedAt: now, error: 'error.unknown' });
    if (error.offline) return this.setRuntime(machineKey, { state: 'offline', checkedAt: now, error: 'error.offline' });
    if (error.status === 401) return this.setRuntime(machineKey, { state: 'unauthorized', checkedAt: now, error: 'error.unauthorized' });
    if (error.status === 404 && error.code === 'api_disabled')
      return this.setRuntime(machineKey, { state: 'disabled', checkedAt: now, error: 'error.apiDisabled' });
    if (error.status === 403)
      return this.setRuntime(machineKey, {
        state: 'forbidden',
        checkedAt: now,
        error: error.code === 'api_requires_encrypted_transport' ? 'error.needsEncryptedTransport' : 'error.forbidden',
      });
    return this.setRuntime(machineKey, { state: 'error', checkedAt: now, error: 'error.unknown' });
  }

  private noteScope(machineKey: string, error: unknown, scope: string) {
    if (isApiError(error) && error.status === 403 && error.code === 'insufficient_scope') {
      const runtime = this.state.runtimes[machineKey];
      const missing = new Set(runtime?.missingScopes ?? []);
      missing.add(scope);
      this.setRuntime(machineKey, { missingScopes: [...missing] });
      return true;
    }
    return false;
  }

  // ---------- lifecycle ----------

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    void this.refreshAll();
    this.ticker = setInterval(() => void this.tick(), this.intervals.tick);
  }

  stop() {
    this.stopped = true;
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    for (const controller of this.watchers.values()) controller.abort();
    this.watchers.clear();
  }

  setFocus(projectKey: string | null) {
    this.focus = projectKey;
    if (projectKey) void this.refreshRoadmaps(projectKey);
  }

  private ticking = false;
  private async tick() {
    if (this.ticking) return; // a slow machine must not stack refresh rounds
    this.ticking = true;
    try {
      await this.tickOnce();
    } finally {
      this.ticking = false;
    }
  }

  private async tickOnce() {
    const now = this.now();
    if (now >= this.due.machines) {
      this.due.machines = now + this.intervals.machines;
      await Promise.all(this.state.machines.map((machine) => this.refreshMachine(machine.key)));
    }
    if (now >= this.due.projects) {
      this.due.projects = now + this.intervals.projects;
      await this.refreshProjects();
    }
    if (now >= this.due.roadmaps) {
      this.due.roadmaps = now + this.intervals.roadmaps;
      this.roadmapRound++;
      const keys = new Set(Object.keys(this.state.pipelines).filter((key) => this.state.pipelines[key].nodes.length));
      if (this.focus) keys.add(this.focus);
      // Other shared projects (sync status in the sidebar) refresh every third round.
      if (this.roadmapRound % 3 === 1)
        for (const project of this.state.projects) if (project.syncId && project.members.length > 1) keys.add(project.key);
      await Promise.all([...keys].map((key) => this.refreshRoadmaps(key)));
    }
  }
  private roadmapRound = 0;

  async refreshAll() {
    await Promise.all(this.state.machines.map((machine) => this.refreshMachine(machine.key)));
    await this.refreshProjects();
    const now = this.now();
    this.due = { machines: now + this.intervals.machines, projects: now + this.intervals.projects, roadmaps: now + this.intervals.roadmaps };
    const keys = new Set(Object.keys(this.state.pipelines));
    if (this.focus) keys.add(this.focus);
    for (const project of this.state.projects) if (project.syncId && project.members.length > 1) keys.add(project.key);
    await Promise.all([...keys].map((key) => this.refreshRoadmaps(key)));
  }

  // ---------- machines ----------

  async refreshMachine(machineKey: string) {
    const client = this.clientFor(machineKey);
    if (!client) return this.setRuntime(machineKey, { state: 'unauthorized', error: 'error.noToken' });
    const before = this.state.runtimes[machineKey]?.state;
    if (!before || before === 'unknown') this.setRuntime(machineKey, { state: 'connecting' });
    try {
      const info = await client.machine();
      if (info.apiVersion !== 'v1') return this.setRuntime(machineKey, { state: 'incompatible', info, error: 'error.incompatible' });
      const now = this.now();
      this.setRuntime(machineKey, { state: 'online', info, checkedAt: now, lastSeenAt: now, error: undefined });
      const machine = machineByKey(this.state, machineKey);
      if (machine && machine.machineId !== info.machineId)
        this.set((state) => ({ machines: state.machines.map((entry) => (entry.key === machineKey ? { ...entry, machineId: info.machineId } : entry)) }));
      try {
        this.setRuntime(machineKey, { sync: await client.syncState() });
      } catch {
        /* sync state is optional */
      }
      await this.refreshRuns(machineKey);
      if (before && before !== 'online') this.due.projects = 0; // a machine came back: regroup soon
    } catch (error) {
      this.runtimeError(machineKey, error);
    }
  }

  /** Checks an address and a token before saving a machine. */
  async probe(baseUrl: string, token: string) {
    const client = this.options.createClient({ key: 'probe', label: '', baseUrl, color: '', addedAt: 0 }, token);
    const info = await client.machine();
    if (info.apiVersion !== 'v1') throw new ApiError('http', 'Incompatible Studio', { code: 'incompatible' });
    return info;
  }

  addMachine(config: Omit<MachineConfig, 'key' | 'addedAt'>, token: string) {
    const key = uid();
    const machine: MachineConfig = { ...config, key, addedAt: this.now() };
    this.set((state) => ({ machines: [...state.machines, machine], tokens: { ...state.tokens, [key]: token } }));
    void this.refreshMachine(key).then(() => this.refreshProjects());
    return key;
  }

  updateMachine(key: string, patch: Partial<Omit<MachineConfig, 'key'>>, token?: string) {
    this.set((state) => ({
      machines: state.machines.map((machine) => (machine.key === key ? { ...machine, ...patch } : machine)),
      tokens: token ? { ...state.tokens, [key]: token } : state.tokens,
    }));
    this.clients.delete(key);
    void this.refreshMachine(key).then(() => this.refreshProjects());
  }

  removeMachine(key: string) {
    for (const [runKey, controller] of this.watchers) if (runKey.startsWith(`${key}:`)) controller.abort();
    this.clients.delete(key);
    this.set((state) => {
      const { [key]: _token, ...tokens } = state.tokens;
      const { [key]: _runtime, ...runtimes } = state.runtimes;
      const { [key]: _projects, ...projectLists } = state.projectLists;
      const runs = Object.fromEntries(Object.entries(state.runs).filter(([, live]) => live.machineKey !== key));
      return { machines: state.machines.filter((machine) => machine.key !== key), tokens, runtimes, projectLists, runs };
    });
    this.regroup();
  }

  // ---------- projects and Roadmaps ----------

  async refreshProjects() {
    await Promise.all(
      this.state.machines.map(async (machine) => {
        if (this.state.runtimes[machine.key]?.state !== 'online') return;
        const client = this.clientFor(machine.key);
        if (!client) return;
        try {
          const projects = await client.projects();
          this.set((state) => ({ projectLists: { ...state.projectLists, [machine.key]: projects } }));
        } catch (error) {
          this.runtimeError(machine.key, error);
        }
      }),
    );
    this.regroup();
  }

  private regroup() {
    const state = this.state;
    const lists: MachineProjects[] = [];
    for (const machine of state.machines) {
      const machineId = machine.machineId ?? state.runtimes[machine.key]?.info?.machineId;
      const projects = state.projectLists[machine.key];
      if (machineId && projects) lists.push({ machine, machineId, projects });
    }
    const projects = groupProjects(lists);
    const runs = { ...state.runs };
    for (const [key, live] of Object.entries(runs))
      if (!live.projectKey) {
        const projectKey = projectKeyForRun({ ...state, projects }, live.machineKey, live.run.projectId);
        if (projectKey) runs[key] = { ...live, projectKey, nodeId: live.nodeId ?? this.nodeForRequest(projectKey, live.run.requestId) };
      }
    this.set({ projects, runs });
    for (const key of Object.keys(runs)) if (this.endPending(key) && !this.watchers.has(key)) void this.onRunEnded(key);
  }

  async refreshRoadmaps(projectKey: string) {
    const project = projectByKey(this.state, projectKey);
    if (!project) return;
    await Promise.all(project.members.map((member) => this.readCopy(projectKey, member.machineKey, member.projectId)));
  }

  private async readCopy(projectKey: string, machineKey: string, projectId: string): Promise<RoadmapCopy | undefined> {
    if (this.state.runtimes[machineKey]?.state !== 'online') return undefined;
    const client = this.clientFor(machineKey);
    if (!client) return undefined;
    try {
      const envelope = await client.roadmap(projectId);
      return this.storeCopy(projectKey, machineKey, projectId, envelope.roadmap);
    } catch (error) {
      if (isApiError(error) && error.offline) this.runtimeError(machineKey, error);
      this.set((state) => ({
        copyErrors: { ...state.copyErrors, [projectKey]: { ...state.copyErrors[projectKey], [machineKey]: { key: 'error.roadmapRead' } } },
      }));
      return undefined;
    }
  }

  private storeCopy(projectKey: string, machineKey: string, projectId: string, doc: RoadmapDocument) {
    const copy = copyFrom(machineKey, projectId, doc, fingerprint(doc), this.now());
    this.set((state) => {
      const errors = { ...state.copyErrors[projectKey] };
      delete errors[machineKey];
      return {
        copies: { ...state.copies, [projectKey]: { ...state.copies[projectKey], [machineKey]: copy } },
        copyErrors: { ...state.copyErrors, [projectKey]: errors },
      };
    });
    this.noteDoneTasks(projectKey);
    return copy;
  }

  /** Reads a task the way the pipeline does (machines without R2 sync kept apart). */
  private readTask(projectKey: string, ref: TaskRef) {
    const project = projectByKey(this.state, projectKey);
    const isolated = project ? pl.isolatedCopies(project, this.state.runtimes) : new Set<string>();
    return pl.readTask(ref, this.state.copies[projectKey] ?? {}, isolated);
  }

  /** Remembers that a task was done after its last run, so a later uncheck reads "reopened", not "to review". */
  private noteDoneTasks(projectKey: string) {
    const pipeline = this.state.pipelines[projectKey];
    if (!pipeline) return;
    let next = pipeline;
    for (const node of pipeline.nodes) {
      const run = node.lastRun;
      if (!run || run.seenDone || isRunActive(run.status)) continue;
      if (this.readTask(projectKey, node.ref).task.done) next = pl.updateNode(next, node.id, { lastRun: { ...run, seenDone: true } }, this.now());
    }
    if (next !== pipeline) this.setPipeline(projectKey, next);
  }

  // ---------- sync ----------

  /** Serialized per project: a second request waits for the first one, then runs. */
  syncProject(projectKey: string, options: { originMachineKey?: string; sessionId?: string | null } = {}) {
    const previous = this.syncQueues.get(projectKey) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => this.runSync(projectKey, options));
    this.syncQueues.set(projectKey, next);
    return next;
  }

  private async runSync(projectKey: string, options: { originMachineKey?: string; sessionId?: string | null }) {
    const project = projectByKey(this.state, projectKey);
    if (!project) return;
    const warnings: Notice[] = [];
    const startedAt = this.now();
    const setJob = (patch: Partial<NonNullable<FleetState['syncJobs'][string]>>) =>
      this.set((state) => ({
        syncJobs: { ...state.syncJobs, [projectKey]: { ...(state.syncJobs[projectKey] ?? { running: true, startedAt, warnings: [] }), ...patch } },
      }));
    setJob({ running: true, startedAt, endedAt: undefined, warnings: [], error: undefined });
    const online = project.members.filter((member) => this.state.runtimes[member.machineKey]?.state === 'online');
    if (project.syncId && online.length) {
      const statuses = memberStatuses(project, this.state.copies[projectKey] ?? {}, this.state.runtimes);
      const rank = (key: string) => (key === options.originMachineKey ? 0 : statuses[key] === 'latest' ? 1 : statuses[key] === 'diverged' ? 2 : 3);
      const order = [...online].sort((a, b) => rank(a.machineKey) - rank(b.machineKey));
      for (const member of order) {
        setJob({ phase: member.machineKey === options.originMachineKey ? 'send' : 'receive', machineKey: member.machineKey });
        await this.syncOne(member.machineKey, member.projectId, member.machineKey === options.originMachineKey ? options.sessionId : null, warnings);
      }
      setJob({ phase: 'read', machineKey: undefined });
      await this.refreshRoadmaps(projectKey);
      // Second pass for machines still behind (they may have sent changes the others missed).
      const after = memberStatuses(project, this.state.copies[projectKey] ?? {}, this.state.runtimes);
      const behind = online.filter((member) => after[member.machineKey] === 'behind' || after[member.machineKey] === 'diverged');
      if (behind.length) {
        for (const member of [...online.filter((m) => !behind.includes(m)), ...behind]) {
          setJob({ phase: 'receive', machineKey: member.machineKey });
          await this.syncOne(member.machineKey, member.projectId, null, warnings);
        }
        setJob({ phase: 'read', machineKey: undefined });
        await this.refreshRoadmaps(projectKey);
      }
    } else {
      setJob({ phase: 'read' });
      await this.refreshRoadmaps(projectKey);
    }
    const unique = warnings.filter((warning, index) => warnings.findIndex((w) => JSON.stringify(w) === JSON.stringify(warning)) === index);
    setJob({ running: false, phase: undefined, machineKey: undefined, endedAt: this.now(), warnings: unique });
    for (const warning of unique) this.log('warning', warning, { projectKey });
  }

  private async syncOne(machineKey: string, projectId: string, sessionId: string | null | undefined, warnings: Notice[]) {
    const client = this.clientFor(machineKey);
    const label = machineByKey(this.state, machineKey)?.label ?? '';
    if (!client) return;
    try {
      await client.syncProject(projectId);
    } catch (error) {
      if (!isApiError(error)) return warnings.push({ key: 'sync.failed', params: { machine: label } });
      if (error.offline) {
        this.runtimeError(machineKey, error);
        return warnings.push({ key: 'sync.machineOffline', params: { machine: label } });
      }
      if (error.status === 403 && error.code === 'insufficient_scope') {
        warnings.push({ key: 'sync.tokenScope', params: { machine: label } });
        this.noteScope(machineKey, error, 'sync:write');
        if (sessionId)
          try {
            await client.syncProject(projectId, sessionId);
          } catch {}
        return;
      }
      if (error.status === 403) return warnings.push({ key: 'sync.tokenProjects', params: { machine: label } });
      if (error.code === 'sync_not_configured') return warnings.push({ key: 'sync.notConfigured', params: { machine: label } });
      if (error.code === 'sync_disabled') return warnings.push({ key: 'sync.disabled', params: { machine: label } });
      warnings.push({ key: 'sync.failed', params: { machine: label } });
    }
  }

  // ---------- runs ----------

  private nodeForRequest(projectKey: string, requestId: string | undefined) {
    if (!requestId?.startsWith('pf-')) return undefined;
    const pipeline = this.state.pipelines[projectKey];
    return pipeline?.nodes.find((node) => requestId.startsWith(pl.requestPrefix(projectKey, node.id, node.attempt)))?.id;
  }

  async refreshRuns(machineKey: string) {
    const client = this.clientFor(machineKey);
    if (!client) return;
    let runs: Run[];
    try {
      runs = await client.runs();
    } catch (error) {
      if (isApiError(error) && error.offline) this.runtimeError(machineKey, error);
      return;
    }
    const listed = new Set<string>();
    for (const run of runs) {
      const key = runKeyOf(machineKey, run.id);
      listed.add(key);
      this.upsertRun(machineKey, run);
      if (isRunActive(run.status)) this.watchRun(machineKey, run.id);
      else if (this.endPending(key) && !this.watchers.has(key)) void this.onRunEnded(key);
    }
    // Runs we follow that are no longer listed (expired): confirm their end.
    for (const live of Object.values(this.state.runs))
      if (live.machineKey === machineKey && !listed.has(live.key) && isRunActive(live.run.status) && !this.watchers.has(live.key))
        void this.confirmEnd(live.key);
  }

  /**
   * True when the end of this run still has to be handled: it was seen running in this
   * session, or it is the last run of a pipeline node whose end was never processed
   * (the app was closed while it ran).
   */
  private endPending(key: string) {
    if (this.endHandled.has(key)) return false;
    const live = this.state.runs[key];
    if (!live || isRunActive(live.run.status)) return false;
    if (this.seenActive.has(key)) return true;
    if (!live.projectKey || !live.nodeId) return false;
    const node = this.state.pipelines[live.projectKey]?.nodes.find((entry) => entry.id === live.nodeId);
    return node?.lastRun?.runId === live.run.id && node.lastRun.checked === undefined;
  }

  private upsertRun(machineKey: string, run: Run, extra: Partial<RunLive> = {}) {
    const key = runKeyOf(machineKey, run.id);
    this.set((state) => {
      const existing = state.runs[key];
      const projectKey = existing?.projectKey ?? projectKeyForRun(state, machineKey, run.projectId);
      const nodeId = existing?.nodeId ?? (projectKey ? this.nodeForRequest(projectKey, run.requestId) : undefined);
      const live: RunLive = existing
        ? { ...existing, run: { ...existing.run, ...run }, projectKey, nodeId, ...extra }
        : {
            key,
            machineKey,
            run,
            projectKey,
            nodeId,
            text: '',
            messages: [],
            tools: [],
            lastSeq: 0,
            watching: false,
            seenAt: this.now(),
            ...extra,
          };
      return { runs: { ...state.runs, [key]: live } };
    });
    if (isRunActive(run.status)) this.seenActive.add(key);
    this.syncNodeRun(key);
  }

  /** The run vanished from its Studio (expired or Studio restarted): its outcome is unknown. */
  private markLost(key: string) {
    const live = this.state.runs[key];
    if (live && isRunActive(live.run.status)) {
      this.patchRun(key, { run: { ...live.run, status: 'unknown', endedAt: new Date(this.now()).toISOString() } });
      this.syncNodeRun(key);
    }
  }

  /** Mirrors the run status on its pipeline node. */
  private syncNodeRun(runKey: string) {
    const live = this.state.runs[runKey];
    if (!live?.projectKey || !live.nodeId) return;
    const pipeline = this.state.pipelines[live.projectKey];
    const node = pipeline?.nodes.find((entry) => entry.id === live.nodeId);
    if (!pipeline || !node) return;
    // A run of an older attempt (the task was started again since) is history.
    const requestId = live.run.requestId;
    if (requestId?.startsWith('pf-') && !requestId.startsWith(pl.requestPrefix(live.projectKey, node.id, node.attempt))) return;
    const machineId = this.state.runtimes[live.machineKey]?.info?.machineId ?? live.run.machineId;
    const current = node.lastRun;
    if (current && current.runId !== live.run.id && current.startedAt > live.run.startedAt) return;
    const next = {
      machineId,
      runId: live.run.id,
      requestId: live.run.requestId ?? current?.requestId ?? '',
      sessionId: live.run.sessionId ?? current?.sessionId ?? null,
      status: live.run.status,
      startedAt: live.run.startedAt,
      endedAt: live.run.endedAt,
      error: live.run.error ?? null,
      checked: current?.runId === live.run.id ? current.checked : undefined,
      seenDone: current?.runId === live.run.id ? current.seenDone : undefined,
    };
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    this.setPipeline(live.projectKey, pl.updateNode(pipeline, node.id, { lastRun: next }, this.now()));
  }

  watchRun(machineKey: string, runId: string) {
    const key = runKeyOf(machineKey, runId);
    if (this.watchers.has(key) || this.stopped) return;
    const controller = new AbortController();
    this.watchers.set(key, controller);
    this.patchRun(key, { watching: true });
    void this.follow(key, machineKey, runId, controller.signal).finally(() => {
      if (this.watchers.get(key) === controller) this.watchers.delete(key);
      this.patchRun(key, { watching: false });
    });
  }

  private patchRun(key: string, patch: Partial<RunLive> | ((live: RunLive) => Partial<RunLive>)) {
    this.set((state) => {
      const live = state.runs[key];
      if (!live) return {};
      const value = typeof patch === 'function' ? patch(live) : patch;
      return { runs: { ...state.runs, [key]: { ...live, ...value } } };
    });
  }

  private async follow(key: string, machineKey: string, runId: string, signal: AbortSignal) {
    let backoff = 1000;
    for (;;) {
      const client = this.clientFor(machineKey);
      if (!client || signal.aborted) return;
      try {
        const after = this.state.runs[key]?.lastSeq ?? 0;
        await client.events(runId, {
          after,
          signal,
          onOpen: () => this.patchRun(key, { streamError: undefined }),
          onEvent: (event) => this.applyEvent(key, event),
        });
        this.flushText();
        backoff = 1000;
        const run = await client.run(runId);
        this.upsertRun(machineKey, run);
        if (!isRunActive(run.status)) break;
      } catch (error) {
        this.flushText();
        if (signal.aborted) return;
        if (isApiError(error) && error.status === 404) {
          this.markLost(key);
          break;
        }
        this.patchRun(key, { streamError: { key: isApiError(error) && error.offline ? 'run.streamOffline' : 'run.streamError' } });
        if (isApiError(error) && error.offline) this.runtimeError(machineKey, error);
        await new Promise((resolve) => setTimeout(resolve, backoff));
        backoff = Math.min(backoff * 2, 30_000);
      }
    }
    if (!signal.aborted) await this.onRunEnded(key);
  }

  private applyEvent(key: string, event: RunEvent) {
    const seq = Number(event.seq);
    if (event.kind === 'text' && typeof event.delta === 'string') {
      this.textBuffer.set(key, (this.textBuffer.get(key) ?? '') + event.delta);
      if (Number.isFinite(seq)) this.patchSeqLater(key, seq);
      this.scheduleFlush();
      return;
    }
    this.flushText();
    this.patchRun(key, (live) => {
      const patch: Partial<RunLive> = Number.isFinite(seq) && seq > live.lastSeq ? { lastSeq: seq } : {};
      const run = { ...live.run };
      switch (event.kind) {
        case 'session':
          if (event.sessionId) run.sessionId = event.sessionId;
          break;
        case 'message_start':
          if (event.role === 'assistant') patch.text = '';
          break;
        case 'message':
          if (event.message && typeof event.message === 'object') {
            patch.messages = mergeMessages(live.messages, [event.message]);
            if (event.message.role === 'assistant') patch.text = '';
          }
          break;
        case 'tool_start':
          patch.tools = [...live.tools, { id: event.id ?? uid(), name: event.name ?? 'tool', status: 'running' as const, at: this.now() }].slice(-MAX_TOOLS);
          break;
        case 'tool_end':
          patch.tools = live.tools.map((tool) => (tool.id === event.id ? { ...tool, status: event.isError ? ('error' as const) : ('done' as const) } : tool));
          break;
        case 'status':
          // Studio reports provider retries this way; other statuses are noise for the person.
          patch.statusNote = event.status === 'retrying' ? (typeof event.message === 'string' && event.message) || 'retrying' : undefined;
          break;
        case 'interaction':
          if (event.request?.id) {
            const list = [...(run.interactions ?? [])];
            const index = list.findIndex((item) => item.id === event.request!.id);
            if (index >= 0) list[index] = event.request;
            else list.push(event.request);
            run.interactions = list;
          }
          break;
        case 'done':
          run.status = event.status ?? 'completed';
          run.error = event.error ?? null;
          run.endedAt = run.endedAt ?? new Date(this.now()).toISOString();
          patch.statusNote = undefined;
          break;
      }
      return { ...patch, run };
    });
    if (event.kind === 'done' || event.kind === 'session') this.syncNodeRun(key);
  }

  private pendingSeq = new Map<string, number>();
  private patchSeqLater(key: string, seq: number) {
    this.pendingSeq.set(key, Math.max(seq, this.pendingSeq.get(key) ?? 0));
  }

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flushText(), 120);
  }

  private flushText() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (!this.textBuffer.size && !this.pendingSeq.size) return;
    const buffers = new Map(this.textBuffer);
    const seqs = new Map(this.pendingSeq);
    this.textBuffer.clear();
    this.pendingSeq.clear();
    this.set((state) => {
      const runs = { ...state.runs };
      for (const key of new Set([...buffers.keys(), ...seqs.keys()])) {
        const live = runs[key];
        if (!live) continue;
        const text = (live.text + (buffers.get(key) ?? '')).slice(-MAX_TEXT);
        runs[key] = { ...live, text, lastSeq: Math.max(live.lastSeq, seqs.get(key) ?? 0) };
      }
      return { runs };
    });
  }

  private async confirmEnd(key: string) {
    const live = this.state.runs[key];
    if (!live) return;
    const client = this.clientFor(live.machineKey);
    if (!client) return;
    try {
      const run = await client.run(live.run.id);
      this.upsertRun(live.machineKey, run);
      if (isRunActive(run.status)) return this.watchRun(live.machineKey, run.id);
    } catch (error) {
      if (!(isApiError(error) && error.status === 404)) return;
      this.markLost(key);
    }
    await this.onRunEnded(key);
  }

  /** End of a run: sync the machines of the project, read the Roadmaps, chain the pipeline. */
  async onRunEnded(key: string) {
    const live = this.state.runs[key];
    if (!live || this.endHandled.has(key) || isRunActive(live.run.status)) return;
    this.endHandled.add(key);
    this.syncNodeRun(key);
    const machine = machineByKey(this.state, live.machineKey);
    const status = live.run.status;
    this.log(status === 'completed' ? 'success' : status === 'stopped' ? 'info' : 'error', {
      key: status === 'completed' ? 'activity.runCompleted' : status === 'stopped' ? 'activity.runStopped' : 'activity.runFailed',
      params: { machine: machine?.label ?? '', title: this.runTitle(live) },
    }, { projectKey: live.projectKey, machineKey: live.machineKey, runKey: key });
    const projectKey = live.projectKey ?? projectKeyForRun(this.state, live.machineKey, live.run.projectId);
    if (!projectKey) return;
    await this.syncProject(projectKey, { originMachineKey: live.machineKey, sessionId: live.run.sessionId });
    this.markChecked(key);
    await this.evaluateProject(projectKey, { allowAuto: true });
  }

  private runTitle(live: RunLive) {
    if (live.projectKey && live.nodeId) {
      const node = this.state.pipelines[live.projectKey]?.nodes.find((entry) => entry.id === live.nodeId);
      if (node) return pl.readTask(node.ref, this.state.copies[live.projectKey] ?? {}).task.title;
    }
    return projectByKey(this.state, live.projectKey ?? '')?.name ?? '';
  }

  /** After the sync: was the step of this run checked? */
  private markChecked(key: string) {
    const live = this.state.runs[key];
    if (!live?.projectKey || !live.nodeId) return;
    const pipeline = this.state.pipelines[live.projectKey];
    const node = pipeline?.nodes.find((entry) => entry.id === live.nodeId);
    if (!pipeline || !node?.lastRun || node.lastRun.runId !== live.run.id) return;
    const checked = this.readTask(live.projectKey, node.ref).task.done;
    const lastRun = { ...node.lastRun, checked, ...(checked ? { seenDone: true } : {}) };
    this.setPipeline(live.projectKey, pl.updateNode(pipeline, node.id, { lastRun }, this.now()));
    if (!checked && live.run.status === 'completed')
      this.log('warning', { key: 'activity.notChecked', params: { title: this.runTitle(live) } }, { projectKey: live.projectKey, runKey: key });
  }

  async stopRun(key: string) {
    const live = this.state.runs[key];
    const client = live && this.clientFor(live.machineKey);
    if (!live || !client) return;
    const result = await client.stop(live.run.id);
    this.upsertRun(live.machineKey, { ...live.run, ...result, status: result.status ?? 'stopping' } as Run);
  }

  async answer(key: string, interactionId: string, response: InteractionResponse) {
    const live = this.state.runs[key];
    const client = live && this.clientFor(live.machineKey);
    if (!live || !client) return;
    await client.answer(live.run.id, interactionId, response);
    try {
      this.upsertRun(live.machineKey, await client.run(live.run.id));
    } catch {}
  }

  async sendMessage(key: string, message: string, mode: 'steer' | 'follow_up') {
    const live = this.state.runs[key];
    const client = live && this.clientFor(live.machineKey);
    if (!live?.run.sessionId || !client) return;
    await client.sendMessage(live.run.sessionId, { requestId: `pf-msg-${uid()}`.padEnd(16, '0'), mode, message });
  }

  // ---------- pipeline ----------

  pipelineFor(projectKey: string): Pipeline {
    return this.state.pipelines[projectKey] ?? pl.emptyPipeline(projectKey, DEFAULT_GIT_TEXT[this.options.language()], this.now());
  }

  setPipeline(projectKey: string, pipeline: Pipeline) {
    this.set((state) => ({ pipelines: { ...state.pipelines, [projectKey]: pipeline } }));
  }

  editPipeline(projectKey: string, edit: (pipeline: Pipeline, now: number) => Pipeline) {
    this.setPipeline(projectKey, edit(this.pipelineFor(projectKey), this.now()));
  }

  evaluation(projectKey: string) {
    const project = projectByKey(this.state, projectKey);
    const pipeline = this.state.pipelines[projectKey];
    if (!project || !pipeline) return null;
    return pl.evaluate({
      pipeline,
      project,
      copies: this.state.copies[projectKey] ?? {},
      runtimes: this.state.runtimes,
      activeRuns: activeRunsOf(this.state, projectKey),
    });
  }

  /** Starts the ready tasks when auto mode is on (or when forced by an explicit action). */
  async evaluateProject(projectKey: string, options: { allowAuto: boolean; force?: boolean }) {
    const pipeline = this.state.pipelines[projectKey];
    const evaluations = this.evaluation(projectKey);
    if (!pipeline || !evaluations) return [];
    // Never by itself: a task whose start failed, or a task that ran already and was reopened.
    const next = pl
      .nextToLaunch(pipeline, evaluations)
      .filter((node) => options.force || (!this.state.launches[`${projectKey}|${node.id}`]?.error && !evaluations[node.id].reopened));
    if (!next.length) return [];
    if (!(options.force || (options.allowAuto && pipeline.auto))) {
      for (const node of next)
        this.log('info', { key: 'activity.ready', params: { title: evaluations[node.id].task.title, machine: this.labelOf(node.machineId) } }, { projectKey });
      return [];
    }
    const started: string[] = [];
    for (const node of next) if (await this.launchNode(projectKey, node.id)) started.push(node.id);
    return started;
  }

  private labelOf(machineId: string | null | undefined) {
    const key = machineKeyById(this.state, machineId);
    return key ? machineByKey(this.state, key)?.label ?? '' : '';
  }

  private launchError(projectKey: string, node: PipelineNode, notice: Notice) {
    this.set((state) => ({ launches: { ...state.launches, [`${projectKey}|${node.id}`]: { at: this.now(), error: notice } } }));
    this.log('error', notice, { projectKey });
    return false;
  }

  /** Starts one task on its machine. Never moves it to another machine. */
  async launchNode(projectKey: string, nodeId: string): Promise<boolean> {
    const lockKey = `${projectKey}|${nodeId}`;
    if (this.launching.has(lockKey)) return false;
    this.launching.add(lockKey);
    try {
      return await this.launchOnce(projectKey, nodeId);
    } finally {
      this.launching.delete(lockKey);
    }
  }

  private async launchOnce(projectKey: string, nodeId: string): Promise<boolean> {
    const project = projectByKey(this.state, projectKey);
    let pipeline = this.state.pipelines[projectKey];
    let node = pipeline?.nodes.find((entry) => entry.id === nodeId);
    if (!project || !pipeline || !node) return false;
    const label = this.labelOf(node.machineId);
    const title = pl.readTask(node.ref, this.state.copies[projectKey] ?? {}).task.title;
    const member = memberOn(project, node.machineId);
    if (!member) return this.launchError(projectKey, node, { key: 'launch.notOnMachine', params: { title, machine: label } });
    const client = this.clientFor(member.machineKey);
    if (!client || this.state.runtimes[member.machineKey]?.state !== 'online')
      return this.launchError(projectKey, node, { key: 'launch.offline', params: { title, machine: label } });

    // Conversation to continue, read before a new attempt clears the last run of this task.
    const sourceId = pl.conversationSource(pipeline, node);
    const source = sourceId ? pipeline.nodes.find((entry) => entry.id === sourceId) : undefined;
    const sessionId = source?.lastRun?.sessionId ?? null;
    const sessionMachineId = source?.lastRun?.machineId ?? null;
    const sourceTitle = source ? pl.readTask(source.ref, this.state.copies[projectKey] ?? {}).task.title : '';
    if (source && !sessionId)
      this.log('info', { key: 'activity.noConversation', params: { title, from: sourceTitle, machine: label } }, { projectKey });

    // A task that ran already starts a new attempt: new request ids, the old run stays history.
    if (node.lastRun && !isRunActive(node.lastRun.status)) {
      this.setPipeline(projectKey, pl.updateNode(pipeline, node.id, { attempt: node.attempt + 1, lastRun: undefined }, this.now()));
      pipeline = this.state.pipelines[projectKey];
      node = pipeline.nodes.find((entry) => entry.id === nodeId)!;
    }
    const prefix = pl.requestPrefix(projectKey, node.id, node.attempt);
    let moved = false;

    for (let attempt = 0; attempt < 3; attempt++) {
      // 1. A run of this attempt may exist already (another device, lost answer).
      try {
        const existing = (await client.runs()).find((run) => run.requestId?.startsWith(prefix));
        if (existing) {
          this.adoptRun(projectKey, member.machineKey, node.id, existing);
          return true;
        }
      } catch (error) {
        if (isApiError(error) && error.offline) {
          this.runtimeError(member.machineKey, error);
          return this.launchError(projectKey, node, { key: 'launch.offline', params: { title, machine: label } });
        }
      }
      // 2. Read the Roadmap of the target machine and check the dependencies there.
      const copy = await this.readCopy(projectKey, member.machineKey, member.projectId);
      if (!copy) return this.launchError(projectKey, node, { key: 'launch.roadmapUnreadable', params: { machine: label } });
      const deps = pipeline.edges.filter((edge) => edge.to === node.id).map((edge) => pipeline.nodes.find((entry) => entry.id === edge.from)).filter((dep): dep is PipelineNode => !!dep);
      const missing = deps.filter((dep) => !taskInfo(copy.doc, dep.ref).done);
      if (missing.length) {
        if (attempt === 0 && project.syncId) {
          await this.syncProject(projectKey, {});
          continue;
        }
        return this.launchError(projectKey, node, { key: 'launch.depsNotSynced', params: { title, machine: label } });
      }
      const task = taskInfo(copy.doc, node.ref);
      if (!task.exists) return this.launchError(projectKey, node, { key: 'launch.missing', params: { machine: label } });
      if (task.done) return false;
      // 3. The conversation to continue must be on the target machine first.
      const fromLabel = this.labelOf(sessionMachineId);
      if (sessionId && !moved) {
        const problem = await this.bringConversation(project, sessionId, sessionMachineId, member, { title, machine: label, from: fromLabel });
        if (problem) return this.launchError(projectKey, node, problem);
        moved = true;
      }
      // 4. Start the work with the injected instructions.
      const instructions = composeInstructions({
        language: this.options.language(),
        pipeline,
        ref: node.ref,
        taskTitle: task.title,
        machineLabel: label,
        doneDeps: deps.map((dep) => {
          const info = taskInfo(copy.doc, dep.ref);
          const doneBy = info.completion?.machineId ? this.labelOf(info.completion.machineId) : '';
          return { title: info.title, machine: doneBy || undefined };
        }),
        continuedFrom: sessionId && sessionMachineId && sessionMachineId !== node.machineId ? { title: sourceTitle, machine: fromLabel } : undefined,
      });
      const revision = copy.doc.revision;
      try {
        const accept = await client.roadmapWork(member.projectId, {
          requestId: pl.requestIdFor(prefix, revision, sessionId),
          expectedRevision: revision,
          targets: [pl.toTarget(node.ref)],
          instructions,
          ...(sessionId ? { sessionId } : {}),
          ...(node.model ?? pipeline.model ? { model: node.model ?? pipeline.model } : {}),
          ...(node.thinking ?? pipeline.thinking ? { thinking: node.thinking ?? pipeline.thinking } : {}),
        });
        if (accept.roadmap) this.storeCopy(projectKey, member.machineKey, member.projectId, accept.roadmap);
        this.adoptRun(projectKey, member.machineKey, node.id, { ...accept.run, sessionId: accept.run.sessionId ?? accept.sessionId });
        this.set((state) => ({ launches: { ...state.launches, [`${projectKey}|${node.id}`]: { at: this.now() } } }));
        this.log('info', { key: sessionId ? 'activity.startedContinued' : 'activity.started', params: { title: task.title, machine: label, from: fromLabel } }, { projectKey, machineKey: member.machineKey });
        return true;
      } catch (error) {
        if (isApiError(error) && error.status === 409 && (error.code === 'roadmap_conflict' || error.code === 'request_conflict' || error.code === 'roadmap_request_conflict'))
          continue; // reread and retry with a new revision, or adopt the run found on the next pass
        if (this.noteScope(member.machineKey, error, 'runs:write'))
          return this.launchError(projectKey, node, { key: 'launch.scope', params: { machine: label } });
        if (sessionId && isApiError(error) && (error.status === 404 || error.code === 'roadmap_wrong_project'))
          return this.launchError(projectKey, node, { key: 'launch.conversationTransfer', params: { title, machine: label, from: fromLabel } });
        if (isApiError(error) && error.offline) {
          // Unknown outcome: never retry elsewhere. The next pass of refreshRuns adopts it if it started.
          return this.launchError(projectKey, node, { key: 'launch.unknown', params: { title, machine: label } });
        }
        return this.launchError(projectKey, node, { key: 'launch.failed', params: { title, machine: label } });
      }
    }
    return this.launchError(projectKey, node, { key: 'launch.conflict', params: { title, machine: label } });
  }

  /**
   * Moves a conversation to the machine of the next task: send it from the machine that ran it,
   * then receive it on the target (R2 sync of one conversation). Returns a notice when it fails.
   * Never falls back to a new conversation by itself: the person chose to continue this one.
   */
  private async bringConversation(
    project: FleetProject,
    sessionId: string,
    fromMachineId: string | null,
    target: { machineKey: string; machineId: string; projectId: string },
    params: Record<string, string>,
  ): Promise<Notice | null> {
    if (!fromMachineId || fromMachineId === target.machineId) return null;
    const source = memberOn(project, fromMachineId);
    const sourceClient = source && this.state.runtimes[source.machineKey]?.state === 'online' ? this.clientFor(source.machineKey) : null;
    if (source && sourceClient) {
      try {
        const sent = await sourceClient.syncProject(source.projectId, sessionId);
        if (sent.state === 'pending') return { key: 'launch.conversationBusy', params };
        if (sent.state === 'off') return { key: 'launch.conversationTransfer', params };
      } catch (error) {
        if (this.noteScope(source.machineKey, error, 'sync:write')) return { key: 'launch.conversationScope', params: { ...params, machine: params.from } };
        // An offline source may have sent it already at the end of its run: the target tells.
        if (!(isApiError(error) && error.offline)) return { key: 'launch.conversationTransfer', params };
      }
    }
    const targetClient = this.clientFor(target.machineKey);
    if (!targetClient) return { key: 'launch.conversationTransfer', params };
    try {
      const received = await targetClient.syncProject(target.projectId, sessionId);
      if (received.state === 'off') return { key: 'launch.conversationTransfer', params };
    } catch (error) {
      if (this.noteScope(target.machineKey, error, 'sync:write')) return { key: 'launch.conversationScope', params };
      return { key: 'launch.conversationTransfer', params };
    }
    return null;
  }

  private adoptRun(projectKey: string, machineKey: string, nodeId: string, run: Run) {
    this.upsertRun(machineKey, run, { projectKey, nodeId });
    this.syncNodeRun(runKeyOf(machineKey, run.id));
    if (isRunActive(run.status)) this.watchRun(machineKey, run.id);
    else void this.onRunEnded(runKeyOf(machineKey, run.id));
  }

  /** Manual start from the UI (also after a failure): launchOnce makes a new attempt when the task ran already. */
  async startNode(projectKey: string, nodeId: string) {
    this.set((state) => {
      const { [`${projectKey}|${nodeId}`]: _previous, ...launches } = state.launches;
      return { launches };
    });
    return this.launchNode(projectKey, nodeId);
  }

  /** Explicit relaunch by a person. */
  relaunchNode(projectKey: string, nodeId: string) {
    return this.startNode(projectKey, nodeId);
  }

  /** Checks the task of a pipeline node in the Roadmap, then syncs and chains (explicit action). */
  async markDone(projectKey: string, nodeId: string, done = true) {
    const node = this.state.pipelines[projectKey]?.nodes.find((entry) => entry.id === nodeId);
    if (!node) return false;
    return this.setTaskDone(projectKey, node.ref, done, node.machineId);
  }

  /** Checks or unchecks a Roadmap task on one machine (preferably the assigned one), then syncs. */
  async setTaskDone(projectKey: string, ref: TaskRef, done: boolean, preferredMachineId?: string | null) {
    const project = projectByKey(this.state, projectKey);
    if (!project) return false;
    const node = { ref };
    const candidates = [memberOn(project, preferredMachineId), ...project.members].filter(
      (member): member is NonNullable<typeof member> => !!member && this.state.runtimes[member.machineKey]?.state === 'online',
    );
    const member = candidates[0];
    const client = member && this.clientFor(member.machineKey);
    if (!member || !client) return false;
    for (let attempt = 0; attempt < 2; attempt++) {
      const copy = await this.readCopy(projectKey, member.machineKey, member.projectId);
      if (!copy) return false;
      const expectedRevision = copy.doc.revision;
      const mutation =
        node.ref.kind === 'step'
          ? { action: 'step.check', expectedRevision, planId: node.ref.planId, stepId: node.ref.stepId, done }
          : node.ref.kind === 'backlog'
            ? { action: 'backlog.set', expectedRevision, numbers: [node.ref.number], done }
            : { action: 'plan.patch', expectedRevision, planId: node.ref.planId, status: done ? 'done' : 'active' };
      try {
        const envelope = await client.mutateRoadmap(member.projectId, mutation);
        this.storeCopy(projectKey, member.machineKey, member.projectId, envelope.roadmap);
        break;
      } catch (error) {
        if (isApiError(error) && error.status === 409 && attempt === 0) continue;
        this.noteScope(member.machineKey, error, 'roadmaps:write');
        this.log('error', { key: 'roadmap.checkFailed', params: { machine: machineByKey(this.state, member.machineKey)?.label ?? '' } }, { projectKey });
        return false;
      }
    }
    if (project.syncId) await this.syncProject(projectKey, { originMachineKey: member.machineKey });
    if (done) await this.evaluateProject(projectKey, { allowAuto: true });
    return true;
  }

  /** Conversation titles of a project (for run lists). */
  async loadSessions(projectKey: string) {
    const project = projectByKey(this.state, projectKey);
    if (!project) return;
    const titles: Record<string, string> = {};
    await Promise.all(
      project.members.map(async (member) => {
        const client = this.state.runtimes[member.machineKey]?.state === 'online' ? this.clientFor(member.machineKey) : null;
        if (!client) return;
        try {
          for (const session of await client.sessions(member.projectId)) titles[session.id] = session.title;
        } catch {
          /* titles are optional */
        }
      }),
    );
    this.set((state) => ({ sessionTitles: { ...state.sessionTitles, ...titles } }));
  }

  /** Persisted history of a conversation (last messages), for finished runs. */
  async loadHistory(runKey: string) {
    const live = this.state.runs[runKey];
    const client = live && this.clientFor(live.machineKey);
    const sessionId = live?.run.sessionId;
    if (!sessionId || !client) return;
    let page = await client.messages(sessionId, { limit: 200, offset: 0 });
    let previous = page.items.slice(0, 0);
    while (page.nextOffset !== null) {
      previous = page.items;
      page = await client.messages(sessionId, { limit: 200, offset: page.nextOffset });
    }
    const history = [...previous, ...page.items];
    this.patchRun(runKey, (current) => ({ messages: mergeMessages(history, current.messages) }));
  }

  /** Model catalog of a machine (loaded once, on demand). */
  async loadModels(machineKey: string) {
    if (this.state.models[machineKey]?.length) return this.state.models[machineKey];
    const client = this.clientFor(machineKey);
    if (!client) return [];
    try {
      const models = await client.models();
      this.set((state) => ({ models: { ...state.models, [machineKey]: models } }));
      return models;
    } catch {
      return [];
    }
  }

  /** Turns auto mode on or off. Turning it on starts the ready tasks now. */
  async setAuto(projectKey: string, auto: boolean) {
    this.setPipeline(projectKey, { ...this.pipelineFor(projectKey), auto, updatedAt: this.now() });
    if (auto) return this.evaluateProject(projectKey, { allowAuto: true });
    return [];
  }
}
