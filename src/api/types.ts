// DTOs of the Prime Agent Studio public API v1 (docs/openapi-v1.json).
// Fields marked "observed" are returned by Studio 4.3 but are not in the contract.

export type Scope = 'read' | 'runs:write' | 'roadmaps:write' | 'files:download' | 'computer:write' | 'sync:write';
export type Thinking = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const THINKING_LEVELS: Thinking[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export type Page<T> = { items: T[]; nextOffset: number | null };

export type ApiErrorBody = { error: string; code: string; currentRevision?: number };

export type MachineInfo = {
  apiVersion: 'v1';
  studioVersion: string;
  machineId: string;
  name: string; // host name of the PC
  capabilities: string[];
  idempotency: { retentionSeconds: number; persistent: boolean };
};

export type LastSync = { at: string; ok: boolean; sent: number; received: number };

export type SyncState = {
  machineId: string;
  configured: boolean;
  running: boolean;
  lastSync: LastSync | null;
};

export type SyncResult = {
  machineId: string;
  projectId: string;
  scope: 'session' | 'all';
  sessionId?: string;
  state?: 'synced' | 'pending' | 'off' | string;
  changed?: boolean;
  lastSync?: LastSync | null;
};

export type Project = {
  id: string; // local to its machine
  name: string;
  syncId: string | null; // same project on several machines shares this id
  exists: boolean;
  machineId: string;
};

export type Model = {
  id: string;
  name?: string;
  provider?: string;
  input?: string;
  reasoning?: boolean;
  thinkingLevels?: Thinking[];
  contextWindow?: number;
  availability?: string;
};

export type Session = {
  id: string;
  title: string;
  createdAt?: string;
  updatedAt?: string;
  model?: string;
  thinking?: Thinking;
  machineId: string;
  projectId: string;
};

export type ToolCall = { id?: string; name?: string; args?: unknown; status?: string; result?: unknown; isError?: boolean };

export type MessageItem = {
  id?: string;
  role?: string;
  text?: string;
  thinking?: string;
  timestamp?: string;
  usage?: Record<string, unknown>;
  model?: string;
  provider?: string;
  error?: string;
  stopReason?: string;
  customType?: string;
  contextKind?: string;
  agentMessage?: Record<string, unknown>;
  tools?: ToolCall[];
  attachments?: { type?: string; id?: string; name?: string; size?: number | null; mimeType?: string }[];
};

export type MessagePage = {
  sessionId: string;
  projectId: string;
  machineId: string;
  items: MessageItem[];
  nextOffset: number | null;
};

// Observed shape of a pending agent question (lib/native-interactions.mjs).
export type Interaction = {
  id: string;
  method?: 'select' | 'input' | 'confirm' | 'editor' | string;
  title?: string;
  message?: string;
  options?: string[];
  optionDetails?: ({ label: string; description: string } | null)[];
  placeholder?: string;
  prefill?: string;
  allowCustom?: boolean;
  status?: 'pending' | 'answered' | 'cancelled' | 'interrupted' | string;
  answer?: string | boolean;
  createdAt?: number;
  timeout?: number;
};

export type RunStatus = 'running' | 'stopping' | 'completed' | 'failed' | 'stopped' | string;

export type Run = {
  id: string;
  sessionId: string | null;
  projectId: string;
  machineId: string;
  status: RunStatus;
  startedAt: string;
  endedAt?: string;
  error?: string | null;
  model: string | null;
  thinking: string | null;
  allowQuestions: boolean;
  interactions: Interaction[];
  requestId?: string;
};

export const isRunActive = (status: RunStatus) => status === 'running' || status === 'stopping';

// Run events (SSE). Every event carries seq, machineId, projectId and runId.
export type RunEvent = {
  kind:
    | 'session'
    | 'message_start'
    | 'text'
    | 'thinking'
    | 'message'
    | 'tool_start'
    | 'tool_update'
    | 'tool_end'
    | 'status'
    | 'interaction'
    | 'done'
    | 'replay_truncated'
    | string;
  seq?: number;
  machineId?: string;
  projectId?: string;
  runId?: string;
  sessionId?: string | null;
  // kind-specific fields
  role?: string;
  delta?: string;
  message?: MessageItem | string;
  id?: string;
  name?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  status?: string;
  code?: number;
  error?: string;
  request?: Interaction;
  attempt?: number;
  delayMs?: number;
};

export type InteractionResponse = { cancelled: true } | { confirmed: boolean } | { value: string };

export type StopResult = { stopped: true } & Partial<Run>;

export type FileRef = {
  id: string;
  name: string;
  size: number | null;
  available: boolean;
  machineId: string;
  originMachineId: string | null;
  kind: 'link' | 'attachment';
};

// ---------- Roadmap ----------

export type RoadmapCompletion = { machineId: string; sessionId: string | null; completedAt: number } | null;

export type RoadmapStep = {
  id: string;
  text: string;
  note?: string;
  done: boolean;
  completion: RoadmapCompletion;
  children: RoadmapStep[];
  partial?: boolean;
};

export type Progress = { done: number; total: number; percent: number };

export type PlanStatus = 'active' | 'done' | 'paused' | 'abandoned';
export type MilestoneStatus = 'planned' | 'active' | 'done';

export type JournalEntry = { at?: number; text?: string; by?: string; sessionId?: string; [key: string]: unknown };

export type RoadmapPlan = {
  id: string;
  slug?: string;
  title: string;
  summary?: string;
  status: PlanStatus;
  milestone: string | null;
  color?: string; // 'transparent' or a plan palette color
  sessions?: string[];
  steps: RoadmapStep[];
  journal?: JournalEntry[];
  createdAt?: number;
  updatedAt?: number;
  archived?: boolean;
  archivedAt?: number | null;
  progress?: Progress;
};

export type Milestone = {
  id: string;
  title: string;
  summary?: string;
  status: MilestoneStatus;
  progress?: Progress;
};

export type BacklogEntry = {
  id?: string;
  number: number;
  text: string;
  note?: string;
  done?: boolean;
  addedAt?: number;
  updatedAt?: number;
};

export type RoadmapActivity = {
  sessionId?: string;
  rootSessionId?: string;
  name?: string;
  targets?: RoadmapTarget[];
  [key: string]: unknown;
};

export type RoadmapDocument = {
  revision: number;
  name?: string;
  initialized?: boolean;
  lastEdit?: { by?: string; at?: number; sessionId?: string; name?: string } | null;
  overview?: { vision?: string; milestones?: Milestone[]; progress?: Progress };
  plans?: RoadmapPlan[];
  backlog?: { items: BacklogEntry[]; notes: BacklogEntry[]; nextNumber?: number };
  progress?: Progress;
  pastudioImports?: unknown[];
  // Observed decorations of the local copy.
  instanceId?: string;
  activityRevision?: number;
  activity?: RoadmapActivity[];
  linkWarnings?: { runId: string; sessionId: string | null }[];
};

export type RoadmapEnvelope = { machineId: string; projectId: string; roadmap: RoadmapDocument };

export type RoadmapTarget =
  | { kind: 'plan'; planId: string; stepId?: string }
  | { kind: 'milestone'; milestoneId: string }
  | { kind: 'backlog'; number: number };

export type RoadmapWorkBody = {
  requestId: string;
  expectedRevision: number;
  targets: RoadmapTarget[];
  instructions?: string;
  sessionId?: string;
  model?: string;
  thinking?: Thinking;
};

export type RoadmapWorkAccept = {
  accepted: true;
  queued: boolean;
  requestId: string;
  run: Run;
  sessionId: string | null;
  roadmap?: RoadmapDocument;
  linkWarning?: boolean;
  machineId: string;
  projectId: string;
};

// Closed mutation actions accepted by POST /roadmap/mutations (subset typed for the app).
export type RoadmapMutation =
  | { action: 'step.check'; expectedRevision: number; planId: string; stepId?: string; stepIds?: string[]; done: boolean; note?: string; comment?: string; sessionId?: string }
  | { action: 'backlog.set'; expectedRevision: number; numbers: number[]; done: boolean }
  | { action: 'plan.patch'; expectedRevision: number; planId: string; title?: string; summary?: string; status?: PlanStatus }
  | { action: 'journal.add'; expectedRevision: number; planId: string; text: string }
  | { action: string; expectedRevision: number; [key: string]: unknown };

export type CreateRunBody = {
  requestId: string;
  message: string;
  sessionId?: string;
  model?: string;
  thinking?: Thinking;
  allowQuestions?: boolean;
};

export type SendMessageBody = { requestId: string; mode: 'steer' | 'follow_up'; message: string };
