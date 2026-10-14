import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startSimulator } from '../sim/studio-sim.mjs';

// ---------------------------------------------------------------------------
// Small OpenAPI schema validator (type, required, properties, items, enum, nullable, oneOf, $ref, ...)
// ---------------------------------------------------------------------------
const spec: any = JSON.parse(readFileSync(new URL('../docs/openapi-v1.json', import.meta.url), 'utf8'));

function deref(schema: any): any {
  let current = schema;
  while (current && current.$ref) {
    const name = String(current.$ref).split('/').pop() as string;
    current = spec.components.schemas[name];
  }
  return current;
}

function validate(schema: any, value: any, path = '$'): string[] {
  const s = deref(schema);
  if (!s) return [`${path}: missing schema`];
  if (value === null) return s.nullable || s.type === 'null' || (s.enum && s.enum.includes(null)) ? [] : [`${path}: null not allowed`];
  if (s.oneOf) {
    const results = s.oneOf.map((option: any) => validate(option, value, path));
    return results.some((r: string[]) => r.length === 0) ? [] : [`${path}: no oneOf option matches (${results.map((r: string[]) => r[0]).join(' | ')})`];
  }
  const errors: string[] = [];
  if (s.enum && !s.enum.includes(value)) errors.push(`${path}: ${JSON.stringify(value)} not in enum`);
  switch (s.type) {
    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) return [`${path}: expected object`];
      for (const key of s.required ?? []) if (!(key in value)) errors.push(`${path}: missing required ${key}`);
      for (const [key, sub] of Object.entries(s.properties ?? {})) if (key in value) errors.push(...validate(sub, value[key], `${path}.${key}`));
      if (s.additionalProperties === false)
        for (const key of Object.keys(value)) if (!(key in (s.properties ?? {}))) errors.push(`${path}: unexpected property ${key}`);
      break;
    }
    case 'array':
      if (!Array.isArray(value)) return [`${path}: expected array`];
      if (s.maxItems !== undefined && value.length > s.maxItems) errors.push(`${path}: too many items`);
      if (s.items) value.forEach((item: any, i: number) => errors.push(...validate(s.items, item, `${path}[${i}]`)));
      break;
    case 'string':
      if (typeof value !== 'string') return [`${path}: expected string`];
      if (s.minLength !== undefined && value.length < s.minLength) errors.push(`${path}: too short`);
      if (s.maxLength !== undefined && value.length > s.maxLength) errors.push(`${path}: too long`);
      if (s.pattern && !new RegExp(s.pattern).test(value)) errors.push(`${path}: ${value} does not match ${s.pattern}`);
      if (s.format === 'date-time' && Number.isNaN(Date.parse(value))) errors.push(`${path}: not a date-time`);
      break;
    case 'integer':
    case 'number':
      if (typeof value !== 'number' || (s.type === 'integer' && !Number.isInteger(value))) return [`${path}: expected ${s.type}`];
      if (s.minimum !== undefined && value < s.minimum) errors.push(`${path}: below minimum`);
      if (s.maximum !== undefined && value > s.maximum) errors.push(`${path}: above maximum`);
      break;
    case 'boolean':
      if (typeof value !== 'boolean') return [`${path}: expected boolean`];
      break;
    default:
  }
  return errors;
}

