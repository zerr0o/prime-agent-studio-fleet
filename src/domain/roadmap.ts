// Read helpers over one Roadmap copy (RoadmapDocument as returned by GET /roadmap).
import type { BacklogEntry, RoadmapCompletion, RoadmapDocument, RoadmapPlan, RoadmapStep } from '../api/types';
import { canonicalJson, hashText } from './hash';
import type { TaskRef } from './types';

/** Content fingerprint: equal on two machines when the synced content is the same. */
export function fingerprint(doc: RoadmapDocument): string {
  return hashText(
    canonicalJson({
      overview: { vision: doc.overview?.vision ?? '', milestones: doc.overview?.milestones ?? [] },
      plans: doc.plans ?? [],
      backlog: doc.backlog ?? { items: [], notes: [] },
      pastudioImports: doc.pastudioImports ?? [],
    }),
  );
}

export const editedAt = (doc: RoadmapDocument) => (Number.isFinite(doc.lastEdit?.at) ? Number(doc.lastEdit?.at) : 0);

export function findPlan(doc: RoadmapDocument | undefined, planId: string): RoadmapPlan | undefined {
  return doc?.plans?.find((plan) => plan.id === planId);
}

export function findStep(steps: RoadmapStep[] | undefined, stepId: string): RoadmapStep | undefined {
  for (const step of steps ?? []) {
    if (step.id === stepId) return step;
    const child = findStep(step.children, stepId);
    if (child) return child;
  }
  return undefined;
}

export function findBacklog(doc: RoadmapDocument | undefined, number: number): BacklogEntry | undefined {
  return [...(doc?.backlog?.items ?? []), ...(doc?.backlog?.notes ?? [])].find((entry) => entry.number === number);
}

export type FlatStep = { step: RoadmapStep; depth: number; parentId: string | null };

export function flattenSteps(steps: RoadmapStep[] | undefined, depth = 0, parentId: string | null = null): FlatStep[] {
  const out: FlatStep[] = [];
  for (const step of steps ?? []) {
    out.push({ step, depth, parentId });
    out.push(...flattenSteps(step.children, depth + 1, step.id));
  }
  return out;
}

export function countSteps(steps: RoadmapStep[] | undefined) {
  let done = 0;
  let total = 0;
  for (const { step } of flattenSteps(steps)) {
    if (step.children?.length) continue;
    total++;
    if (step.done) done++;
  }
  return { done, total };
}

/** What a pipeline node points to, read from one copy. */
export type TaskInfo = {
  exists: boolean;
  title: string;
  subtitle: string;
  planColor: string | null;
  done: boolean;
  completion: RoadmapCompletion;
  progress?: { done: number; total: number };
};

export function taskInfo(doc: RoadmapDocument | undefined, ref: TaskRef): TaskInfo {
  const missing: TaskInfo = { exists: false, title: '', subtitle: '', planColor: null, done: false, completion: null };
  if (!doc) return missing;
  if (ref.kind === 'backlog') {
    const entry = findBacklog(doc, ref.number);
    if (!entry) return missing;
    return { exists: true, title: entry.text, subtitle: `#${entry.number}`, planColor: null, done: !!entry.done, completion: null };
  }
  const plan = findPlan(doc, ref.planId);
  if (!plan) return missing;
  const color = plan.color && plan.color !== 'transparent' ? plan.color : null;
  if (ref.kind === 'plan') {
    const progress = countSteps(plan.steps);
    const done = plan.status === 'done' || (progress.total > 0 && progress.done === progress.total);
    return { exists: true, title: plan.title, subtitle: plan.title, planColor: color, done, completion: null, progress };
  }
  const step = findStep(plan.steps, ref.stepId);
  if (!step) return missing;
  const progress = step.children?.length ? countSteps(step.children) : undefined;
  return {
    exists: true,
    title: step.text,
    subtitle: plan.title,
    planColor: color,
    done: !!step.done,
    completion: step.completion ?? null,
    progress,
  };
}

/** True when an agent declared work on this task in this copy (roadmap_work activity). */
export function hasActivity(doc: RoadmapDocument | undefined, ref: TaskRef): boolean {
  return (doc?.activity ?? []).some((entry) =>
    (entry.targets ?? []).some((target) => {
      if (ref.kind === 'backlog') return target.kind === 'backlog' && target.number === ref.number;
      if (target.kind !== 'plan' || target.planId !== ref.planId) return false;
      return ref.kind === 'plan' ? true : target.stepId === ref.stepId || target.stepId === undefined;
    }),
  );
}

export const visiblePlans = (doc: RoadmapDocument | undefined) =>
  (doc?.plans ?? []).filter((plan) => !plan.archived && plan.status !== 'abandoned');
