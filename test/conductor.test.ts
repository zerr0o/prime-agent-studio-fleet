import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { startSimulator } from '../sim/studio-sim.mjs';
import { StudioClient } from '../src/api/client';
import { assignTask, connect } from '../src/domain/pipeline';
import { findStep } from '../src/domain/roadmap';
import { memberStatuses } from '../src/domain/syncStatus';
import type { Pipeline, TaskRef } from '../src/domain/types';
import { Conductor } from '../src/state/conductor';
import { createFleetStore, projectByKey, type FleetStore } from '../src/state/store';

type SimMachine = { name: string; machineId: string; url: string; token: string };
type Sim = {
  machines: SimMachine[];
  control: { setOffline(name: string, offline: boolean): void; setScenario(name: string, mode: string): void; reset(): void };
  close(): Promise<void>;
};

let sim: Sim;
const conductors: Conductor[] = [];

beforeAll(async () => {
  sim = await startSimulator({ basePort: 0, speed: 30, heartbeatMs: 300 });
});
afterAll(async () => {
  for (const conductor of conductors) conductor.stop();
  await sim.close();
});
beforeEach(() => {
  for (const conductor of conductors.splice(0)) conductor.stop();
  sim.control.reset();
});

function makeFleet() {
  const store: FleetStore = createFleetStore();
  store.setState({ hydrated: true });
  const conductor = new Conductor({
    store,
    createClient: (machine, token) => new StudioClient({ baseUrl: machine.baseUrl, token }),
    language: () => 'en',
    intervals: { tick: 100, machines: 600, projects: 1500, roadmaps: 1500 },
  });
  conductors.push(conductor);
  const colors = ['#0891b2', '#ca8a04', '#64748b'];
  sim.machines.forEach((machine, index) =>
    conductor.addMachine({ label: machine.name, baseUrl: machine.url, color: colors[index] }, machine.token),
  );
  return { store, conductor };
}

