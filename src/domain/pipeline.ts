// Pipeline model and evaluation. Pure functions: every edit returns a new pipeline.
import { isRunActive, type Run } from '../api/types';
import { hashText } from './hash';
import { findBacklog, findPlan, hasActivity, taskInfo, type TaskInfo } from './roadmap';
import type {
  FleetProject,
  MachineRuntime,
  NodeState,
  Pipeline,
  PipelineEdge,
  PipelineNode,
  RoadmapCopy,
  TaskRef,
} from './types';

export const UNASSIGNED = 'unassigned';
export const NODE_WIDTH = 208;
export const COLUMN = 248; // horizontal step of the automatic layout

export const nodeIdFor = (ref: TaskRef) =>
  ref.kind === 'step' ? `step:${ref.stepId}` : ref.kind === 'plan' ? `plan:${ref.planId}` : `backlog:${ref.number}`;

export const edgeId = (edge: PipelineEdge) => `${edge.from}->${edge.to}`;

export function emptyPipeline(projectKey: string, gitText: string, now: number): Pipeline {
  return {
    projectKey,
    auto: false,
    git: { enabled: true, text: gitText },
    extra: '',
    nodes: [],
    edges: [],
    updatedAt: now,
  };
}

const touch = (pipeline: Pipeline, patch: Partial<Pipeline>, now: number): Pipeline => ({ ...pipeline, ...patch, updatedAt: now });

/** x after the last node of a lane, so new nodes never overlap. */
export function nextX(pipeline: Pipeline, machineId: string | null): number {
  const lane = pipeline.nodes.filter((node) => node.machineId === machineId);
  return lane.length ? Math.max(...lane.map((node) => node.x)) + COLUMN : 24;
}

/** Assigns a task to a machine (null = unassigned). Creates the node when needed. */
export function assignTask(pipeline: Pipeline, ref: TaskRef, machineId: string | null, now: number): Pipeline {
  const id = nodeIdFor(ref);
  const existing = pipeline.nodes.find((node) => node.id === id);
  if (existing) {
    if (existing.machineId === machineId) return pipeline;
    return touch(
      pipeline,
      { nodes: pipeline.nodes.map((node) => (node.id === id ? { ...node, machineId, x: nextX(pipeline, machineId) } : node)) },
      now,
    );
  }
  const node: PipelineNode = { id, ref, machineId, x: nextX(pipeline, machineId), attempt: 0 };
  return touch(pipeline, { nodes: [...pipeline.nodes, node] }, now);
}

export function moveNode(pipeline: Pipeline, nodeId: string, machineId: string | null, x: number, now: number): Pipeline {
  return touch(
    pipeline,
    { nodes: pipeline.nodes.map((node) => (node.id === nodeId ? { ...node, machineId, x: Math.max(0, Math.round(x)) } : node)) },
    now,
  );
}

export function updateNode(pipeline: Pipeline, nodeId: string, patch: Partial<PipelineNode>, now: number): Pipeline {
  return touch(pipeline, { nodes: pipeline.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)) }, now);
}

/** A node that continued the conversation of `from` goes back to the pipeline setting. */
const forgetSource = (node: PipelineNode, from: string): PipelineNode =>
  node.conversation?.mode === 'continue' && node.conversation.from === from && node.id !== from ? { ...node, conversation: undefined } : node;

export function removeNode(pipeline: Pipeline, nodeId: string, now: number): Pipeline {
  return touch(
    pipeline,
    {
      nodes: pipeline.nodes.filter((node) => node.id !== nodeId).map((node) => forgetSource(node, nodeId)),
      edges: pipeline.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId),
    },
    now,
  );
}

/** True when "to" already leads to "from": adding from -> to would close a loop. */
export function wouldCycle(edges: PipelineEdge[], from: string, to: string): boolean {
  const stack = [to];
  const seen = new Set<string>();
  while (stack.length) {
    const current = stack.pop()!;
    if (current === from) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const edge of edges) if (edge.from === current) stack.push(edge.to);
  }
  return false;
}

