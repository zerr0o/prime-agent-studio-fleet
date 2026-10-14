import { describe, expect, it } from 'vitest';

import { SseParser } from '../src/api/sse';
import { groupProjects } from '../src/domain/fleet';
import { composeInstructions, DEFAULT_GIT_TEXT, INSTRUCTIONS_LIMIT } from '../src/domain/instructions';
import {
  assignTask,
  autoLayout,
  connect,
  conversationSource,
  disconnect,
  emptyPipeline,
  evaluate,
  nextToLaunch,
  nodeIdFor,
  readTask,
  requestIdFor,
  requestPrefix,
  setConversation,
  updateNode,
  wouldCycle,
} from '../src/domain/pipeline';
import { fingerprint } from '../src/domain/roadmap';
import { copyFrom, memberStatuses } from '../src/domain/syncStatus';
import type { RoadmapDocument, RoadmapStep } from '../src/api/types';
import type { FleetProject, MachineConfig, MachineRuntime, Pipeline, RoadmapCopy } from '../src/domain/types';

const machine = (key: string): MachineConfig => ({ key, label: key, baseUrl: 'http://127.0.0.1:3088', color: '#0891b2', addedAt: 0 });
const step = (id: string, done = false, children: RoadmapStep[] = []): RoadmapStep => ({
  id,
  text: `Task ${id}`,
  done,
  completion: done ? { machineId: 'm-a', sessionId: 's1', completedAt: 10 } : null,
  children,
});
const doc = (steps: RoadmapStep[], at: number, revision = 1): RoadmapDocument => ({
  revision,
  lastEdit: { by: 'user', at },
  overview: { vision: 'v', milestones: [] },
  plans: [{ id: 'plan-1', title: 'Plan one', status: 'active', milestone: null, steps, updatedAt: at, color: '#0d9488' }],
  backlog: { items: [], notes: [], nextNumber: 1 },
  pastudioImports: [],
});
const copy = (machineKey: string, d: RoadmapDocument): RoadmapCopy => copyFrom(machineKey, `p-${machineKey}`, d, fingerprint(d), 0);
const online: MachineRuntime = { state: 'online', sync: { machineId: 'x', configured: true, running: false, lastSync: null } };

describe('fleet grouping', () => {
  it('groups by syncId and keeps local projects apart', () => {
    const projects = groupProjects([
      { machine: machine('a'), machineId: 'm-a', projects: [
        { id: 'p1', name: 'Nimbus', syncId: 'S1', exists: true, machineId: 'm-a' },
        { id: 'p2', name: 'Atlas', syncId: null, exists: true, machineId: 'm-a' },
      ] },
      { machine: machine('b'), machineId: 'm-b', projects: [
        { id: 'p9', name: 'nimbus-api', syncId: 'S1', exists: true, machineId: 'm-b' },
        { id: 'p8', name: 'Atlas', syncId: null, exists: true, machineId: 'm-b' },
      ] },
    ]);
    expect(projects.map((p) => p.key)).toEqual(['local:m-a:p2', 'local:m-b:p8', 'sync:S1']);
    const nimbus = projects.find((p) => p.key === 'sync:S1')!;
    expect(nimbus.members.map((m) => m.projectId)).toEqual(['p1', 'p9']);
  });
});

describe('sync status', () => {
  const project: FleetProject = {
    key: 'sync:S1',
    syncId: 'S1',
    name: 'Nimbus',
    members: [
      { machineKey: 'a', machineId: 'm-a', projectId: 'p-a', name: 'Nimbus', exists: true },
      { machineKey: 'b', machineId: 'm-b', projectId: 'p-b', name: 'Nimbus', exists: true },
      { machineKey: 'c', machineId: 'm-c', projectId: 'p-c', name: 'Nimbus', exists: true },
    ],
  };
  it('equal content is synced even with different revisions', () => {
    const statuses = memberStatuses(
      project,
      { a: copy('a', doc([step('s1')], 5, 3)), b: copy('b', doc([step('s1')], 5, 9)), c: copy('c', doc([step('s1')], 5, 1)) },
      { a: online, b: online, c: online },
    );
    expect(statuses).toEqual({ a: 'synced', b: 'synced', c: 'synced' });
  });
  it('newest copy is latest, older ones are behind, offline stays offline', () => {
    const statuses = memberStatuses(
      project,
      { a: copy('a', doc([step('s1', true)], 9)), b: copy('b', doc([step('s1')], 5)) },
      { a: online, b: online, c: { state: 'offline' } },
    );
    expect(statuses).toEqual({ a: 'latest', b: 'behind', c: 'offline' });
  });
  it('a Studio without R2 sync is reported as sync-off', () => {
    const statuses = memberStatuses(
      project,
      { a: copy('a', doc([step('s1', true)], 9)), b: copy('b', doc([step('s1')], 5)) },
      { a: online, b: { state: 'online', sync: { machineId: 'm-b', configured: false, running: false, lastSync: null } } },
    );
    expect(statuses.b).toBe('sync-off');
  });
});

