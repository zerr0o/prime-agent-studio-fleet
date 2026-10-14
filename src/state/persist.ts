// Persistence: machines, pipelines and preferences in a key-value store; tokens in a
// secret store. Adapters are injected (AsyncStorage + SecureStore on Android,
// localStorage on the web, memory in tests).
import type { MachineConfig, Pipeline } from '../domain/types';
import type { ActivityItem, FleetState, FleetStore, Prefs } from './store';

export type KeyValue = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export type Secrets = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};

const STATE_KEY = 'pf.v1.state';
const tokenKey = (machineKey: string) => `pf.token.${machineKey.replace(/[^A-Za-z0-9._-]/g, '_')}`;

type Saved = { machines?: MachineConfig[]; pipelines?: Record<string, Pipeline>; prefs?: Partial<Prefs>; activity?: ActivityItem[] };

export async function hydrate(store: FleetStore, kv: KeyValue, secrets: Secrets) {
  let saved: Saved = {};
  try {
    saved = JSON.parse((await kv.getItem(STATE_KEY)) ?? '{}') as Saved;
  } catch {
    saved = {};
  }
  const machines = Array.isArray(saved.machines) ? saved.machines.filter((m) => m && typeof m.key === 'string') : [];
  const tokens: Record<string, string> = {};
  for (const machine of machines) {
    try {
      const token = await secrets.get(tokenKey(machine.key));
      if (token) tokens[machine.key] = token;
    } catch {
      /* a missing token shows as "token required" */
    }
  }
  const state = store.getState();
  store.setState({
    machines,
    tokens,
    pipelines: saved.pipelines && typeof saved.pipelines === 'object' ? saved.pipelines : {},
    prefs: { ...state.prefs, ...saved.prefs },
    activity: Array.isArray(saved.activity) ? saved.activity.slice(0, 100) : [],
    hydrated: true,
  });
}

/** Writes changes (debounced). Returns the unsubscribe function. */
export function persistOnChange(store: FleetStore, kv: KeyValue, secrets: Secrets, delay = 400) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let previous = store.getState();
  const write = () => {
    timer = null;
    const state = store.getState();
    const saved: Saved = { machines: state.machines, pipelines: state.pipelines, prefs: state.prefs, activity: state.activity.slice(0, 100) };
    void kv.setItem(STATE_KEY, JSON.stringify(saved));
  };
  return store.subscribe((state: FleetState) => {
    if (!state.hydrated) return;
    const before = previous;
    previous = state;
    if (state.machines !== before.machines || state.pipelines !== before.pipelines || state.prefs !== before.prefs || state.activity !== before.activity) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(write, delay);
    }
    if (state.tokens !== before.tokens) {
      for (const [key, token] of Object.entries(state.tokens))
        if (before.tokens[key] !== token) void secrets.set(tokenKey(key), token);
      for (const key of Object.keys(before.tokens)) if (!(key in state.tokens)) void secrets.remove(tokenKey(key));
    }
  });
}

// ---------- Export and import (no token ever leaves the device) ----------

export type ExportFile = {
  format: 'prime-fleet';
  version: 1;
  exportedAt: string;
  machines: { label: string; baseUrl: string; color: string; machineId?: string }[];
  pipelines: Record<string, Pipeline>;
};

export function exportData(state: FleetState, now = Date.now()): string {
  const file: ExportFile = {
    format: 'prime-fleet',
    version: 1,
    exportedAt: new Date(now).toISOString(),
    machines: state.machines.map(({ label, baseUrl, color, machineId }) => ({ label, baseUrl, color, machineId })),
    pipelines: state.pipelines,
  };
  return JSON.stringify(file, null, 2);
}

export type ImportResult = { machines: MachineConfig[]; pipelines: Record<string, Pipeline>; addedMachines: number; pipelinesImported: number };

/** Merges a file: unknown machines are added (without token), pipelines replace the local ones. */
export function importData(state: FleetState, text: string, now = Date.now()): ImportResult {
  const file = JSON.parse(text) as Partial<ExportFile>;
  if (file.format !== 'prime-fleet' || file.version !== 1) throw new Error('format');
  const machines = [...state.machines];
  let addedMachines = 0;
  for (const entry of file.machines ?? []) {
    if (!entry || typeof entry.baseUrl !== 'string') continue;
    const known = machines.some(
      (machine) => (entry.machineId && machine.machineId === entry.machineId) || machine.baseUrl === entry.baseUrl,
    );
    if (known) continue;
    machines.push({
      key: `m-${now.toString(36)}-${addedMachines}`,
      label: String(entry.label ?? ''),
      baseUrl: entry.baseUrl,
      color: String(entry.color ?? ''),
      machineId: entry.machineId,
      addedAt: now,
    });
    addedMachines++;
  }
  const pipelines = { ...state.pipelines };
  let pipelinesImported = 0;
  for (const [key, pipeline] of Object.entries(file.pipelines ?? {})) {
    if (!pipeline || !Array.isArray(pipeline.nodes) || !Array.isArray(pipeline.edges)) continue;
    pipelines[key] = { ...pipeline, projectKey: key, updatedAt: now };
    pipelinesImported++;
  }
  return { machines, pipelines, addedMachines, pipelinesImported };
}
