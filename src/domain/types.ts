// Domain types of Prime Fleet. Pure TypeScript: no React Native import here,
// so the domain and the conductor run in Node tests against the simulator.
import type {
  MachineInfo,
  RoadmapDocument,
  RunStatus,
  SyncState,
  Thinking,
} from '../api/types';

// ---------- Machines (fleet members) ----------

/** One Studio the app talks to. The token is stored apart (secure storage). */
export type MachineConfig = {
  key: string; // local id of this entry
  label: string; // display name chosen by the person (default: Studio host name)
  baseUrl: string; // http://127.0.0.1:3088, https://pc.tailnet.ts.net, http://100.x.y.z:3089
  color: string; // device palette color (identity only)
  addedAt: number;
  machineId?: string; // stable Studio identity, learned from GET /machine
};

export type ConnectionState =
  | 'unknown'
  | 'connecting'
  | 'online'
  | 'offline' // network failure or timeout
  | 'unauthorized' // 401: token missing, wrong or revoked
  | 'forbidden' // 403 on /machine: API refused (transport, host)
  | 'disabled' // 404 api_disabled
  | 'incompatible' // not a v1 Studio
  | 'error';

export type MachineRuntime = {
  state: ConnectionState;
  info?: MachineInfo;
  sync?: SyncState;
  checkedAt?: number;
  lastSeenAt?: number;
  error?: string; // short, user-facing
  missingScopes?: string[]; // learned from 403 insufficient_scope
};

// ---------- Projects across machines ----------

export type ProjectMember = {
  machineKey: string;
  machineId: string;
  projectId: string; // local id on that machine
  name: string;
  exists: boolean;
};

/** Top-level entity: one project found on one or several machines (same syncId). */
export type FleetProject = {
  key: string; // 'sync:<syncId>' or 'local:<machineId>:<projectId>'
  syncId: string | null;
  name: string;
  members: ProjectMember[];
};

export type RoadmapCopy = {
  machineKey: string;
  projectId: string;
  doc: RoadmapDocument;
  fetchedAt: number;
  fingerprint: string; // content hash, comparable across machines
  editedAt: number; // lastEdit.at (converges to the newest after sync)
};

/** Sync status of one machine for one project. */
export type MemberSyncStatus =
  | 'synced' // same Roadmap content as every other readable copy
  | 'latest' // holds the most recent change, not yet on every machine
  | 'behind' // misses changes made on another machine
  | 'diverged' // different content with the same edit time
  | 'solo' // project on one machine only (no syncId or single member)
  | 'sync-off' // Cloudflare R2 sync not configured on this Studio
  | 'offline'
  | 'unknown';

// ---------- Pipeline (stored in the app only) ----------

export type TaskRef =
  | { kind: 'step'; planId: string; stepId: string }
  | { kind: 'plan'; planId: string }
  | { kind: 'backlog'; number: number };

export type NodeRun = {
  machineId: string;
  runId: string;
  requestId: string;
  sessionId: string | null;
  status: RunStatus;
  startedAt: string;
  endedAt?: string;
  error?: string | null;
  // Set after the end of run sync: the step was (not) checked.
  checked?: boolean;
  // The task was seen done after this run ended (by the agent or by a person).
  // A task seen done, then unchecked, is reopened: this run is history.
  seenDone?: boolean;
};

/** Conversation used when a task starts: a new one, or the one of another task of the pipeline. */
export type ConversationChoice = { mode: 'new' } | { mode: 'continue'; from: string }; // from: a dependency, or the task itself

export type PipelineNode = {
  id: string; // derived from the task: 'step:<stepId>', 'plan:<planId>', 'backlog:<n>'
  ref: TaskRef;
  machineId: string | null; // assigned machine (stable Studio id)
  x: number; // horizontal position in its lane (canvas units)
  model?: string;
  thinking?: Thinking;
  attempt: number; // incremented for each new start of the task
  lastRun?: NodeRun;
  conversation?: ConversationChoice; // undefined: pipeline setting
};

export type PipelineEdge = { from: string; to: string }; // "to" waits for "from"

export type Pipeline = {
  projectKey: string;
  auto: boolean; // launch ready tasks automatically
  git: { enabled: boolean; text: string };
  extra: string; // extra instructions added to every task
  // Conversation of a task that follows another one: a new conversation (default),
  // or the conversation of the task it waits for, moved to its machine by the R2 sync.
  conversation?: 'new' | 'continue';
  model?: string;
  thinking?: Thinking;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  updatedAt: number;
};

export type NodeState =
  | 'done' // step checked in the Roadmap
  | 'running' // a run works on it now
  | 'queued' // ready, waits for its machine to finish another task of this project
  | 'ready' // dependencies done, machine assigned and online
  | 'waiting' // dependencies not done yet
  | 'review' // the last run ended but the step is not checked
  | 'failed' // the last run failed
  | 'stopped' // the last run was stopped
  | 'offline' // ready, but its machine is offline or lacks the project
  | 'unassigned' // no machine
  | 'missing'; // the task no longer exists in the Roadmap

// ---------- Node editor view model ----------

export type EditorLane = {
  id: string; // machineId, or 'unassigned'
  label: string;
  color: string | null; // machine color (identity)
  online: boolean | null; // null = not a machine lane
  meta?: string; // short line: "Synced · 1 run"
};

export type EditorNode = {
  id: string;
  laneId: string;
  x: number;
  title: string; // task text
  subtitle: string; // plan title or "Backlog"
  planColor?: string | null;
  state: NodeState;
  stateLabel: string; // translated status word
  detail?: string; // optional meta: "Done on Workstation · 17:04"
};

export type EditorEdge = {
  id: string; // `${from}->${to}`
  from: string;
  to: string;
  satisfied: boolean; // "from" is done
  conversation?: boolean; // "to" continues the conversation of "from"
};