describe('pipeline', () => {
  const project: FleetProject = {
    key: 'sync:S1',
    syncId: 'S1',
    name: 'Nimbus',
    members: [
      { machineKey: 'a', machineId: 'm-a', projectId: 'p-a', name: 'Nimbus', exists: true },
      { machineKey: 'b', machineId: 'm-b', projectId: 'p-b', name: 'Nimbus', exists: true },
    ],
  };
  const ref = (id: string) => ({ kind: 'step' as const, planId: 'plan-1', stepId: id });
  let p = emptyPipeline('sync:S1', DEFAULT_GIT_TEXT.fr, 0);
  p = assignTask(p, ref('s1'), 'm-a', 1);
  p = assignTask(p, ref('s2'), 'm-b', 1);
  p = assignTask(p, ref('s3'), 'm-a', 1);
  p = connect(p, 'step:s1', 'step:s2', 2).pipeline;
  p = connect(p, 'step:s2', 'step:s3', 2).pipeline;

  it('refuses cycles, self links and duplicates', () => {
    expect(connect(p, 'step:s3', 'step:s1', 3).error).toBe('cycle');
    expect(connect(p, 'step:s1', 'step:s1', 3).error).toBe('self');
    expect(connect(p, 'step:s1', 'step:s2', 3).error).toBe('exists');
    expect(wouldCycle(p.edges, 'step:s3', 'step:s1')).toBe(true);
  });

  it('chains: only the first task is ready, then the next one after the check', () => {
    const before = evaluate({ pipeline: p, project, copies: { a: copy('a', doc([step('s1'), step('s2'), step('s3')], 1)) }, runtimes: { a: online, b: online }, activeRuns: [] });
    expect(before['step:s1'].state).toBe('ready');
    expect(before['step:s2'].state).toBe('waiting');
    expect(nextToLaunch(p, before).map((n) => n.id)).toEqual(['step:s1']);

    const after = evaluate({ pipeline: p, project, copies: { a: copy('a', doc([step('s1', true), step('s2'), step('s3')], 2)) }, runtimes: { a: online, b: online }, activeRuns: [] });
    expect(after['step:s1'].state).toBe('done');
    expect(after['step:s2'].state).toBe('ready');
    expect(after['step:s3'].state).toBe('waiting');
  });

  it('a completed run without check is review and blocks the chain', () => {
    const withRun = { ...p, nodes: p.nodes.map((n) => (n.id === 'step:s1' ? { ...n, lastRun: { machineId: 'm-a', runId: 'r1', requestId: 'x', sessionId: null, status: 'completed', startedAt: '' } } : n)) };
    const result = evaluate({ pipeline: withRun, project, copies: { a: copy('a', doc([step('s1'), step('s2'), step('s3')], 1)) }, runtimes: { a: online, b: online }, activeRuns: [] });
    expect(result['step:s1'].state).toBe('review');
    expect(result['step:s2'].state).toBe('waiting');
    expect(nextToLaunch(withRun, result)).toEqual([]);
  });

  it('offline machine and busy machine', () => {
    const offline = evaluate({ pipeline: p, project, copies: { a: copy('a', doc([step('s1')], 1)) }, runtimes: { a: { state: 'offline' }, b: online }, activeRuns: [] });
    expect(offline['step:s1'].state).toBe('offline');
    const busy = evaluate({
      pipeline: p,
      project,
      copies: { a: copy('a', doc([step('s1')], 1)) },
      runtimes: { a: online, b: online },
      activeRuns: [{ id: 'r', sessionId: null, projectId: 'p-a', machineId: 'm-a', status: 'running', startedAt: '', model: null, thinking: null, allowQuestions: false, interactions: [] }],
    });
    expect(busy['step:s1'].state).toBe('queued');
  });

  it('a done task found on any machine counts as done', () => {
    const result = evaluate({
      pipeline: p,
      project,
      copies: { a: copy('a', doc([step('s1'), step('s2'), step('s3')], 1)), b: copy('b', doc([step('s1', true), step('s2'), step('s3')], 3)) },
      runtimes: { a: online, b: online },
      activeRuns: [],
    });
    expect(result['step:s1'].state).toBe('done');
    expect(result['step:s1'].doneIn).toEqual(['b']);
  });

  it('layout puts nodes in dependency columns', () => {
    const laid = autoLayout(p, 5);
    const x = Object.fromEntries(laid.nodes.map((n) => [n.id, n.x]));
    expect(x['step:s1']).toBeLessThan(x['step:s2']);
    expect(x['step:s2']).toBeLessThan(x['step:s3']);
  });

  it('request ids are stable per attempt and valid for Studio', () => {
    const prefix = requestPrefix('sync:S1', nodeIdFor(ref('s1')), 0);
    expect(prefix).toBe(requestPrefix('sync:S1', 'step:s1', 0));
    expect(prefix).not.toBe(requestPrefix('sync:S1', 'step:s1', 1));
    expect(requestIdFor(prefix, 7)).toMatch(/^[A-Za-z0-9_-]{16,100}$/);
  });
});