async function until<T>(read: () => T | undefined | null | false, timeout = 20_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error('Timed out');
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

const keyOf = (store: FleetStore, name: string) => store.getState().machines.find((m) => m.label === name)!.key;
const idOf = (name: string) => sim.machines.find((m) => m.name === name)!.machineId;

async function nimbus(store: FleetStore, conductor: Conductor) {
  await conductor.refreshAll();
  const project = await until(() => store.getState().projects.find((p) => p.name === 'Nimbus API' && p.members.length === 3));
  await conductor.refreshRoadmaps(project.key);
  return project;
}

function stepRef(store: FleetStore, projectKey: string, text: string): TaskRef {
  const copies = Object.values(store.getState().copies[projectKey] ?? {});
  for (const copy of copies)
    for (const plan of copy.doc.plans ?? []) {
      const walk = (steps: typeof plan.steps): TaskRef | undefined => {
        for (const step of steps) {
          if (step.text === text) return { kind: 'step', planId: plan.id, stepId: step.id };
          const child = walk(step.children ?? []);
          if (child) return child;
        }
        return undefined;
      };
      const found = walk(plan.steps);
      if (found) return found;
    }
  throw new Error(`Step not found: ${text}`);
}

const isDoneOn = (store: FleetStore, projectKey: string, machineKey: string, ref: TaskRef) => {
  if (ref.kind !== 'step') return false;
  const plan = store.getState().copies[projectKey]?.[machineKey]?.doc.plans?.find((p) => p.id === ref.planId);
  return !!findStep(plan?.steps, ref.stepId)?.done;
};

type Step = { kind: 'step'; planId: string; stepId: string };
const nodeOf = (store: FleetStore, projectKey: string, ref: Step) =>
  store.getState().pipelines[projectKey]?.nodes.find((n) => n.id === `step:${ref.stepId}`);

describe('conductor against the simulator', () => {
  it('groups projects by syncId and reports the sync status of each machine', async () => {
    const { store, conductor } = makeFleet();
    const project = await nimbus(store, conductor);
    const state = store.getState();
    expect(state.projects.map((p) => [p.name, p.members.length])).toEqual([
      ['Atlas Mobile', 1],
      ['Nimbus API', 3],
      ['Orbit Web', 2],
    ]);
    const statuses = memberStatuses(project, state.copies[project.key], state.runtimes);
    expect(statuses[keyOf(store, 'Laptop')]).toBe('behind');
    expect(statuses[keyOf(store, 'Workstation')]).toBe('latest');

    await conductor.syncProject(project.key);
    const after = memberStatuses(project, store.getState().copies[project.key], store.getState().runtimes);
    expect(after[keyOf(store, 'Laptop')]).toBe('synced');
    expect(after[keyOf(store, 'Workstation')]).toBe('synced');
    // Buildbox has no R2 sync: a warning is reported, not a failure.
    expect(store.getState().syncJobs[project.key].warnings.map((w) => w.key)).toContain('sync.notConfigured');
  });

  it('chains a task to another machine after the end of a run and the sync', async () => {
    const { store, conductor } = makeFleet();
    const project = await nimbus(store, conductor);
    const a = stepRef(store, project.key, 'Expose the X-RateLimit headers');
    const b = stepRef(store, project.key, 'Write the migration guide for v1 clients');
    conductor.editPipeline(project.key, (p, now) => {
      let next = assignTask(p, a, idOf('Workstation'), now);
      next = assignTask(next, b, idOf('Laptop'), now);
      return connect(next, 'step:' + (a as { stepId: string }).stepId, 'step:' + (b as { stepId: string }).stepId, now).pipeline;
    });
    conductor.start();
    const started = await conductor.setAuto(project.key, true);
    expect(started).toEqual(['step:' + (a as { stepId: string }).stepId]);

    // B starts on Laptop by itself once A ended and the machines synced.
    const nodeB = await until(() => {
      const node = store.getState().pipelines[project.key].nodes.find((n) => n.id.endsWith((b as { stepId: string }).stepId));
      return node?.lastRun && node.lastRun.machineId === idOf('Laptop') ? node : null;
    });
    await until(() => {
      const node = store.getState().pipelines[project.key].nodes.find((n) => n.id === nodeB.id);
      return node?.lastRun?.checked === true;
    });
    const laptop = keyOf(store, 'Laptop');
    const workstation = keyOf(store, 'Workstation');
    expect(isDoneOn(store, project.key, workstation, a)).toBe(true);
    expect(isDoneOn(store, project.key, laptop, a)).toBe(true);
    expect(isDoneOn(store, project.key, laptop, b)).toBe(true);

    // The injected instructions reached the agent of B.
    const client = new StudioClient({ baseUrl: sim.machines[1].url, token: sim.machines[1].token });
    const sessionId = store.getState().pipelines[project.key].nodes.find((n) => n.id === nodeB.id)!.lastRun!.sessionId!;
    const history = await client.messages(sessionId);
    const prompt = history.items.find((m) => m.role === 'user')?.text ?? '';
    expect(prompt).toContain('roadmap_check');
    expect(prompt).toContain('git pull');
    const keys = store.getState().activity.map((item) => item.notice.key);
    expect(keys.filter((k) => k === 'activity.started').length).toBe(2);
  });

  it('a run that ends without checking its step blocks the chain', async () => {
    const { store, conductor } = makeFleet();
    const project = await nimbus(store, conductor);
    sim.control.setScenario('Workstation', 'nocheck');
    const a = stepRef(store, project.key, 'Publish a preview environment') as { kind: 'step'; planId: string; stepId: string };
    const b = stepRef(store, project.key, 'Review the copy with the support team') as { kind: 'step'; planId: string; stepId: string };
    conductor.editPipeline(project.key, (p, now) => {
      let next = assignTask(p, a, idOf('Workstation'), now);
      next = assignTask(next, b, idOf('Laptop'), now);
      return connect(next, `step:${a.stepId}`, `step:${b.stepId}`, now).pipeline;
    });
    conductor.start();
    await conductor.setAuto(project.key, true);
    await until(() => store.getState().pipelines[project.key].nodes.find((n) => n.id === `step:${a.stepId}`)?.lastRun?.checked === false);
    const evaluation = conductor.evaluation(project.key)!;
    expect(evaluation[`step:${a.stepId}`].state).toBe('review');
    expect(evaluation[`step:${b.stepId}`].state).toBe('waiting');
    expect(store.getState().pipelines[project.key].nodes.find((n) => n.id === `step:${b.stepId}`)?.lastRun).toBeUndefined();
    expect(store.getState().activity.some((item) => item.notice.key === 'activity.notChecked')).toBe(true);
  });

  it('two app instances never start the same task twice', async () => {
    const first = makeFleet();
    const second = makeFleet();
    const project = await nimbus(first.store, first.conductor);
    await nimbus(second.store, second.conductor);
    const a = stepRef(first.store, project.key, 'Add quickstarts') as { kind: 'step'; planId: string; stepId: string };
    for (const fleet of [first, second]) fleet.conductor.editPipeline(project.key, (p, now) => assignTask(p, a, idOf('Workstation'), now));
    const nodeId = `step:${a.stepId}`;
    const [one, two] = await Promise.all([first.conductor.launchNode(project.key, nodeId), second.conductor.launchNode(project.key, nodeId)]);
    expect(one && two).toBe(true);
    const runA = first.store.getState().pipelines[project.key].nodes.find((n) => n.id === nodeId)!.lastRun!.runId;
    const runB = second.store.getState().pipelines[project.key].nodes.find((n) => n.id === nodeId)!.lastRun!.runId;
    expect(runA).toBe(runB);
    const client = new StudioClient({ baseUrl: sim.machines[0].url, token: sim.machines[0].token });
    const runs = (await client.runs()).filter((run) => run.requestId?.startsWith('pf-'));
    expect(runs.length).toBe(1);
  });

  it('an offline machine is reported and its tasks wait', async () => {
    const { store, conductor } = makeFleet();
    const project = await nimbus(store, conductor);
    const a = stepRef(store, project.key, 'Run them on staging') as { kind: 'step'; planId: string; stepId: string };
    conductor.editPipeline(project.key, (p, now) => assignTask(p, a, idOf('Laptop'), now));
    sim.control.setOffline('Laptop', true);
    await conductor.refreshMachine(keyOf(store, 'Laptop'));
    expect(store.getState().runtimes[keyOf(store, 'Laptop')].state).toBe('offline');
    expect(conductor.evaluation(project.key)![`step:${a.stepId}`].state).toBe('offline');
    expect(await conductor.launchNode(project.key, `step:${a.stepId}`)).toBe(false);
    sim.control.setOffline('Laptop', false);
    expect(projectByKey(store.getState(), project.key)?.members.length).toBe(3);
  });

  it('continues the conversation of the previous task on the other machine', async () => {
    const { store, conductor } = makeFleet();
    const project = await nimbus(store, conductor);
    const a = stepRef(store, project.key, 'Expose the X-RateLimit headers') as Step;
    const b = stepRef(store, project.key, 'Write the migration guide for v1 clients') as Step;
    conductor.editPipeline(project.key, (p, now) => {
      let next: Pipeline = { ...assignTask(p, a, idOf('Workstation'), now), conversation: 'continue' };
      next = assignTask(next, b, idOf('Laptop'), now);
      return connect(next, `step:${a.stepId}`, `step:${b.stepId}`, now).pipeline;
    });
    conductor.start();
    await conductor.setAuto(project.key, true);
    const nodeB = await until(() => {
      const node = nodeOf(store, project.key, b);
      return node?.lastRun?.machineId === idOf('Laptop') ? node : null;
    });
    expect(nodeB.lastRun!.sessionId).toBeTruthy();
    expect(nodeB.lastRun!.sessionId).toBe(nodeOf(store, project.key, a)!.lastRun!.sessionId);
    await until(() => nodeOf(store, project.key, b)?.lastRun?.checked === true);
    // On Laptop, the same conversation holds the prompt of A, then the prompt of B.
    const laptop = new StudioClient({ baseUrl: sim.machines[1].url, token: sim.machines[1].token });
    const prompts = (await laptop.messages(nodeB.lastRun!.sessionId!)).items.filter((m) => m.role === 'user').map((m) => m.text ?? '');
    expect(prompts.length).toBe(2);
    expect(prompts[1]).toContain('This conversation comes from the task "Expose the X-RateLimit headers" on Workstation');
    expect(store.getState().activity.some((item) => item.notice.key === 'activity.startedContinued')).toBe(true);
  });

  it('never replaces a conversation that cannot move by a new one', async () => {
    const { store, conductor } = makeFleet();
    const project = await nimbus(store, conductor);
    sim.control.setScenario('Workstation', 'nocheck');
    const x = stepRef(store, project.key, 'Publish a preview environment') as Step;
    const id = `step:${x.stepId}`;
    conductor.editPipeline(project.key, (p, now) => assignTask(p, x, idOf('Workstation'), now));
    conductor.start();
    expect(await conductor.launchNode(project.key, id)).toBe(true);
    await until(() => nodeOf(store, project.key, x)?.lastRun?.checked === false);
    // Move the task to Buildbox (no R2 sync there) and ask to continue its own conversation.
    conductor.editPipeline(project.key, (p, now) => {
      const moved = assignTask(p, x, idOf('Buildbox'), now);
      return { ...moved, nodes: moved.nodes.map((n) => (n.id === id ? { ...n, conversation: { mode: 'continue' as const, from: id } } : n)) };
    });
    expect(await conductor.startNode(project.key, id)).toBe(false);
    expect(store.getState().launches[`${project.key}|${id}`]?.error?.key).toBe('launch.conversationTransfer');
    const buildbox = new StudioClient({ baseUrl: sim.machines[2].url, token: sim.machines[2].token });
    expect((await buildbox.runs()).filter((run) => run.requestId?.startsWith('pf-')).length).toBe(0);
  });

  it('a task done by its run, then unchecked, is open again and starts as a new attempt', async () => {
    const { store, conductor } = makeFleet();
    const project = await nimbus(store, conductor);
    const x = stepRef(store, project.key, 'Write the k6 scenarios') as Step;
    const id = `step:${x.stepId}`;
    conductor.editPipeline(project.key, (p, now) => assignTask(p, x, idOf('Workstation'), now));
    conductor.start();
    expect(await conductor.launchNode(project.key, id)).toBe(true);
    await until(() => nodeOf(store, project.key, x)?.lastRun?.checked === true);
    const first = nodeOf(store, project.key, x)!.lastRun!.runId;
    expect(conductor.evaluation(project.key)![id].state).toBe('done');

    expect(await conductor.setTaskDone(project.key, x, false, idOf('Workstation'))).toBe(true);
    const reopened = conductor.evaluation(project.key)![id];
    expect(reopened.state).toBe('ready');
    expect(reopened.reopened).toBe(true);

    // A refresh of the old run must not bring it back on the node.
    await conductor.refreshRuns(keyOf(store, 'Workstation'));
    expect(conductor.evaluation(project.key)![id].state).toBe('ready');
    // Auto mode never restarts a task that ran already: only an explicit start does.
    expect(await conductor.setAuto(project.key, true)).toEqual([]);
    expect(nodeOf(store, project.key, x)!.lastRun!.runId).toBe(first);

    expect(await conductor.launchNode(project.key, id)).toBe(true);
    const node = nodeOf(store, project.key, x)!;
    expect(node.attempt).toBe(1);
    expect(node.lastRun!.runId).not.toBe(first);
    await until(() => nodeOf(store, project.key, x)?.lastRun?.checked === true);
  });
});
