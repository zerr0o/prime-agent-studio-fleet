// Roadmap sync status of each machine of a project.
import { editedAt } from './roadmap';
import type { FleetProject, MachineRuntime, MemberSyncStatus, RoadmapCopy } from './types';

export function memberStatuses(
  project: FleetProject,
  copies: Record<string, RoadmapCopy | undefined>,
  runtimes: Record<string, MachineRuntime | undefined>,
): Record<string, MemberSyncStatus> {
  const result: Record<string, MemberSyncStatus> = {};
  const readable: RoadmapCopy[] = [];
  for (const member of project.members) {
    const runtime = runtimes[member.machineKey];
    const copy = copies[member.machineKey];
    if (runtime?.state === 'offline') result[member.machineKey] = 'offline';
    else if (!copy) result[member.machineKey] = 'unknown';
    else readable.push(copy);
  }
  if (!project.syncId || project.members.length < 2) {
    for (const copy of readable) result[copy.machineKey] = 'solo';
    return result;
  }
  const fingerprints = new Set(readable.map((copy) => copy.fingerprint));
  if (fingerprints.size <= 1) {
    for (const copy of readable) result[copy.machineKey] = withSyncOff(runtimes[copy.machineKey], 'synced');
    return result;
  }
  const newest = Math.max(...readable.map((copy) => copy.editedAt));
  const top = readable.filter((copy) => copy.editedAt === newest);
  const topDiverged = new Set(top.map((copy) => copy.fingerprint)).size > 1;
  const reference = top[0].fingerprint;
  for (const copy of readable) {
    let status: MemberSyncStatus;
    if (copy.fingerprint === reference && !topDiverged) status = copy.editedAt === newest ? 'latest' : 'synced';
    else if (copy.editedAt === newest) status = 'diverged';
    else status = 'behind';
    result[copy.machineKey] = withSyncOff(runtimes[copy.machineKey], status);
  }
  return result;
}

/** A Studio without R2 sync cannot catch up by itself: say so instead of "behind". */
function withSyncOff(runtime: MachineRuntime | undefined, status: MemberSyncStatus): MemberSyncStatus {
  if (runtime?.sync && !runtime.sync.configured && status !== 'synced') return 'sync-off';
  return status;
}

/** The copy to display by default: the newest content; ties go to the earlier machine of `order`. */
export function referenceCopy(copies: (RoadmapCopy | undefined)[], order: string[] = []): RoadmapCopy | undefined {
  const rank = (copy: RoadmapCopy) => {
    const index = order.indexOf(copy.machineKey);
    return index < 0 ? order.length : index;
  };
  let best: RoadmapCopy | undefined;
  for (const copy of copies)
    if (copy && (!best || copy.editedAt > best.editedAt || (copy.editedAt === best.editedAt && rank(copy) < rank(best)))) best = copy;
  return best;
}

export const copyFrom = (machineKey: string, projectId: string, doc: RoadmapCopy['doc'], fingerprintValue: string, now: number): RoadmapCopy => ({
  machineKey,
  projectId,
  doc,
  fetchedAt: now,
  fingerprint: fingerprintValue,
  editedAt: editedAt(doc),
});