export type ConnectError = 'self' | 'exists' | 'cycle' | 'missing';

export function connect(pipeline: Pipeline, from: string, to: string, now: number): { pipeline: Pipeline; error?: ConnectError } {
  if (from === to) return { pipeline, error: 'self' };
  if (!pipeline.nodes.some((node) => node.id === from) || !pipeline.nodes.some((node) => node.id === to))
    return { pipeline, error: 'missing' };
  if (pipeline.edges.some((edge) => edge.from === from && edge.to === to)) return { pipeline, error: 'exists' };
  if (wouldCycle(pipeline.edges, from, to)) return { pipeline, error: 'cycle' };
  return { pipeline: touch(pipeline, { edges: [...pipeline.edges, { from, to }] }, now) };
}

export function disconnect(pipeline: Pipeline, from: string, to: string, now: number): Pipeline {
  return touch(
    pipeline,
    {
      edges: pipeline.edges.filter((edge) => !(edge.from === from && edge.to === to)),
      nodes: pipeline.nodes.map((node) => (node.id === to ? forgetSource(node, from) : node)),
    },
    now,
  );
}

// ---------- Conversations ----------

/**
 * Node whose conversation this task continues, or null for a new conversation.
 * Explicit choice first; otherwise the pipeline setting picks the dependency whose run ended last
 * (the first dependency while none has run yet).
 */
export function conversationSource(pipeline: Pipeline, node: PipelineNode): string | null {
  const choice = node.conversation;
  if (choice?.mode === 'new') return null;
  const deps = pipeline.edges
    .filter((edge) => edge.to === node.id)
    .map((edge) => pipeline.nodes.find((entry) => entry.id === edge.from))
    .filter((dep): dep is PipelineNode => !!dep);
  if (choice?.mode === 'continue') return choice.from === node.id || deps.some((dep) => dep.id === choice.from) ? choice.from : null;
  if (pipeline.conversation !== 'continue' || !deps.length) return null;
  const ended = (dep: PipelineNode) => dep.lastRun?.endedAt ?? dep.lastRun?.startedAt ?? '';
  return [...deps].sort((a, b) => ended(b).localeCompare(ended(a)))[0].id;
}

/** Sets which conversation a task continues: 'new', the task itself, or one of its dependencies. */
export function setConversation(pipeline: Pipeline, nodeId: string, choice: PipelineNode['conversation'], now: number): Pipeline {
  return updateNode(pipeline, nodeId, { conversation: choice }, now);
}

/** Dependency depth of every node (0 = no dependency). */
export function depths(pipeline: Pipeline): Record<string, number> {
  const result: Record<string, number> = {};
  const visit = (id: string, trail: Set<string>): number => {
    if (result[id] !== undefined) return result[id];
    if (trail.has(id)) return 0;
    trail.add(id);
    const parents = pipeline.edges.filter((edge) => edge.to === id).map((edge) => edge.from);
    const depth = parents.length ? Math.max(...parents.map((parent) => visit(parent, trail) + 1)) : 0;
    trail.delete(id);
    return (result[id] = depth);
  };
  for (const node of pipeline.nodes) visit(node.id, new Set());
  return result;
}

/** Columns by dependency depth; nodes of one lane never overlap. */
export function autoLayout(pipeline: Pipeline, now: number): Pipeline {
  const depth = depths(pipeline);
  const used = new Map<string, Set<number>>();
  const ordered = [...pipeline.nodes].sort((a, b) => depth[a.id] - depth[b.id] || a.x - b.x);
  const placed = new Map<string, number>();
  for (const node of ordered) {
    const lane = node.machineId ?? UNASSIGNED;
    const columns = used.get(lane) ?? new Set<number>();
    let column = depth[node.id];
    while (columns.has(column)) column++;
    columns.add(column);
    used.set(lane, columns);
    placed.set(node.id, 24 + column * COLUMN);
  }
  return touch(pipeline, { nodes: pipeline.nodes.map((node) => ({ ...node, x: placed.get(node.id) ?? node.x })) }, now);
}

