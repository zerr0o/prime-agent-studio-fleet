// Instructions injected in every task started by Prime Fleet (field "instructions"
// of POST /roadmap/work, 4 000 characters at most).
import type { Pipeline, TaskRef } from './types';

export type Language = 'fr' | 'en';
export const INSTRUCTIONS_LIMIT = 4000;

export const DEFAULT_GIT_TEXT: Record<Language, string> = {
  fr:
    'Au début, récupère le code à jour avec git pull sur la branche courante. ' +
    "Si des modifications locales non commitées l'empêchent, arrête-toi et explique-le. " +
    'À la fin, une fois le travail vérifié, fais un commit clair puis git push sur la branche courante.',
  en:
    'At the start, update the code with git pull on the current branch. ' +
    'If uncommitted local changes block it, stop and explain why. ' +
    'At the end, once the work is verified, make a clear commit, then git push on the current branch.',
};

const text = {
  fr: {
    header: (machine: string) => `Pipeline Prime Fleet : tâche lancée sur ${machine}.`,
    deps: (list: string) => `Tâches précédentes terminées : ${list}.`,
    continued: (title: string, machine: string) =>
      `Cette conversation vient de la tâche « ${title} » sur ${machine}. Le dépôt de cette machine peut différer : vérifie son état avant de reprendre.`,
    git: (value: string) => `Code : ${value}`,
    step: (planId: string, stepId: string) =>
      `Roadmap : quand cette tâche est terminée et vérifiée, coche son étape avec roadmap_check (planId ${planId}, stepId ${stepId}). ` +
      "Si elle n'est pas terminée, ne la coche pas et explique ce qui manque.",
    plan: (title: string, planId: string) =>
      `Roadmap : coche avec roadmap_check chaque étape du plan « ${title} » (planId ${planId}) réellement terminée et vérifiée. ` +
      'Ne coche pas une étape incomplète.',
    backlog: (number: number) =>
      `Roadmap : quand l'élément n° ${number} du backlog est terminé et vérifié, marque-le comme fait avec roadmap_backlog (action set, numbers [${number}], done true).`,
    extra: (value: string) => `Consignes du pipeline : ${value}`,
  },
  en: {
    header: (machine: string) => `Prime Fleet pipeline: task started on ${machine}.`,
    deps: (list: string) => `Previous tasks done: ${list}.`,
    continued: (title: string, machine: string) =>
      `This conversation comes from the task "${title}" on ${machine}. The repository of this machine can differ: check its state before you continue.`,
    git: (value: string) => `Code: ${value}`,
    step: (planId: string, stepId: string) =>
      `Roadmap: when this task is finished and verified, check its step with roadmap_check (planId ${planId}, stepId ${stepId}). ` +
      'If it is not finished, do not check it and explain what is missing.',
    plan: (title: string, planId: string) =>
      `Roadmap: with roadmap_check, check every step of the plan "${title}" (planId ${planId}) that is really finished and verified. ` +
      'Do not check an incomplete step.',
    backlog: (number: number) =>
      `Roadmap: when backlog item ${number} is finished and verified, mark it done with roadmap_backlog (action set, numbers [${number}], done true).`,
    extra: (value: string) => `Pipeline instructions: ${value}`,
  },
};

export function composeInstructions(input: {
  language: Language;
  pipeline: Pick<Pipeline, 'git' | 'extra'>;
  ref: TaskRef;
  taskTitle: string;
  machineLabel: string;
  doneDeps: { title: string; machine?: string }[];
  /** Set when the task continues the conversation of a task run on another machine. */
  continuedFrom?: { title: string; machine: string };
}): string {
  const t = text[input.language];
  const check =
    input.ref.kind === 'step'
      ? t.step(input.ref.planId, input.ref.stepId)
      : input.ref.kind === 'plan'
        ? t.plan(input.taskTitle, input.ref.planId)
        : t.backlog(input.ref.number);
  const parts = [t.header(input.machineLabel)];
  if (input.doneDeps.length)
    parts.push(t.deps(input.doneDeps.map((dep) => (dep.machine ? `${clip(dep.title, 80)} (${dep.machine})` : clip(dep.title, 80))).join(' ; ')));
  if (input.continuedFrom) parts.push(t.continued(clip(input.continuedFrom.title, 80), input.continuedFrom.machine));
  if (input.pipeline.git.enabled && input.pipeline.git.text.trim()) parts.push(t.git(input.pipeline.git.text.trim()));
  parts.push(check);
  const fixed = parts.join('\n');
  const extra = input.pipeline.extra.trim();
  if (!extra) return clip(fixed, INSTRUCTIONS_LIMIT);
  const room = INSTRUCTIONS_LIMIT - fixed.length - 1 - t.extra('').length;
  return room > 20 ? `${fixed}\n${t.extra(clip(extra, room))}` : clip(fixed, INSTRUCTIONS_LIMIT);
}

function clip(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}
