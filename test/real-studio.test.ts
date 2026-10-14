// Read-only checks against the real Studio of this PC. Skipped without a token.
// Put the token alone in .secrets/studio-token.txt (ignored by git). Never writes anything.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { StudioClient } from '../src/api/client';
import { groupProjects } from '../src/domain/fleet';
import { fingerprint } from '../src/domain/roadmap';

const TOKEN_FILE = '.secrets/studio-token.txt';
const token = existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, 'utf8').trim() : '';
const baseUrl = process.env.STUDIO_URL ?? 'http://127.0.0.1:3088';

describe.skipIf(!token)('real Studio (read-only)', () => {
  const client = new StudioClient({ baseUrl, token });

  it('reads the machine, its sync state and its projects', async () => {
    const machine = await client.machine();
    expect(machine.apiVersion).toBe('v1');
    const sync = await client.syncState();
    expect(sync.machineId).toBe(machine.machineId);
    const projects = await client.projects();
    expect(projects.length).toBeGreaterThan(0);
    const fleet = groupProjects([{ machine: { key: 'local', label: machine.name, baseUrl, color: '', addedAt: 0 }, machineId: machine.machineId, projects }]);
    expect(fleet.length).toBe(projects.length);
    console.log(`Studio ${machine.studioVersion} on ${machine.name}: ${projects.length} projects, R2 sync ${sync.configured ? 'on' : 'off'}`);
  });

  it('reads Roadmaps and runs with the shapes the app expects', async () => {
    const projects = await client.projects();
    let read = 0;
    for (const project of projects.filter((p) => p.exists).slice(0, 6)) {
      const envelope = await client.roadmap(project.id);
      expect(envelope.projectId).toBe(project.id);
      expect(typeof envelope.roadmap.revision).toBe('number');
      if (envelope.roadmap.initialized) {
        expect(Array.isArray(envelope.roadmap.plans)).toBe(true);
        for (const plan of envelope.roadmap.plans ?? []) for (const step of plan.steps) expect('completion' in step).toBe(true);
        expect(fingerprint(envelope.roadmap)).toMatch(/^[0-9a-z]+$/);
        read++;
      }
    }
    expect(read).toBeGreaterThan(0);
    const runs = await client.runs();
    for (const run of runs) expect(typeof run.status).toBe('string');
  });

  it('follows the event stream of an active run when there is one', async () => {
    const active = (await client.runs()).find((run) => run.status === 'running');
    if (!active) return;
    const controller = new AbortController();
    const events: string[] = [];
    setTimeout(() => controller.abort(), 4000);
    await client.events(active.id, { signal: controller.signal, onEvent: (event) => events.push(event.kind) }).catch(() => {});
    expect(events.length).toBeGreaterThan(0);
  });
});