describe('instructions', () => {
  it('always asks to check the step and includes git when enabled', () => {
    const text = composeInstructions({
      language: 'fr',
      pipeline: { git: { enabled: true, text: DEFAULT_GIT_TEXT.fr }, extra: 'Reste concis.' },
      ref: { kind: 'step', planId: 'plan-1', stepId: 'step-9' },
      taskTitle: 'Ajouter le cache',
      machineLabel: 'Laptop',
      doneDeps: [{ title: 'Créer le schéma', machine: 'Workstation' }],
    });
    expect(text).toContain('roadmap_check (planId plan-1, stepId step-9)');
    expect(text).toContain('git pull');
    expect(text).toContain('Créer le schéma (Workstation)');
    expect(text).toContain('Reste concis.');
  });
  it('stays within 4 000 characters and keeps the check', () => {
    const text = composeInstructions({
      language: 'en',
      pipeline: { git: { enabled: false, text: '' }, extra: 'x'.repeat(9000) },
      ref: { kind: 'backlog', number: 4 },
      taskTitle: 'Backlog',
      machineLabel: 'Buildbox',
      doneDeps: [],
    });
    expect(text.length).toBeLessThanOrEqual(INSTRUCTIONS_LIMIT);
    expect(text).toContain('roadmap_backlog');
    expect(text).not.toContain('git pull');
  });
});

describe('sse parser', () => {
  it('parses frames split across chunks and skips comments', () => {
    const parser = new SseParser();
    expect(parser.feed(': connected\n\nid: 1\ndata: {"kind":"te')).toEqual([]);
    const frames = parser.feed('xt","delta":"a"}\n\n: heartbeat\n\nid: 2\r\ndata: {"kind":"done"}\r\n\r\n');
    expect(frames.map((f) => [f.id, JSON.parse(f.data).kind])).toEqual([
      ['1', 'text'],
      ['2', 'done'],
    ]);
  });
});


describe('reading a task across machines', () => {
  const ref = { kind: 'step' as const, planId: 'plan-1', stepId: 's1' };
  it('the newest version of the plan wins, so an uncheck made later is seen', () => {
    const older = copy('a', doc([step('s1', true)], 5));
    const newer = copy('b', doc([step('s1', false)], 9));
    const { task, doneIn } = readTask(ref, { a: older, b: newer });
    expect(task.done).toBe(false);
    expect(doneIn).toEqual(['a']);
  });
  it('a machine without R2 sync does not hide a check made on a synced machine', () => {
    const synced = copy('a', doc([step('s1', true)], 5));
    const isolatedNewer = copy('c', doc([step('s1', false)], 9));
    expect(readTask(ref, { a: synced, c: isolatedNewer }, new Set(['c'])).task.done).toBe(true);
  });
  it('a check made on a machine without R2 sync still counts', () => {
    const synced = copy('a', doc([step('s1', false)], 9));
    const isolatedDone = copy('c', doc([step('s1', true)], 5));
    expect(readTask(ref, { a: synced, c: isolatedDone }, new Set(['c'])).task.done).toBe(true);
  });
  it('a check made on the newest copy is seen before the other machines sync', () => {
    const { task } = readTask(ref, { a: copy('a', doc([step('s1', false)], 5)), b: copy('b', doc([step('s1', true)], 9)) });
    expect(task.done).toBe(true);
  });
});

