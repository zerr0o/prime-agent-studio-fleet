// React bindings of the fleet store.
import { useMemo } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { evaluate } from '../domain/pipeline';
import { memberStatuses, referenceCopy } from '../domain/syncStatus';
import { appStore, conductor } from './app';
import { activeRunsOf, projectByKey, type FleetState } from './store';

export const useFleet = <T,>(selector: (state: FleetState) => T) => useStore(appStore, selector);
export const useFleetShallow = <T,>(selector: (state: FleetState) => T) => useStore(appStore, useShallow(selector));

export { appStore, conductor };

/** Project, its copies, the sync status of each member and the reference copy. */
export function useProject(projectKey: string) {
  const project = useFleet((state) => projectByKey(state, projectKey));
  const copies = useFleet((state) => state.copies[projectKey]);
  const runtimes = useFleet((state) => state.runtimes);
  const statuses = useMemo(() => (project ? memberStatuses(project, copies ?? {}, runtimes) : {}), [project, copies, runtimes]);
  const machines = useFleet((state) => state.machines);
  const reference = useMemo(() => referenceCopy(Object.values(copies ?? {}), machines.map((m) => m.key)), [copies, machines]);
  return { project, copies: copies ?? {}, runtimes, statuses, reference };
}

/** Pipeline of a project with the state of every node (recomputed on any change). */
export function usePipeline(projectKey: string) {
  const project = useFleet((state) => projectByKey(state, projectKey));
  const pipeline = useFleet((state) => state.pipelines[projectKey]);
  const copies = useFleet((state) => state.copies[projectKey]);
  const runtimes = useFleet((state) => state.runtimes);
  const runs = useFleet((state) => state.runs);
  const evaluations = useMemo(() => {
    if (!project || !pipeline) return {};
    return evaluate({
      pipeline,
      project,
      copies: copies ?? {},
      runtimes,
      activeRuns: activeRunsOf({ runs } as FleetState, projectKey),
    });
  }, [project, pipeline, copies, runtimes, runs, projectKey]);
  return { project, pipeline, evaluations };
}

export const machineColorOf = (state: FleetState, machineKey: string) => state.machines.find((m) => m.key === machineKey)?.color;