function expectSchema(path: string, method: string, status: number, body: any) {
  const schema = spec.paths[path]?.[method]?.responses?.[String(status)]?.content?.['application/json']?.schema;
  expect(schema, `${method} ${path} ${status} has a schema`).toBeTruthy();
  expect(validate(schema, body)).toEqual([]);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type Machine = { name: string; machineId: string; port: number; url: string; token: string; readOnlyToken: string };
let sim: Awaited<ReturnType<typeof startSimulator>>;
let workstation: Machine, laptop: Machine, buildbox: Machine;
let counter = 0;
const requestId = () => `req${String(++counter).padStart(6, '0')}abcdefghij`;

async function call(m: Machine, path: string, init: { method?: string; body?: any; token?: string | null; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...init.headers };
  const token = init.token === undefined ? m.token : init.token;
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${m.url}/api/v1${path}`, { method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'), headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined });
  return { status: res.status, body: (await res.json()) as any };
}
const projectsOf = async (m: Machine) => (await call(m, '/projects')).body.items as any[];
const projectNamed = async (m: Machine, name: string) => (await projectsOf(m)).find((p) => p.name === name);
const roadmapOf = async (m: Machine, projectId: string) => (await call(m, `/projects/${projectId}/roadmap`)).body.roadmap;
const comparable = (rm: any) => ({ overview: rm.overview, plans: rm.plans, backlog: rm.backlog, pastudioImports: rm.pastudioImports });
const allSteps = (steps: any[]): any[] => steps.flatMap((s) => [s, ...allSteps(s.children)]);
const findStep = (rm: any, text: string) => rm.plans.flatMap((p: any) => allSteps(p.steps).map((s) => ({ plan: p, step: s }))).find((x: any) => x.step.text.includes(text));

/** Read an SSE stream until it ends. onEvent may act on events (for example answer a question). */
async function readSse(m: Machine, runId: string, opts: { after?: number; header?: number; onEvent?: (event: any) => void | Promise<void> } = {}) {
  const headers: Record<string, string> = { authorization: `Bearer ${m.token}` };
  if (opts.header !== undefined) headers['last-event-id'] = String(opts.header);
  const res = await fetch(`${m.url}/api/v1/runs/${runId}/events${opts.after !== undefined ? `?after=${opts.after}` : ''}`, { headers });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: any[] = [];
  const raw: string[] = [];
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index: number;
    while ((index = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      raw.push(frame);
      const data = frame.split('\n').find((line) => line.startsWith('data: '));
      if (data) {
        const event = JSON.parse(data.slice(6));
        events.push(event);
        await opts.onEvent?.(event);
      }
    }
  }
  return { events, raw };
}

async function startWork(m: Machine, projectId: string, target: any, extra: any = {}) {
  const rm = await roadmapOf(m, projectId);
  return call(m, `/projects/${projectId}/roadmap/work`, { body: { requestId: requestId(), expectedRevision: rm.revision, targets: [target], ...extra } });
}
const waitRun = async (m: Machine, runId: string) => {
  const { events } = await readSse(m, runId);
  return { events, run: (await call(m, `/runs/${runId}`)).body };
};

beforeAll(async () => {
  sim = await startSimulator({ basePort: 0, speed: 25 });
  [workstation, laptop, buildbox] = sim.machines as Machine[];
});
afterAll(async () => {
  await sim.close();
});
beforeEach(() => {
  sim.control.reset();
});

// ---------------------------------------------------------------------------
describe('identity, auth and schemas', () => {
  it('starts three machines on their own ports with fixed ids', () => {
    expect(sim.machines.map((m) => m.name)).toEqual(['Workstation', 'Laptop', 'Buildbox']);
    expect(new Set(sim.machines.map((m) => m.port)).size).toBe(3);
    expect(new Set(sim.machines.map((m) => m.machineId)).size).toBe(3);
    expect(sim.machines.map((m) => m.token)).toEqual(['sim-workstation-token', 'sim-laptop-token', 'sim-buildbox-token']);
  });

  it('answers 401 api_unauthorized without a valid token', async () => {
    for (const token of [null, 'nope', laptop.token]) {
      const r = await call(workstation, '/machine', { token });
      expect(r.status).toBe(401);
      expect(r.body.code).toBe('api_unauthorized');
      expectSchema('/api/v1/machine', 'get', 401, r.body);
    }
    expect((await call(workstation, '/projects', { token: null })).status).toBe(401);
  });

  it('answers 403 insufficient_scope for a read-only token', async () => {
    const r = await call(workstation, '/projects/x/runs', { body: {}, token: workstation.readOnlyToken });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('insufficient_scope');
  });

  it('refuses a browser Origin like Studio', async () => {
    const res = await fetch(`${workstation.url}/api/v1/machine`, { headers: { authorization: `Bearer ${workstation.token}`, origin: 'http://evil.example' } });
    expect(res.status).toBe(403);
  });

  it('GET /machine, /sync, /projects, /models, sessions and messages match the schemas', async () => {
    for (const m of sim.machines as Machine[]) {
      const machine = await call(m, '/machine');
      expect(machine.status).toBe(200);
      expect(machine.body.machineId).toBe(m.machineId);
      expect(machine.body.name).toBe(m.name);
      expectSchema('/api/v1/machine', 'get', 200, machine.body);
      const sync = await call(m, '/sync');
      expectSchema('/api/v1/sync', 'get', 200, sync.body);
      const projects = await call(m, '/projects');
      expectSchema('/api/v1/projects', 'get', 200, projects.body);
      for (const p of projects.body.items) {
        expect(p.id).toMatch(/^p_[0-9a-f]{32}$/);
        expect(p.machineId).toBe(m.machineId);
        const sessions = await call(m, `/projects/${p.id}/sessions`);
        expectSchema('/api/v1/projects/{projectId}/sessions', 'get', 200, sessions.body);
        expect(sessions.body.items.length).toBeGreaterThan(0);
        const messages = await call(m, `/sessions/${sessions.body.items[0].id}/messages`);
        expectSchema('/api/v1/sessions/{sessionId}/messages', 'get', 200, messages.body);
        expect(messages.body.items.length).toBeGreaterThan(0);
        const roadmap = await call(m, `/projects/${p.id}/roadmap`);
        expectSchema('/api/v1/projects/{projectId}/roadmap', 'get', 200, roadmap.body);
      }
    }
    expectSchema('/api/v1/models', 'get', 200, (await call(workstation, '/models')).body);
  });

  it('paginates with limit and offset and rejects bad queries', async () => {
    const first = await call(workstation, '/projects?limit=1');
    expect(first.body.items).toHaveLength(1);
    expect(first.body.nextOffset).toBe(1);
    const second = await call(workstation, '/projects?limit=1&offset=1');
    expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
    expect(second.body.nextOffset).toBeNull();
    expect((await call(workstation, '/projects?limit=0')).body.code).toBe('invalid_query');
    expect((await call(workstation, '/projects?foo=1')).status).toBe(400);
    expect((await call(workstation, '/nothing')).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe('projects and sync', () => {
  it('shares the syncId of a project across machines, never by id', async () => {
    const [nd, nv, nm] = await Promise.all([workstation, laptop, buildbox].map((m) => projectNamed(m, 'Nimbus API')));
    expect(nd.syncId).toBeTruthy();
    expect(nv.syncId).toBe(nd.syncId);
    expect(nm.syncId).toBe(nd.syncId);
    expect(new Set([nd.id, nv.id, nm.id]).size).toBe(3);
    const [od, ov] = await Promise.all([workstation, laptop].map((m) => projectNamed(m, 'Orbit Web')));
    expect(od.syncId).toBe(ov.syncId);
    expect(await projectNamed(buildbox, 'Orbit Web')).toBeUndefined();
    const atlas = await projectNamed(buildbox, 'Atlas Mobile');
    expect(atlas.syncId).toBeNull();
    expect(await projectNamed(workstation, 'Atlas Mobile')).toBeUndefined();
  });

  it('seeds a Roadmap with done steps, completions, nested steps and a Laptop copy that is behind', async () => {
    const nd = await projectNamed(workstation, 'Nimbus API');
    const nv = await projectNamed(laptop, 'Nimbus API');
    const rd = await roadmapOf(workstation, nd.id);
    const rv = await roadmapOf(laptop, nv.id);
    expect(rd.initialized).toBe(true);
    expect(rd.plans).toHaveLength(3);
    expect(rd.overview.milestones).toHaveLength(1);
    expect(rd.backlog.items).toHaveLength(3);
    expect(rd.plans.every((p: any) => p.steps.length >= 3 && p.steps.length <= 6)).toBe(true);
    expect(rd.plans.some((p: any) => p.steps.some((s: any) => s.children.length))).toBe(true);
    for (const { step } of rd.plans.flatMap((p: any) => allSteps(p.steps).map((step) => ({ step })))) {
      expect(step).toHaveProperty('completion');
      if (step.done && !step.children.length) expect(step.completion).toMatchObject({ machineId: workstation.machineId });
    }
    expect(rv.lastEdit.at).toBeLessThan(rd.lastEdit.at);
    expect(rv.progress.done).toBe(rd.progress.done - 1);
    expect(comparable(rv)).not.toEqual(comparable(rd));
    expect(rd.activity).toEqual([]);
    expect(rd.instanceId).toBeTruthy();
  });

  it('a full sync makes the copies of Nimbus API equal on the three machines that share it', async () => {
    const [nd, nv, nm] = await Promise.all([workstation, laptop, buildbox].map((m) => projectNamed(m, 'Nimbus API')));
    const before = await roadmapOf(laptop, nv.id);
    const started = Date.now();
    const sync = await call(laptop, `/projects/${nv.id}/sync`, { body: {} });
    expect(sync.status).toBe(200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(5);
    expectSchema('/api/v1/projects/{projectId}/sync', 'post', 200, sync.body);
    expect(sync.body).toMatchObject({ machineId: laptop.machineId, projectId: nv.id, scope: 'all' });
    expect(sync.body.lastSync).toMatchObject({ ok: true });
    expect(sync.body.lastSync.received).toBeGreaterThan(0);
    expect((await call(laptop, '/sync')).body.lastSync).toEqual(sync.body.lastSync);
    const after = await roadmapOf(laptop, nv.id);
    expect(after.revision).toBe(before.revision + 1);
    expect(comparable(after)).toEqual(comparable(await roadmapOf(workstation, nd.id)));
    // The Buildbox copy has no sync configured and stays as it was (it already equals the bucket).
    expect(comparable(after)).toEqual(comparable(await roadmapOf(buildbox, nm.id)));
    // A second sync changes nothing.
    await call(laptop, `/projects/${nv.id}/sync`, { body: {} });
    expect((await roadmapOf(laptop, nv.id)).revision).toBe(after.revision);
  });

  it('sync of one conversation reports its state', async () => {
    const nv = await projectNamed(laptop, 'Nimbus API');
    const nd = await projectNamed(workstation, 'Nimbus API');
    const remoteSession = (await call(workstation, `/projects/${nd.id}/sessions`)).body.items.find((s: any) => s.title.includes('Redis'));
    const r = await call(laptop, `/projects/${nv.id}/sync`, { body: { sessionId: remoteSession.id } });
    expect(r.status).toBe(200);
    expectSchema('/api/v1/projects/{projectId}/sync', 'post', 200, r.body);
    expect(r.body).toMatchObject({ scope: 'session', sessionId: remoteSession.id, state: 'synced' });
    expect((await call(laptop, `/sessions/${remoteSession.id}/messages`)).status).toBe(200);
    expect((await call(laptop, `/projects/${nv.id}/sync`, { body: { sessionId: 'unknown-session' } })).status).toBe(404);
  });

  it('Buildbox has no sync configured', async () => {
    const sync = await call(buildbox, '/sync');
    expect(sync.body).toMatchObject({ configured: false, running: false, lastSync: null });
    const nm = await projectNamed(buildbox, 'Nimbus API');
    const r = await call(buildbox, `/projects/${nm.id}/sync`, { body: {} });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('sync_not_configured');
    expectSchema('/api/v1/projects/{projectId}/sync', 'post', 409, r.body);
  });

  it('a bucket outage answers 502 sync_failed', async () => {
    const nv = await projectNamed(laptop, 'Nimbus API');
    await fetch(`${workstation.url}/__sim/bucket`, { method: 'POST', body: JSON.stringify({ down: true }) });
    const r = await call(laptop, `/projects/${nv.id}/sync`, { body: {} });
    expect(r.status).toBe(502);
    expect(r.body.code).toBe('sync_failed');
  });
});

// ---------------------------------------------------------------------------
describe('Roadmap mutations', () => {
  it('step.check stamps the completion and bumps the revision', async () => {
    const nv = await projectNamed(laptop, 'Nimbus API');
    const rm = await roadmapOf(laptop, nv.id);
    const { plan, step } = findStep(rm, 'Implement the Redis-backed limiter');
    expect(step.done).toBe(false);
    const r = await call(laptop, `/projects/${nv.id}/roadmap/mutations`, { body: { action: 'step.check', expectedRevision: rm.revision, planId: plan.id, stepId: step.id, done: true } });
    expect(r.status).toBe(200);
    expectSchema('/api/v1/projects/{projectId}/roadmap', 'get', 200, r.body);
    expect(r.body.roadmap.revision).toBe(rm.revision + 1);
    const after = findStep(r.body.roadmap, 'Implement the Redis-backed limiter');
    expect(after.step.done).toBe(true);
    expect(after.step.completion).toMatchObject({ machineId: laptop.machineId, sessionId: null });
    expect(after.step.completion.completedAt).toBeGreaterThan(0);
    expect(after.plan.updatedAt).toBeGreaterThan(plan.updatedAt);
    expect(r.body.roadmap.lastEdit.at).toBeGreaterThan(rm.lastEdit.at);
    // Reopen clears the completion.
    const reopen = await call(laptop, `/projects/${nv.id}/roadmap/mutations`, { body: { action: 'step.check', expectedRevision: r.body.roadmap.revision, planId: plan.id, stepId: step.id, done: false } });
    expect(findStep(reopen.body.roadmap, 'Implement the Redis-backed limiter').step.completion).toBeNull();
  });

  it('answers 409 roadmap_conflict with currentRevision, 400 for unknown actions, 404 roadmap_missing', async () => {
    const nd = await projectNamed(workstation, 'Nimbus API');
    const rm = await roadmapOf(workstation, nd.id);
    const stale = await call(workstation, `/projects/${nd.id}/roadmap/mutations`, { body: { action: 'journal.add', expectedRevision: rm.revision - 1, planId: rm.plans[0].id, text: 'x' } });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'roadmap_conflict', currentRevision: rm.revision });
    expectSchema('/api/v1/projects/{projectId}/roadmap/mutations', 'post', 409, stale.body);
    expect((await call(workstation, `/projects/${nd.id}/roadmap/mutations`, { body: { action: 'plan.explode', expectedRevision: rm.revision } })).status).toBe(400);
    const gone = await call(workstation, `/projects/${nd.id}/roadmap/mutations`, { body: { action: 'step.edit', expectedRevision: rm.revision, planId: rm.plans[0].id, stepId: 'step-nope', text: 'x' } });
    expect(gone.status).toBe(404);
    expect(gone.body.code).toBe('roadmap_missing');
    const forged = await call(workstation, `/projects/${nd.id}/roadmap/mutations`, { body: { action: 'plan.create', expectedRevision: rm.revision, title: 'X', steps: [{ text: 'a', completion: null }] } });
    expect(forged.status).toBe(400);
  });

  it('supports step.add, step.edit, step.remove, plan.create, plan.patch, journal.add, backlog.add and backlog.set', async () => {
    const nd = await projectNamed(workstation, 'Nimbus API');
    const post = async (body: any) => {
      const rm = await roadmapOf(workstation, nd.id);
      const r = await call(workstation, `/projects/${nd.id}/roadmap/mutations`, { body: { expectedRevision: rm.revision, ...body } });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.roadmap.revision).toBe(rm.revision + 1);
      return r.body.roadmap;
    };
    let rm = await post({ action: 'plan.create', title: 'Webhooks', summary: 'Retries and signatures', color: '#db2777', steps: [{ text: 'Sign payloads' }, { text: 'Retry with backoff', children: [{ text: 'Exponential delay' }] }] });
    const plan = rm.plans.at(-1);
    expect(plan).toMatchObject({ title: 'Webhooks', color: '#db2777', status: 'active', archived: false });
    expect(plan.steps).toHaveLength(2);
    rm = await post({ action: 'step.add', planId: plan.id, text: 'Document the headers' });
    const added = rm.plans.at(-1).steps.at(-1);
    expect(added).toMatchObject({ text: 'Document the headers', done: false, completion: null });
    rm = await post({ action: 'step.edit', planId: plan.id, stepId: added.id, text: 'Document the webhook headers', note: 'Include the signature.' });
    expect(rm.plans.at(-1).steps.at(-1)).toMatchObject({ text: 'Document the webhook headers', note: 'Include the signature.' });
    rm = await post({ action: 'journal.add', planId: plan.id, text: 'Kicked off.' });
    expect(rm.plans.at(-1).journal.at(-1)).toMatchObject({ text: 'Kicked off.', by: 'user' });
    rm = await post({ action: 'plan.patch', planId: plan.id, status: 'paused' });
    expect(rm.plans.at(-1).status).toBe('paused');
    rm = await post({ action: 'step.remove', planId: plan.id, stepId: added.id });
    expect(rm.plans.at(-1).steps).toHaveLength(2);
    rm = await post({ action: 'backlog.add', items: [{ text: 'Status page' }], notes: [{ text: 'Ask support' }] });
    const entry = rm.backlog.items.at(-1);
    expect(entry).toMatchObject({ text: 'Status page', done: false });
    expect(rm.backlog.notes.at(-1).text).toBe('Ask support');
    rm = await post({ action: 'backlog.set', numbers: [entry.number], done: true });
    expect(rm.backlog.items.at(-1).done).toBe(true);
    expect(rm.backlog.nextNumber).toBeGreaterThan(entry.number);
  });
});

// ---------------------------------------------------------------------------
describe('Roadmap work and runs', () => {
  it('happy path: accepts, streams events, checks the step in the local copy only', async () => {
    const nv = await projectNamed(laptop, 'Nimbus API');
    const nd = await projectNamed(workstation, 'Nimbus API');
    const before = await roadmapOf(laptop, nv.id);
    const { plan, step } = findStep(before, 'Implement the Redis-backed limiter');
    const accept = await startWork(laptop, nv.id, { kind: 'plan', planId: plan.id, stepId: step.id }, { instructions: 'Run git pull first.' });
    expect(accept.status, JSON.stringify(accept.body)).toBe(201);
    expectSchema('/api/v1/projects/{projectId}/roadmap/work', 'post', 201, accept.body);
    expect(accept.body).toMatchObject({ accepted: true, queued: false, machineId: laptop.machineId, projectId: nv.id });
    expect(accept.body.run).toMatchObject({ status: 'running', machineId: laptop.machineId, projectId: nv.id, requestId: expect.any(String) });
    expect(accept.body.sessionId).toBeTruthy();
    // Session linked to the plan, revision + 1.
    expect(accept.body.roadmap.revision).toBe(before.revision + 1);
    expect(accept.body.roadmap.plans.find((p: any) => p.id === plan.id).sessions).toContain(accept.body.sessionId);
    const runId = accept.body.run.id;
    expect((await call(laptop, '/runs')).body.items.some((r: any) => r.id === runId && r.requestId === accept.body.requestId)).toBe(true);

    let activity: any[] = [];
    const { events, raw } = await readSse(laptop, runId, {
      onEvent: async (event) => {
        if (event.kind === 'tool_end' && event.name === 'roadmap_work') activity = (await roadmapOf(laptop, nv.id)).activity;
      },
    });
    expect(raw[0]).toBe(': connected');
    const kinds = events.map((e) => e.kind);
    expect(kinds[0]).toBe('session');
    for (const kind of ['message_start', 'text', 'tool_start', 'tool_end', 'message']) expect(kinds).toContain(kind);
    expect(kinds.at(-1)).toBe('done');
    expect(events.at(-1)).toMatchObject({ status: 'completed', code: 0 });
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    expect(events.every((e) => e.runId === runId && e.machineId === laptop.machineId && e.projectId === nv.id)).toBe(true);
    for (const event of events) expect(validate({ $ref: '#/components/schemas/RunEvent' }, event)).toEqual([]);
    const toolNames = events.filter((e) => e.kind === 'tool_start').map((e) => e.name);
    expect(toolNames).toEqual(expect.arrayContaining(['roadmap_read', 'read', 'edit', 'bash']));
    expect(events.filter((e) => e.kind === 'text').length).toBeGreaterThan(3);
    // Activity was visible while the agent worked.
    expect(activity).toEqual([expect.objectContaining({ sessionId: accept.body.sessionId, rootSessionId: accept.body.sessionId, name: 'Prime Agent', targets: [{ kind: 'plan', planId: plan.id, stepId: step.id }] })]);

    const finished = (await call(laptop, `/runs/${runId}`)).body;
    expectSchema('/api/v1/runs/{runId}', 'get', 200, finished);
    expect(finished).toMatchObject({ status: 'completed', error: null, sessionId: accept.body.sessionId });
    expect(finished.endedAt).toBeTruthy();

    const after = await roadmapOf(laptop, nv.id);
    expect(after.activity).toEqual([]);
    expect(after.revision).toBe(before.revision + 2);
    const checked = findStep(after, 'Implement the Redis-backed limiter').step;
    expect(checked.done).toBe(true);
    expect(checked.completion).toMatchObject({ machineId: laptop.machineId, sessionId: accept.body.sessionId });
    // The run never syncs by itself: the other machines are untouched.
    expect(findStep(await roadmapOf(workstation, nd.id), 'Implement the Redis-backed limiter').step.completion.machineId).toBe(workstation.machineId);
    // The conversation has the agent's final message.
    const messages = (await call(laptop, `/sessions/${accept.body.sessionId}/messages`)).body;
    expect(messages.items.map((m: any) => m.role)).toEqual(['user', 'assistant']);
  });

  it('replays events after a cursor (query and Last-Event-ID) and ends when the run is finished', async () => {
    const nd = await projectNamed(workstation, 'Orbit Web');
    const rm = await roadmapOf(workstation, nd.id);
    const accept = await startWork(workstation, nd.id, { kind: 'plan', planId: rm.plans[0].id, stepId: rm.plans[0].steps[1].id });
    const runId = accept.body.run.id;
    const { events } = await waitRun(workstation, runId);
    const total = events.length;
    const viaQuery = await readSse(workstation, runId, { after: total - 2 });
    expect(viaQuery.events.map((e) => e.seq)).toEqual([total - 1, total]);
    const viaHeader = await readSse(workstation, runId, { header: total - 1 });
    expect(viaHeader.events.map((e) => e.seq)).toEqual([total]);
    expect((await call(workstation, `/runs/${runId}/events?after=abc`)).status).toBe(400);
  });

  it('answers 409 roadmap_conflict with currentRevision for a stale expectedRevision', async () => {
    const nd = await projectNamed(workstation, 'Nimbus API');
    const rm = await roadmapOf(workstation, nd.id);
    const r = await call(workstation, `/projects/${nd.id}/roadmap/work`, { body: { requestId: requestId(), expectedRevision: rm.revision - 1, targets: [{ kind: 'plan', planId: rm.plans[0].id }] } });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'roadmap_conflict', currentRevision: rm.revision });
    expectSchema('/api/v1/projects/{projectId}/roadmap/work', 'post', 409, r.body);
    expect((await call(workstation, '/runs')).body.items).toHaveLength(0);
  });

  it('answers 404 roadmap_missing for an unknown plan or step and 400 for a bad request', async () => {
    const nd = await projectNamed(workstation, 'Nimbus API');
    const rm = await roadmapOf(workstation, nd.id);
    const base = { requestId: requestId(), expectedRevision: rm.revision };
    const plan = await call(workstation, `/projects/${nd.id}/roadmap/work`, { body: { ...base, targets: [{ kind: 'plan', planId: 'plan-nope' }] } });
    expect(plan.status).toBe(404);
    expect(plan.body.code).toBe('roadmap_missing');
    const step = await call(workstation, `/projects/${nd.id}/roadmap/work`, { body: { ...base, requestId: requestId(), targets: [{ kind: 'plan', planId: rm.plans[0].id, stepId: 'step-nope' }] } });
    expect(step.body.code).toBe('roadmap_missing');
    expect((await call(workstation, `/projects/${nd.id}/roadmap/work`, { body: { ...base, requestId: 'short', targets: [{ kind: 'plan', planId: rm.plans[0].id }] } })).status).toBe(400);
    expect((await call(workstation, `/projects/${nd.id}/roadmap/work`, { body: { ...base, requestId: requestId(), targets: [] } })).status).toBe(400);
  });

  it('is idempotent by requestId for an hour and caches failures', async () => {
    const nd = await projectNamed(workstation, 'Nimbus API');
    const rm = await roadmapOf(workstation, nd.id);
    const body = { requestId: requestId(), expectedRevision: rm.revision, targets: [{ kind: 'plan', planId: rm.plans[2].id, stepId: rm.plans[2].steps[1].id }] };
    const first = await call(workstation, `/projects/${nd.id}/roadmap/work`, { body });
    const again = await call(workstation, `/projects/${nd.id}/roadmap/work`, { body });
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
    expect((await call(workstation, '/runs')).body.items).toHaveLength(1);
    const different = await call(workstation, `/projects/${nd.id}/roadmap/work`, { body: { ...body, instructions: 'other' } });
    expect(different.status).toBe(409);
    expect(different.body.code).toBe('request_conflict');
    // A cached failure is returned again, even though the revision matches later.
    const bad = { requestId: requestId(), expectedRevision: 999, targets: body.targets };
    const f1 = await call(workstation, `/projects/${nd.id}/roadmap/work`, { body: bad });
    const f2 = await call(workstation, `/projects/${nd.id}/roadmap/work`, { body: bad });
    expect(f1.status).toBe(409);
    expect(f2).toEqual(f1);
    await waitRun(workstation, first.body.run.id);
  });

  it('[ask] emits an interaction, waits for the answer, then continues', async () => {
    const nd = await projectNamed(workstation, 'Nimbus API');
    let rm = await roadmapOf(workstation, nd.id);
    const added = await call(workstation, `/projects/${nd.id}/roadmap/mutations`, { body: { action: 'step.add', expectedRevision: rm.revision, planId: rm.plans[2].id, text: 'Pick the theme [ASK]' } });
    rm = added.body.roadmap;
    const step = rm.plans[2].steps.at(-1);
    const accept = await startWork(workstation, nd.id, { kind: 'plan', planId: rm.plans[2].id, stepId: step.id });
    const runId = accept.body.run.id;
    let pending: any = null;
    let answered: any = null;
    const { events } = await readSse(workstation, runId, {
      onEvent: async (event) => {
        if (event.kind !== 'interaction' || event.request.status !== 'pending') return;
        pending = event.request;
        const live = (await call(workstation, `/runs/${runId}`)).body;
        expect(live.interactions).toHaveLength(1);
        expect(live.interactions[0]).toMatchObject({ id: pending.id, status: 'pending' });
        answered = await call(workstation, `/runs/${runId}/interactions`, { body: { id: pending.id, response: { value: pending.options[0] } } });
      },
    });
    expect(pending).toMatchObject({ method: 'select', allowCustom: true, status: 'pending' });
    expect(pending.options.length).toBeGreaterThan(1);
    expect(pending.title).toBeTruthy();
    expect(answered.status).toBe(200);
    const interactionEvents = events.filter((e) => e.kind === 'interaction');
    expect(interactionEvents.map((e) => e.request.status)).toEqual(['pending', 'answered']);
    expect(events.at(-1)).toMatchObject({ kind: 'done', status: 'completed' });
    const run = (await call(workstation, `/runs/${runId}`)).body;
    expectSchema('/api/v1/runs/{runId}', 'get', 200, run);
    expect(run.interactions[0].status).toBe('answered');
    // Answering again is refused.
    expect((await call(workstation, `/runs/${runId}/interactions`, { body: { id: pending.id, response: { value: 'x' } } })).status).toBe(409);
    expect(findStep(await roadmapOf(workstation, nd.id), 'Pick the theme').step.done).toBe(true);
  });

  it('POST /runs/{id}/stop ends the run as stopped without checking the step', async () => {
    const nd = await projectNamed(workstation, 'Nimbus API');
    const rm = await roadmapOf(workstation, nd.id);
    const { plan, step } = findStep(rm, 'Publish a preview environment');
    sim.control.setScenario('Workstation', 'slow');
    const accept = await startWork(workstation, nd.id, { kind: 'plan', planId: plan.id, stepId: step.id });
    const runId = accept.body.run.id;
    const reading = readSse(workstation, runId);
    await new Promise((r) => setTimeout(r, 120));
    const stop = await call(workstation, `/runs/${runId}/stop`, { body: {} });
    expect(stop.status).toBe(200);
    expectSchema('/api/v1/runs/{runId}/stop', 'post', 200, stop.body);
    expect(stop.body.stopped).toBe(true);
    const { events } = await reading;
    expect(events.at(-1)).toMatchObject({ kind: 'done', status: 'stopped' });
    const run = (await call(workstation, `/runs/${runId}`)).body;
    expect(run.status).toBe('stopped');
    const after = await roadmapOf(workstation, nd.id);
    expect(findStep(after, 'Publish a preview environment').step.done).toBe(false);
    expect(after.activity).toEqual([]);
  });

  it('[fail] and [nocheck] scenarios, by marker or by the control API', async () => {
    const nd = await projectNamed(workstation, 'Orbit Web');
    const rm = await roadmapOf(workstation, nd.id);
    const plan = rm.plans[0];
    // By control API (next run only).
    await fetch(`${laptop.url}/__sim/scenario`, { method: 'POST', body: JSON.stringify({ machine: 'Workstation', mode: 'fail' }) });
    const failed = await startWork(workstation, nd.id, { kind: 'plan', planId: plan.id, stepId: plan.steps[1].id });
    const r1 = await waitRun(workstation, failed.body.run.id);
    expect(r1.events.at(-1)).toMatchObject({ kind: 'done', status: 'failed' });
    expect(r1.events.at(-1).error).toBeTruthy();
    expect(r1.run).toMatchObject({ status: 'failed' });
    expect(r1.run.error).toBeTruthy();
    expect(findStep(await roadmapOf(workstation, nd.id), plan.steps[1].text).step.done).toBe(false);
    // The scenario was one-shot; a marker in the step text works too.
    const marked = await call(workstation, `/projects/${nd.id}/roadmap/mutations`, { body: { action: 'step.add', expectedRevision: (await roadmapOf(workstation, nd.id)).revision, planId: plan.id, text: 'Tidy imports [nocheck]' } });
    const step = marked.body.roadmap.plans[0].steps.at(-1);
    const accepted = await startWork(workstation, nd.id, { kind: 'plan', planId: plan.id, stepId: step.id });
    const r2 = await waitRun(workstation, accepted.body.run.id);
    expect(r2.events.at(-1)).toMatchObject({ kind: 'done', status: 'completed' });
    expect(r2.events.some((e) => e.kind === 'tool_start' && e.name === 'roadmap_check')).toBe(false);
    expect(findStep(await roadmapOf(workstation, nd.id), 'Tidy imports').step.done).toBe(false);
  });

  it('createRun starts a short reply and /sessions/{id}/messages needs an active run', async () => {
    const nd = await projectNamed(workstation, 'Orbit Web');
    const created = await call(workstation, `/projects/${nd.id}/runs`, { body: { requestId: requestId(), message: 'Explain the chart [slow]' } });
    expect(created.status).toBe(201);
    expectSchema('/api/v1/projects/{projectId}/runs', 'post', 201, created.body);
    const runId = created.body.id;
    const sessionId = created.body.sessionId;
    expect(sessionId).toBeTruthy();
    const rmBefore = await roadmapOf(workstation, nd.id);
    const reading = readSse(workstation, runId);
    const sent = await call(workstation, `/sessions/${sessionId}/messages`, { body: { requestId: requestId(), mode: 'steer', message: 'Keep it short.' } });
    expect(sent.status).toBe(200);
    expect(sent.body).toEqual({});
    const { events } = await reading;
    expect(events.at(-1)).toMatchObject({ kind: 'done', status: 'completed' });
    expect((await roadmapOf(workstation, nd.id)).revision).toBe(rmBefore.revision);
    const idle = await call(workstation, `/sessions/${sessionId}/messages`, { body: { requestId: requestId(), mode: 'follow_up', message: 'Again' } });
    expect(idle.status).toBe(409);
  });

  it('end of run flow: sync both machines and the checked step reaches the other copy', async () => {
    const nd = await projectNamed(workstation, 'Nimbus API');
    const nv = await projectNamed(laptop, 'Nimbus API');
    const rm = await roadmapOf(workstation, nd.id);
    const { plan, step } = findStep(rm, 'Expose the X-RateLimit headers');
    const accept = await startWork(workstation, nd.id, { kind: 'plan', planId: plan.id, stepId: step.id });
    await waitRun(workstation, accept.body.run.id);
    await call(workstation, `/projects/${nd.id}/sync`, { body: {} });
    await call(laptop, `/projects/${nv.id}/sync`, { body: {} });
    const onLaptop = findStep(await roadmapOf(laptop, nv.id), 'Expose the X-RateLimit headers').step;
    expect(onLaptop.done).toBe(true);
    expect(onLaptop.completion).toMatchObject({ machineId: workstation.machineId, sessionId: accept.body.sessionId });
    expect(comparable(await roadmapOf(laptop, nv.id))).toEqual(comparable(await roadmapOf(workstation, nd.id)));
  });
});

// ---------------------------------------------------------------------------
describe('control API and heartbeat', () => {
  it('an offline machine breaks its sockets while the others keep answering', async () => {
    const offline = await fetch(`${workstation.url}/__sim/offline`, { method: 'POST', body: JSON.stringify({ machine: 'Laptop', offline: true }) });
    expect(offline.status).toBe(200);
    await expect(call(laptop, '/machine')).rejects.toThrow();
    expect((await call(workstation, '/machine')).status).toBe(200);
    const state = await (await fetch(`${workstation.url}/__sim/state`)).json();
    expect(state.machines.find((m: any) => m.name === 'Laptop').offline).toBe(true);
    await fetch(`${buildbox.url}/__sim/offline`, { method: 'POST', body: JSON.stringify({ machine: 'Laptop', offline: false }) });
    expect((await call(laptop, '/machine')).status).toBe(200);
  });

  it('reset restores the seed', async () => {
    const nd = await projectNamed(workstation, 'Nimbus API');
    const rm = await roadmapOf(workstation, nd.id);
    await call(workstation, `/projects/${nd.id}/roadmap/mutations`, { body: { action: 'vision', expectedRevision: rm.revision, text: 'Changed' } });
    expect((await roadmapOf(workstation, nd.id)).overview.vision).toBe('Changed');
    await fetch(`${workstation.url}/__sim/reset`, { method: 'POST', body: '{}' });
    const fresh = await projectNamed(workstation, 'Nimbus API');
    expect((await roadmapOf(workstation, fresh.id)).overview.vision).not.toBe('Changed');
  });

  it('sends heartbeats on an open stream', async () => {
    const local = await startSimulator({ basePort: 0, speed: 1, heartbeatMs: 50 });
    try {
      const m = local.machines[0] as Machine;
      const p = (await call(m, '/projects')).body.items[0];
      const created = await call(m, `/projects/${p.id}/runs`, { body: { requestId: requestId(), message: 'hello' } });
      const { raw } = await readSse(m, created.body.id);
      expect(raw.some((frame) => frame === ': heartbeat')).toBe(true);
    } finally {
      await local.close();
    }
  });
});