describe('reopened tasks', () => {
  const project: FleetProject = {
    key: 'sync:S1',
    syncId: 'S1',
    name: 'Nimbus',
    members: [{ machineKey: 'a', machineId: 'm-a', projectId: 'p-a', name: 'Nimbus', exists: true }],
  };
  const ref = { kind: 'step' as const, planId: 'plan-1', stepId: 's1' };
  const base = assignTask(emptyPipeline('sync:S1', '', 0), ref, 'm-a', 1);
  const withRun = (extra: Record<string, unknown>) =>
    updateNode(base, 'step:s1', { lastRun: { machineId: 'm-a', runId: 'r1', requestId: 'pf-x', sessionId: 'sess', status: 'completed', startedAt: '', ...extra } }, 2);
  const stateOf = (pipeline: typeof base) =>
    evaluate({ pipeline, project, copies: { a: copy('a', doc([step('s1')], 3)) }, runtimes: { a: online }, activeRuns: [] })['step:s1'];

  it('a task done by its run, then unchecked, is open again (not "to review")', () => {
    const result = stateOf(withRun({ checked: true, seenDone: true }));
    expect(result.state).toBe('ready');
    expect(result.reopened).toBe(true);
  });
  it('a run that ended without checking stays "to review" until someone acts', () => {
    expect(stateOf(withRun({ checked: false })).state).toBe('review');
  });
  it('a task checked by a person after that run, then unchecked, is open again', () => {
    expect(stateOf(withRun({ checked: false, seenDone: true })).state).toBe('ready');
  });
});

describe('conversation of the next task', () => {
  const a = { kind: 'step' as const, planId: 'plan-1', stepId: 'a' };
  const b = { kind: 'step' as const, planId: 'plan-1', stepId: 'b' };
  const c = { kind: 'step' as const, planId: 'plan-1', stepId: 'c' };
  let p = emptyPipeline('sync:S1', '', 0);
  p = assignTask(p, a, 'm-a', 1);
  p = assignTask(p, b, 'm-b', 1);
  p = assignTask(p, c, 'm-b', 1);
  p = connect(p, 'step:a', 'step:c', 2).pipeline;
  p = connect(p, 'step:b', 'step:c', 2).pipeline;
  const node = (pipeline: typeof p, id: string) => pipeline.nodes.find((n) => n.id === id)!;

  it('is new by default', () => {
    expect(conversationSource(p, node(p, 'step:c'))).toBeNull();
  });
  it('continues the dependency whose run ended last when the pipeline says so', () => {
    let q: Pipeline = { ...p, conversation: 'continue' };
    q = updateNode(q, 'step:a', { lastRun: { machineId: 'm-a', runId: 'r1', requestId: 'x', sessionId: 's-a', status: 'completed', startedAt: '2026-10-13T10:00:00Z', endedAt: '2026-10-13T10:05:00Z' } }, 3);
    q = updateNode(q, 'step:b', { lastRun: { machineId: 'm-b', runId: 'r2', requestId: 'y', sessionId: 's-b', status: 'completed', startedAt: '2026-10-13T10:00:00Z', endedAt: '2026-10-13T10:09:00Z' } }, 3);
    expect(conversationSource(q, node(q, 'step:c'))).toBe('step:b');
    expect(conversationSource(q, node(q, 'step:a'))).toBeNull(); // no dependency
  });
  it('an explicit choice wins, and removing its link forgets it', () => {
    let q: Pipeline = { ...p, conversation: 'continue' };
    q = setConversation(q, 'step:c', { mode: 'continue', from: 'step:a' }, 4);
    expect(conversationSource(q, node(q, 'step:c'))).toBe('step:a');
    q = setConversation(q, 'step:c', { mode: 'new' }, 5);
    expect(conversationSource(q, node(q, 'step:c'))).toBeNull();
    q = setConversation(q, 'step:c', { mode: 'continue', from: 'step:a' }, 6);
    q = disconnect(q, 'step:a', 'step:c', 7);
    expect(node(q, 'step:c').conversation).toBeUndefined();
  });
  it('a continued conversation gets its own request id', () => {
    const prefix = requestPrefix('sync:S1', 'step:c', 0);
    const plain = requestIdFor(prefix, 4);
    const continued = requestIdFor(prefix, 4, 'b8a1c0de-0000-4000-8000-000000000001');
    expect(continued).not.toBe(plain);
    expect(continued.startsWith(prefix)).toBe(true);
    expect(continued).toMatch(/^[A-Za-z0-9_-]{16,100}$/);
  });
});
