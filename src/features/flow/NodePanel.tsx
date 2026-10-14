// Details of the selected pipeline node: state, machine, links, last run and actions.
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { THINKING_LEVELS, type Thinking } from '@/api/types';
import { assignTask, conversationSource, disconnect, removeNode, setConversation, updateNode, type NodeEval } from '@/domain/pipeline';
import type { FleetProject, Pipeline } from '@/domain/types';
import { nodeDot, nodeTone, runTone } from '@/features/fleet/status';
import { runHref } from '@/features/project/nav';
import { formatTime, useT } from '@/i18n';
import { conductor, useFleet } from '@/state/hooks';
import { runKeyOf } from '@/state/store';
import { Banner, Button, ButtonRow, Dialog, Divider, Dot, IconButton, Select, StatusLabel, Txt, useToast } from '@/ui/components';
import { useTheme } from '@/ui/theme-context';

export function NodePanel({
  project,
  pipeline,
  evaluations,
  nodeId,
  onClose,
}: {
  project: FleetProject;
  pipeline: Pipeline;
  evaluations: Record<string, NodeEval>;
  nodeId: string;
  onClose(): void;
}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const { colors } = useTheme();
  const machines = useFleet((state) => state.machines);
  const runtimes = useFleet((state) => state.runtimes);
  const models = useFleet((state) => state.models);
  const launches = useFleet((state) => state.launches);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const evaluation = evaluations[nodeId];
  const node = evaluation?.node;
  const machine = node?.machineId ? machines.find((m) => (m.machineId ?? runtimes[m.key]?.info?.machineId) === node.machineId) : undefined;

  useEffect(() => {
    if (machine) void conductor.loadModels(machine.key);
  }, [machine]);

  if (!evaluation || !node) return null;
  const state = evaluation.state;
  const title = evaluation.task.title || node.id;
  const label = (id: string) => evaluations[id]?.task.title || id;
  const dependents = pipeline.edges.filter((edge) => edge.from === node.id).map((edge) => edge.to);
  const memberOptions = [
    { value: 'unassigned', label: t('state.unassigned') },
    ...project.members.map((member) => {
      const m = machines.find((entry) => entry.key === member.machineKey);
      return { value: member.machineId, label: m?.label ?? member.name, color: m?.color };
    }),
  ];
  const launchError = launches[`${project.key}|${node.id}`]?.error;
  const run = node.lastRun;
  const runMachine = run ? machines.find((m) => (m.machineId ?? runtimes[m.key]?.info?.machineId) === run.machineId) : undefined;
  const runKey = run && runMachine ? runKeyOf(runMachine.key, run.runId) : null;
  const canStart = !!node.machineId && ['ready', 'review', 'failed', 'stopped', 'queued'].includes(state);
  const restart = !!run || !!launchError;
  const catalog = machine ? models[machine.key] ?? [] : [];

  // Conversation: pipeline setting, new, its own last conversation, or the one of a dependency.
  const machineName = (machineId?: string | null) => machines.find((m) => (m.machineId ?? runtimes[m.key]?.info?.machineId) === machineId)?.label ?? '';
  const choice = node.conversation;
  const conversationValue = !choice ? 'default' : choice.mode === 'new' ? 'new' : choice.from === node.id ? 'self' : `dep:${choice.from}`;
  const conversationOptions = [
    {
      value: 'default',
      label: t('pipeline.conversationDefault', { value: t(pipeline.conversation === 'continue' ? 'pipeline.conversationContinue' : 'pipeline.conversationNew') }),
    },
    { value: 'new', label: t('pipeline.conversationNew') },
    ...(node.lastRun?.sessionId ? [{ value: 'self', label: t('pipeline.conversationSelf'), detail: machineName(node.lastRun.machineId) }] : []),
    ...evaluation.deps.map((dep) => {
      const depNode = pipeline.nodes.find((entry) => entry.id === dep);
      return {
        value: `dep:${dep}`,
        label: t('pipeline.conversationFrom', { title: label(dep) }),
        detail: depNode?.lastRun?.sessionId ? machineName(depNode.lastRun.machineId) : t('pipeline.conversationNotYet'),
      };
    }),
  ];
  const sourceId = conversationSource(pipeline, node);
  const sourceNode = sourceId ? pipeline.nodes.find((entry) => entry.id === sourceId) : undefined;
  const sourceMachine = sourceNode ? (sourceNode.lastRun?.machineId ?? sourceNode.machineId) : null;
  const conversationNote = !sourceNode
    ? null
    : sourceMachine && node.machineId && sourceMachine !== node.machineId
      ? t('pipeline.conversationMove', { from: machineName(sourceMachine), to: machine?.label ?? '' })
      : t('pipeline.conversationSame');

  const start = async () => {
    setBusy(true);
    const ok = await conductor.startNode(project.key, node.id);
    setBusy(false);
    setConfirm(false);
    if (!ok) toast.show({ text: t('launch.failed', { title, machine: machine?.label ?? '' }), tone: 'error' });
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 18, gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Txt variant="heading">{title}</Txt>
          <Txt variant="meta" numberOfLines={1}>
            {evaluation.task.subtitle}
          </Txt>
        </View>
        <IconButton icon="x" size="sm" accessibilityLabel={t('common.close')} onPress={onClose} />
      </View>
      <StatusLabel tone={nodeTone(state)} label={t(`state.${state}`)} />
      {state === 'review' || state === 'queued' || state === 'offline' ? <Txt variant="meta">{t(`state.hint.${state}`)}</Txt> : null}
      {launchError ? <Banner tone="error" text={t(launchError.key, launchError.params)} /> : null}

      <Select
        label={t('pipeline.machine')}
        value={node.machineId ?? 'unassigned'}
        options={memberOptions}
        onChange={(value) => conductor.editPipeline(project.key, (p, now) => assignTask(p, node.ref, value === 'unassigned' ? null : value, now))}
      />

      <View style={{ gap: 6 }}>
        <Txt variant="groupLabel">{t('pipeline.dependsOn')}</Txt>
        {evaluation.deps.length ? (
          evaluation.deps.map((dep) => (
            <View key={dep} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Dot kind={nodeDot(evaluations[dep]?.state ?? 'missing')} />
              <Txt variant="ui" numberOfLines={1} style={{ flex: 1 }}>
                {label(dep)}
              </Txt>
              <IconButton icon="unlink" size="sm" accessibilityLabel={t('pipeline.removeLink')} onPress={() => conductor.editPipeline(project.key, (p, now) => disconnect(p, dep, node.id, now))} />
            </View>
          ))
        ) : (
          <Txt variant="meta">{t('pipeline.noDeps')}</Txt>
        )}
      </View>
      {dependents.length ? (
        <View style={{ gap: 6 }}>
          <Txt variant="groupLabel">{t('pipeline.dependents')}</Txt>
          {dependents.map((id) => (
            <View key={id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Dot kind={nodeDot(evaluations[id]?.state ?? 'missing')} />
              <Txt variant="ui" numberOfLines={1} style={{ flex: 1 }}>
                {label(id)}
              </Txt>
            </View>
          ))}
        </View>
      ) : null}

      {run ? (
        <View style={{ gap: 6 }}>
          <Divider />
          <Txt variant="groupLabel" style={{ marginTop: 6 }}>
            {t('pipeline.lastRun')}
          </Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <StatusLabel tone={runTone(run.status)} label={t(`run.status.${['running', 'stopping', 'completed', 'failed', 'stopped'].includes(run.status) ? run.status : 'unknown'}`)} />
            <Txt variant="caption">{t('run.started', { time: formatTime(t.lang, run.startedAt) })}</Txt>
          </View>
          {run.error ? (
            <Txt variant="meta" tone="red" numberOfLines={3}>
              {run.error}
            </Txt>
          ) : null}
          {runKey ? (
            <View style={{ flexDirection: 'row' }}>
              <Button variant="secondary" compact icon="arrow-up-right" label={t('run.open')} onPress={() => router.push(runHref(runKey) as never)} />
            </View>
          ) : null}
        </View>
      ) : null}

      {conversationOptions.length > 2 ? (
        <View style={{ gap: 6 }}>
          <Select
            label={t('pipeline.conversation')}
            value={conversationValue}
            options={conversationOptions}
            onChange={(value) =>
              conductor.editPipeline(project.key, (p, now) =>
                setConversation(
                  p,
                  node.id,
                  value === 'default' ? undefined : value === 'new' ? { mode: 'new' } : { mode: 'continue', from: value === 'self' ? node.id : value.slice(4) },
                  now,
                ),
              )
            }
          />
          {conversationNote ? <Txt variant="meta">{conversationNote}</Txt> : null}
        </View>
      ) : null}

      <Divider />
      <View style={{ gap: 10 }}>
        <Select
          label={t('pipeline.model')}
          value={node.model ?? ''}
          placeholder={t('pipeline.studioDefault')}
          options={[{ value: '', label: t('pipeline.studioDefault') }, ...catalog.map((model) => ({ value: model.id, label: model.name ?? model.id, detail: model.id }))]}
          onChange={(value) => conductor.editPipeline(project.key, (p, now) => updateNode(p, node.id, { model: value || undefined }, now))}
        />
        <Select
          label={t('pipeline.thinking')}
          value={node.thinking ?? ''}
          placeholder={t('pipeline.studioDefault')}
          options={[{ value: '', label: t('pipeline.studioDefault') }, ...THINKING_LEVELS.map((level) => ({ value: level, label: level }))]}
          onChange={(value) => conductor.editPipeline(project.key, (p, now) => updateNode(p, node.id, { thinking: (value || undefined) as Thinking | undefined }, now))}
        />
      </View>

      <View style={{ gap: 8, marginTop: 4 }}>
        {state === 'running' && runKey ? (
          <Button variant="secondary" icon="stop" label={t('run.stop')} full onPress={() => void conductor.stopRun(runKey)} />
        ) : canStart ? (
          <Button variant="primary" icon="play" full label={(restart ? t('pipeline.restartOn', { machine: machine?.label ?? '' }) : t('pipeline.startOn', { machine: machine?.label ?? '' }))} onPress={() => setConfirm(true)} />
        ) : null}
        {state !== 'done' && state !== 'running' && state !== 'missing' ? (
          <Button variant="secondary" icon="check" full label={t('roadmap.markDone')} onPress={() => void conductor.markDone(project.key, node.id)} />
        ) : null}
        <Button variant="text" icon="trash" label={t('pipeline.remove')} onPress={() => {
          conductor.editPipeline(project.key, (p, now) => removeNode(p, node.id, now));
          onClose();
        }} />
      </View>

      <Dialog
        visible={confirm}
        onClose={() => setConfirm(false)}
        icon="play"
        title={t('pipeline.startConfirmTitle')}
        description={t('pipeline.startConfirmText', { machine: machine?.label ?? '' })}
        actions={
          <ButtonRow align="end">
            <Button variant="secondary" label={t('common.cancel')} onPress={() => setConfirm(false)} />
            <Button variant="primary" label={t('pipeline.start')} loading={busy} onPress={() => void start()} />
          </ButtonRow>
        }
      >
        <Txt variant="body" style={{ color: colors.text }}>
          {title}
        </Txt>
      </Dialog>
    </ScrollView>
  );
}