// ---------- Evaluation ----------

export type NodeContext = {
  pipeline: Pipeline;
  project: FleetProject;
  copies: Record<string, RoadmapCopy | undefined>; // by machineKey
  runtimes: Record<string, MachineRuntime | undefined>; // by machineKey
  activeRuns: Run[]; // active runs of this project on its machines (any origin)
};

export type NodeEval = {
  node: PipelineNode;
  state: NodeState;
  task: TaskInfo;
  deps: string[];
  pendingDeps: string[];
  doneIn: string[]; // machineKeys whose copy has the task done
  reopened: boolean; // done once after its last run, then unchecked
};

/** Time of the version of a task in one copy: Studio's merge keeps the newest plan (or backlog entry). */
function versionTime(copy: RoadmapCopy, ref: TaskRef): number {
  if (ref.kind === 'backlog') {
    const entry = findBacklog(copy.doc, ref.number);
    return entry ? Number(entry.updatedAt ?? entry.addedAt ?? 0) : -1;
  }
  const plan = findPlan(copy.doc, ref.planId);
  return plan ? Number(plan.updatedAt ?? 0) : -1;
}

/**
 * Reads a task across every copy. Among the copies that take part in the R2 sync, the one holding the
 * newest version of its plan wins, as in Studio's merge: a step checked on one PC and unchecked later on
 * another reads unchecked. A machine without R2 sync (`isolated`) never receives the other changes, so
 * its copy does not take part in that choice; its own checks still count.
 */
export function readTask(ref: TaskRef, copies: Record<string, RoadmapCopy | undefined>, isolated: ReadonlySet<string> = new Set()) {
  const all = Object.values(copies).filter((copy): copy is RoadmapCopy => !!copy);
  const doneIn: string[] = [];
  let best: { copy: RoadmapCopy; task: TaskInfo; time: number } | undefined;
  let isolatedDone: TaskInfo | undefined;
  let isolatedAny: TaskInfo | undefined;
  for (const copy of all) {
    const task = taskInfo(copy.doc, ref);
    if (!task.exists) continue;
    if (task.done) doneIn.push(copy.machineKey);
    if (isolated.has(copy.machineKey)) {
      isolatedAny ??= task;
      if (task.done && (!isolatedDone || (task.completion?.completedAt ?? 0) > (isolatedDone.completion?.completedAt ?? 0))) isolatedDone = task;
      continue;
    }
    const time = versionTime(copy, ref);
    if (!best || time > best.time || (time === best.time && copy.editedAt > best.copy.editedAt)) best = { copy, task, time };
  }
  const task = (best?.task.done ? best.task : isolatedDone) ?? best?.task ?? isolatedAny ?? taskInfo(undefined, ref);
  return { task, doneIn };
}

/** Machines of a project without R2 sync: their Roadmap copy is on its own. */
export const isolatedCopies = (project: FleetProject, runtimes: Record<string, MachineRuntime | undefined>) =>
  new Set(project.members.filter((member) => runtimes[member.machineKey]?.sync?.configured === false).map((member) => member.machineKey));

/** A finished run whose task was done, then unchecked: the task is open again. */
export const isReopened = (node: PipelineNode, task: TaskInfo) => {
  const run = node.lastRun;
  return !!run && !isRunActive(run.status) && (run.checked === true || run.seenDone === true) && task.exists && !task.done;
};

