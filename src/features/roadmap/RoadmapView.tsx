// Roadmap of a project (one machine copy), with the assignment of each task to a machine.
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';

import type { BacklogEntry, RoadmapPlan, RoadmapStep } from '@/api/types';
import { nodeIdFor } from '@/domain/pipeline';
import { countSteps, hasActivity, visiblePlans } from '@/domain/roadmap';
import type { TaskRef } from '@/domain/types';
import { nodeTone, syncTone } from '@/features/fleet/status';
import { useProjectKey } from '@/features/project/nav';
import { formatTime, useT } from '@/i18n';
import { conductor, useFleet, usePipeline, useProject } from '@/state/hooks';
import { Banner, Button, ButtonRow, Checkbox, Dialog, Disclosure, Dot, EmptyState, ProgressLabel, Select, StatusLabel, Switch, Txt, useToast } from '@/ui/components';
import { useLayoutMode } from '@/ui/layout';
import { useTheme } from '@/ui/theme-context';
import { AssignMenu } from './AssignMenu';

type Pending = { ref: TaskRef; done: boolean; title: string } | null;

export function RoadmapView() {
  const t = useT();
  const key = useProjectKey();
  const toast = useToast();
  const mode = useLayoutMode();
  const { colors } = useTheme();
  const { project, copies, statuses, reference, runtimes } = useProject(key);
  const { pipeline, evaluations } = usePipeline(key);
  const machines = useFleet((state) => state.machines);
  const [source, setSource] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const phone = mode === 'phone';

  const copy = (source && copies[source]) || reference;
  const doc = copy?.doc;
  const plans = useMemo(() => visiblePlans(doc), [doc]);
  const totals = useMemo(() => {
    let done = 0;
    let total = 0;
    for (const plan of plans) {
      const value = countSteps(plan.steps);
      done += value.done;
      total += value.total;
    }
    return { done, total };
  }, [plans]);
  const nodes = useMemo(() => new Map((pipeline?.nodes ?? []).map((node) => [node.id, node])), [pipeline]);
  if (!project) return null;

  const options = project.members
    .filter((member) => copies[member.machineKey])
    .map((member) => {
      const machine = machines.find((m) => m.key === member.machineKey);
      return { value: member.machineKey, label: machine?.label ?? member.name, color: machine?.color, detail: t(`sync.${statuses[member.machineKey] ?? 'unknown'}`) };
    });

  const labelOf = (machineId: string) =>
    machines.find((m) => (m.machineId ?? runtimes[m.key]?.info?.machineId) === machineId)?.label ?? machineId.slice(0, 8);
  const copyLabel = copy ? machines.find((m) => m.key === copy.machineKey)?.label ?? '' : '';

  const assign = (ref: TaskRef, compact = false) => {
    const node = nodes.get(nodeIdFor(ref));
    return <AssignMenu project={project} refTask={ref} machineId={node?.machineId} state={node ? evaluations[node.id]?.state : undefined} compact={compact} />;
  };

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    const node = nodes.get(nodeIdFor(pending.ref));
    const ok = await conductor.setTaskDone(key, pending.ref, pending.done, node?.machineId);
    setBusy(false);
    setPending(null);
    if (!ok) toast.show({ text: t('roadmap.checkFailed', { machine: copyLabel }), tone: 'error' });
  };

  /** Pipeline state worth a word in the Roadmap (the full picture lives in the pipeline tab). */
  const nodeState = (ref: TaskRef) => {
    const node = nodes.get(nodeIdFor(ref));
    const state = node ? evaluations[node.id]?.state : undefined;
    return state && ['running', 'ready', 'queued', 'review', 'failed', 'stopped', 'offline'].includes(state) ? state : undefined;
  };

  const stepRow = (plan: RoadmapPlan, step: RoadmapStep, depth: number): React.ReactNode => {
    if (remaining && step.done) return null;
    const ref: TaskRef = { kind: 'step', planId: plan.id, stepId: step.id };
    const working = hasActivity(doc, ref);
    const state = nodeState(ref);
    const completion = step.completion;
    const showAssign = !step.done || nodes.has(nodeIdFor(ref));
    return (
      <View key={step.id}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 7, paddingLeft: depth * (phone ? 16 : 22) }}>
          <Checkbox
            checked={step.done}
            tone="green"
            indeterminate={!step.done && !!step.partial}
            accessibilityLabel={step.text}
            disabled={!!step.children?.length}
            onChange={(value) => setPending({ ref, done: value, title: step.text })}
          />
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            <Txt
              variant="body"
              tone={step.done ? 'muted' : 'text'}
              style={{ lineHeight: 20, textDecorationLine: step.done ? 'line-through' : 'none', textDecorationColor: colors.faint }}
            >
              {step.text}
            </Txt>
            {step.note ? (
              <Txt variant="meta" numberOfLines={2}>
                {step.note}
              </Txt>
            ) : null}
            {working && state !== 'running' ? <StatusLabel tone="running" label={t('roadmap.working')} /> : null}
            {state ? <StatusLabel tone={nodeTone(state)} label={t(`state.${state}`)} /> : null}
            {step.done && completion?.machineId ? (
              <Txt variant="caption" tone="muted">
                {t('roadmap.doneOn', { machine: labelOf(completion.machineId), time: formatTime(t.lang, completion.completedAt) })}
              </Txt>
            ) : null}
            {phone && showAssign ? <View style={{ marginTop: 4, flexDirection: 'row' }}>{assign(ref, true)}</View> : null}
          </View>
          {!phone && showAssign ? assign(ref) : null}
        </View>
        {(step.children ?? []).map((child) => stepRow(plan, child, depth + 1))}
      </View>
    );
  };

  const planBlock = (plan: RoadmapPlan) => {
    const value = countSteps(plan.steps);
    if (remaining && value.total && value.done === value.total) return null;
    const expanded = open[plan.id] ?? (plan.status === 'active' && value.done < value.total);
    const color = plan.color && plan.color !== 'transparent' ? plan.color : null;
    const percent = value.total ? Math.round((value.done / value.total) * 100) : 0;
    const ref: TaskRef = { kind: 'plan', planId: plan.id };
    return (
      <View key={plan.id} style={{ borderTopWidth: 1, borderTopColor: colors.line, paddingVertical: 14 }}>
        <View style={{ borderLeftWidth: color ? 3 : 0, borderLeftColor: color ?? 'transparent', paddingLeft: color ? 12 : 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Disclosure expanded={expanded} onToggle={() => setOpen((o) => ({ ...o, [plan.id]: !expanded }))} accessibilityLabel={plan.title} />
            <Txt variant="heading" numberOfLines={2} style={{ flex: 1 }}>
              {plan.title}
            </Txt>
            <Txt variant="meta" style={{ fontVariant: ['tabular-nums'] }}>
              {t('roadmap.planProgress', { done: value.done, total: value.total, percent })}
            </Txt>
            {!phone ? assign(ref, true) : null}
          </View>
          {phone ? <View style={{ marginLeft: 28, marginTop: 6, flexDirection: 'row' }}>{assign(ref, true)}</View> : null}
          {plan.summary ? (
            <Txt variant="meta" numberOfLines={expanded ? 3 : 1} style={{ marginLeft: 28, marginTop: 2 }}>
              {plan.summary}
            </Txt>
          ) : null}
          {expanded ? <View style={{ marginTop: 8, marginLeft: 6 }}>{plan.steps.map((step) => stepRow(plan, step, 0))}</View> : null}
        </View>
      </View>
    );
  };

  const milestones = doc?.overview?.milestones ?? [];
  const groups = [
    ...milestones.map((milestone) => ({ key: milestone.id, title: milestone.title, status: milestone.status, plans: plans.filter((plan) => plan.milestone === milestone.id) })),
    { key: 'none', title: milestones.length ? t('roadmap.noMilestone') : '', status: undefined, plans: plans.filter((plan) => !plan.milestone || !milestones.some((m) => m.id === plan.milestone)) },
  ].filter((group) => group.plans.length);
  const backlog: BacklogEntry[] = doc?.backlog?.items ?? [];

  if (!doc)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <EmptyState icon="roadmap" title={t('tab.roadmap')} text={Object.keys(copies).length ? t('roadmap.loading') : t('roadmap.unreadable')} actionLabel={t('common.refresh')} onAction={() => void conductor.refreshRoadmaps(key)} />
      </View>
    );

  return (
    <ScrollView contentContainerStyle={{ padding: phone ? 16 : 27, gap: 16, maxWidth: 980, width: '100%', alignSelf: 'center' }}>
      <View style={{ flexDirection: phone ? 'column' : 'row', gap: 14, alignItems: phone ? 'stretch' : 'flex-end' }}>
        <View style={{ flex: 1, gap: 6 }}>
          <ProgressLabel label={t('roadmap.tasksChecked', { done: totals.done, count: totals.total })} stat={`${totals.total ? Math.round((totals.done / totals.total) * 100) : 0}${t.lang === 'fr' ? '\u00a0%' : '%'}`} value={totals.total ? totals.done / totals.total : 0} />
        </View>
        <View style={{ width: phone ? undefined : 260 }}>
          <Select label={t('roadmap.copyFrom')} value={copy?.machineKey ?? null} options={options} onChange={setSource} accessibilityLabel={t('roadmap.copyFrom')} />
        </View>
      </View>
      {copy && statuses[copy.machineKey] && statuses[copy.machineKey] !== 'synced' && statuses[copy.machineKey] !== 'solo' ? (
        <Banner tone={syncTone(statuses[copy.machineKey]) === 'attention' ? 'warning' : 'quiet'} text={t(`sync.hint.${statuses[copy.machineKey]}`)} actionLabel={project.syncId && statuses[copy.machineKey] !== 'sync-off' ? t('sync.now') : undefined} onAction={() => void conductor.syncProject(key)} />
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'flex-end' }}>
        <Txt variant="meta">{t('roadmap.remainingOnly')}</Txt>
        <Switch value={remaining} onValueChange={setRemaining} accessibilityLabel={t('roadmap.remainingOnly')} />
      </View>
      {doc.overview?.vision ? (
        <View style={{ gap: 4 }}>
          <Txt variant="heading">{t('roadmap.vision')}</Txt>
          <Txt variant="body" tone="muted" numberOfLines={4}>
            {doc.overview.vision}
          </Txt>
        </View>
      ) : null}
      {!plans.length ? <Txt variant="meta">{doc.initialized === false ? t('roadmap.notInitialized') : t('roadmap.empty')}</Txt> : null}
      {groups.map((group) => (
        <View key={group.key} style={{ gap: 4 }}>
          {group.title ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, marginBottom: 4 }}>
              <Txt variant="sectionLabel">{group.title}</Txt>
              {group.status === 'active' ? <Dot kind="unread" size={5} /> : null}
            </View>
          ) : null}
          {group.plans.map(planBlock)}
        </View>
      ))}
      {backlog.length ? (
        <View style={{ gap: 4, marginTop: 10 }}>
          <Txt variant="sectionLabel" style={{ marginBottom: 4 }}>
            {t('roadmap.backlog')}
          </Txt>
          {backlog
            .filter((entry) => !(remaining && entry.done))
            .map((entry) => {
              const ref: TaskRef = { kind: 'backlog', number: entry.number };
              return (
                <View key={`b${entry.number}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 7, borderTopWidth: 1, borderTopColor: colors.line }}>
                  <Checkbox checked={!!entry.done} tone="green" accessibilityLabel={entry.text} onChange={(value) => setPending({ ref, done: value, title: entry.text })} />
                  <Txt variant="meta" tone="faint" style={{ width: 26, fontVariant: ['tabular-nums'], marginTop: 2 }}>
                    {`#${entry.number}`}
                  </Txt>
                  <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                    <Txt variant="body" tone={entry.done ? 'muted' : 'text'} style={{ lineHeight: 20, textDecorationLine: entry.done ? 'line-through' : 'none', textDecorationColor: colors.faint }}>
                      {entry.text}
                    </Txt>
                    {nodeState(ref) ? <StatusLabel tone={nodeTone(nodeState(ref)!)} label={t(`state.${nodeState(ref)}`)} /> : null}
                    {phone && (!entry.done || nodes.has(nodeIdFor(ref))) ? <View style={{ flexDirection: 'row' }}>{assign(ref, true)}</View> : null}
                  </View>
                  {!phone && (!entry.done || nodes.has(nodeIdFor(ref))) ? assign(ref) : null}
                </View>
              );
            })}
        </View>
      ) : null}
      <Dialog
        visible={!!pending}
        onClose={() => setPending(null)}
        icon="check"
        title={pending?.done ? t('roadmap.markDoneTitle') : t('roadmap.markUndone')}
        description={t('roadmap.markDoneText', { machine: copyLabel })}
        actions={
          <ButtonRow align="end">
            <Button variant="secondary" label={t('common.cancel')} onPress={() => setPending(null)} />
            <Button variant="primary" label={pending?.done ? t('roadmap.markDone') : t('roadmap.markUndone')} loading={busy} onPress={() => void confirm()} />
          </ButtonRow>
        }
      >
        <Txt variant="body">{pending?.title}</Txt>
      </Dialog>
    </ScrollView>
  );
}
