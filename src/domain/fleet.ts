// Projects across machines: the same project shares a non-null syncId.
import type { Project } from '../api/types';
import type { FleetProject, MachineConfig, ProjectMember } from './types';

export const fleetKey = (project: Pick<Project, 'syncId' | 'machineId' | 'id'>) =>
  project.syncId ? `sync:${project.syncId}` : `local:${project.machineId}:${project.id}`;

export type MachineProjects = { machine: MachineConfig; machineId: string; projects: Project[] };

/** Groups the project lists of every reachable machine. Order: name, then key. */
export function groupProjects(lists: MachineProjects[]): FleetProject[] {
  const groups = new Map<string, FleetProject>();
  for (const { machine, machineId, projects } of lists) {
    for (const project of projects) {
      const key = fleetKey({ ...project, machineId });
      const member: ProjectMember = {
        machineKey: machine.key,
        machineId,
        projectId: project.id,
        name: project.name,
        exists: project.exists,
      };
      const group = groups.get(key);
      if (group) {
        // The same machine can appear twice only through a duplicate entry: keep one.
        if (!group.members.some((entry) => entry.machineId === machineId)) group.members.push(member);
      } else groups.set(key, { key, syncId: project.syncId, name: project.name, members: [member] });
    }
  }
  for (const group of groups.values()) group.name = commonName(group.members);
  return [...groups.values()].sort(
    (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.key.localeCompare(b.key),
  );
}

/** Most frequent name among members (folders can be named differently on each PC). */
export function commonName(members: ProjectMember[]): string {
  const counts = new Map<string, number>();
  for (const member of members) counts.set(member.name, (counts.get(member.name) ?? 0) + 1);
  let best = members[0]?.name ?? '';
  for (const [name, count] of counts) if (count > (counts.get(best) ?? 0)) best = name;
  return best;
}

export const memberOn = (project: FleetProject, machineId: string | null | undefined) =>
  machineId ? project.members.find((member) => member.machineId === machineId) : undefined;