export function evaluate(ctx: NodeContext): Record<string, NodeEval> {
  const { pipeline, project, copies, runtimes, activeRuns } = ctx;
  const results: Record<string, NodeEval> = {};
  const memberByMachine = new Map(project.members.map((member) => [member.machineId, member]));
  const anyActivity = (ref: TaskRef) => Object.values(copies).some((copy) => copy && hasActivity(copy.doc, ref));
  const isolated = isolatedCopies(project, runtimes);

  // Pass 1: facts that do not depend on other nodes.
  const open = new Set<string>();
  for (const node of pipeline.nodes) {
    const { task, doneIn } = readTask(node.ref, copies, isolated);
    const deps = pipeline.edges.filter((edge) => edge.to === node.id).map((edge) => edge.from);
    let state: NodeState | null = null;
    const run = node.lastRun;
    const reopened = isReopened(node, task);
    if ((run && isRunActive(run.status)) || anyActivity(node.ref)) state = 'running';
    else if (!task.exists) state = 'missing';
    else if (task.done) state = 'done';
    // A finished run of this attempt needs a person (never started again by itself),
    // unless its task was done and then reopened: then the task is simply open again.
    else if (run && !reopened) state = run.status === 'failed' ? 'failed' : run.status === 'stopped' ? 'stopped' : 'review';
    results[node.id] = { node, state: state ?? 'waiting', task, deps, pendingDeps: [], doneIn, reopened };
    if (state === null) open.add(node.id);
  }

  // Pass 2: readiness of the nodes still open.
  const busyMachines = new Set<string>();
  for (const run of activeRuns) if (isRunActive(run.status)) busyMachines.add(run.machineId);
  for (const evaluation of Object.values(results)) if (evaluation.state === 'running' && evaluation.node.machineId) busyMachines.add(evaluation.node.machineId);

  for (const evaluation of Object.values(results)) {
    if (!open.has(evaluation.node.id)) continue;
    const node = evaluation.node;
    evaluation.pendingDeps = evaluation.deps.filter((dep) => results[dep]?.state !== 'done');
    if (!node.machineId) evaluation.state = 'unassigned';
    else if (evaluation.pendingDeps.length) evaluation.state = 'waiting';
    else {
      const member = memberByMachine.get(node.machineId);
      const runtime = member ? runtimes[member.machineKey] : undefined;
      if (!member || runtime?.state !== 'online') evaluation.state = 'offline';
      else if (busyMachines.has(node.machineId)) evaluation.state = 'queued';
      else evaluation.state = 'ready';
    }
  }

  // One task per machine at a time: the first ready one (dependency then position order) stays ready.
  const depth = depths(pipeline);
  const taken = new Set<string>();
  const ready = Object.values(results)
    .filter((evaluation) => evaluation.state === 'ready')
    .sort((a, b) => depth[a.node.id] - depth[b.node.id] || a.node.x - b.node.x);
  for (const evaluation of ready) {
    const machineId = evaluation.node.machineId!;
    if (taken.has(machineId)) evaluation.state = 'queued';
    else taken.add(machineId);
  }
  return results;
}

/** Ready nodes to start now (at most one per machine, see evaluate). */
export function nextToLaunch(pipeline: Pipeline, evaluations: Record<string, NodeEval>): PipelineNode[] {
  const depth = depths(pipeline);
  return Object.values(evaluations)
    .filter((evaluation) => evaluation.state === 'ready' && evaluation.node.machineId)
    .sort((a, b) => depth[a.node.id] - depth[b.node.id] || a.node.x - b.node.x)
    .map((evaluation) => evaluation.node);
}

// ---------- Request ids ----------

/** Stable per node attempt: lets every app instance find a run already started. */
export function requestPrefix(projectKey: string, nodeId: string, attempt: number) {
  return `pf-${hashText(`${projectKey}|${nodeId}|${attempt}`).padStart(11, '0')}-`;
}

export const requestIdFor = (prefix: string, revision: number, sessionId?: string | null) =>
  `${prefix}r${revision}${sessionId ? `-s${hashText(sessionId).slice(0, 6)}` : ''}`;

export function toTarget(ref: TaskRef) {
  if (ref.kind === 'step') return { kind: 'plan' as const, planId: ref.planId, stepId: ref.stepId };
  if (ref.kind === 'plan') return { kind: 'plan' as const, planId: ref.planId };
  return { kind: 'backlog' as const, number: ref.number };
}
