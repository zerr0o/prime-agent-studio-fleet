// Pipeline tab: lanes per machine, tasks as nodes, dependencies as links, auto mode.
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { autoLayout, connect, conversationSource, disconnect, moveNode, nextToLaunch, setConversation, UNASSIGNED, type ConnectError } from '@/domain/pipeline';
import type { EditorEdge, EditorLane, EditorNode } from '@/domain/types';
import { NodeEditor } from '@/features/pipeline/NodeEditor';
import { useProjectKey } from '@/features/project/nav';
import { formatTime, useT } from '@/i18n';
import { conductor, useFleet, usePipeline, useProject } from '@/state/hooks';
import { Button, ButtonRow, Dialog, EmptyState, IconButton, Switch, Txt, useToast } from '@/ui/components';
import { useLayoutMode } from '@/ui/layout';
import { useTheme } from '@/ui/theme-context';
import { pipelineCounts } from '../fleet/ProjectCard';
import { AddTasksDialog } from './AddTasksDialog';
import { InstructionsDialog } from './InstructionsDialog';
import { NodePanel } from './NodePanel';

export function PipelinePane() {
  const t = useT();
  const key = useProjectKey();
  const toast = useToast();
  const mode = useLayoutMode();
  const { colors } = useTheme();
  const { project, statuses, reference, runtimes } = useProject(key);
  const { pipeline, evaluations } = usePipeline(key);
  const machines = useFleet((state) => state.machines);
  const runs = useFleet((state) => state.runs);
  const launches = useFleet((state) => state.launches);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [instructions, setInstructions] = useState(false);
  const [autoConfirm, setAutoConfirm] = useState(false);
  const [starting, setStarting] = useState(false);
  const phone = mode === 'phone';

  const machineOf = (machineId: string) => machines.find((m) => (m.machineId ?? runtimes[m.key]?.info?.machineId) === machineId);

  const lanes = useMemo<EditorLane[]>(() => {
    if (!project) return [];
    const list: EditorLane[] = project.members.map((member) => {
      const machine = machines.find((m) => m.key === member.machineKey);
      const active = Object.values(runs).filter((live) => live.machineKey === member.machineKey && live.projectKey === key && (live.run.status === 'running' || live.run.status === 'stopping')).length;
      const sync = statuses[member.machineKey];
      return {
        id: member.machineId,
        label: machine?.label ?? member.name,
        color: machine?.color ?? null,
        online: runtimes[member.machineKey]?.state === 'online',
        meta: [project.members.length > 1 && sync ? t(`sync.${sync}`) : null, active ? t('run.status.running') : null].filter(Boolean).join(' · '),
      };
    });
    // Nodes assigned to a machine without this project keep a lane, so nothing hides.
    for (const node of pipeline?.nodes ?? [])
      if (node.machineId && !list.some((lane) => lane.id === node.machineId)) {
        const machine = machineOf(node.machineId);
        list.push({ id: node.machineId, label: machine?.label ?? node.machineId.slice(0, 8), color: machine?.color ?? null, online: false, meta: t('roadmap.notOnMachine') });
      }
    list.push({ id: UNASSIGNED, label: t('pipeline.unassignedLane'), color: null, online: null });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, machines, runs, statuses, runtimes, pipeline, key, t]);

  const nodes = useMemo<EditorNode[]>(
    () =>
      (pipeline?.nodes ?? []).map((node) => {
        const evaluation = evaluations[node.id];
        const state = evaluation?.state ?? 'waiting';
        let detail: string | undefined;
        if (state === 'done' && evaluation?.task.completion?.machineId) {
          const machine = machineOf(evaluation.task.completion.machineId);
          detail = `${machine?.label ?? ''} · ${formatTime(t.lang, evaluation.task.completion.completedAt)}`;
        } else if (state === 'waiting' && evaluation?.pendingDeps.length) detail = t('pipeline.waitsFor', { count: evaluation.pendingDeps.length });
        else if (state === 'running' && node.lastRun) detail = formatTime(t.lang, node.lastRun.startedAt);
        else if (evaluation?.reopened) detail = t('pipeline.reopened');
        // A failed start keeps the node "ready" for the engine but needs a person: show it.
        const launchError = (state === 'ready' || state === 'queued') && launches[`${key}|${node.id}`]?.error;
        return {
          id: node.id,
          laneId: node.machineId ?? UNASSIGNED,
          x: node.x,
          title: evaluation?.task.title || node.id,
          subtitle: evaluation?.task.subtitle || '',
          planColor: evaluation?.task.planColor,
          state: launchError ? 'review' : state,
          stateLabel: launchError ? t('state.launchFailed') : t(`state.${state}`),
          detail,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pipeline, evaluations, t, machines, runtimes, launches, key],
  );

  const edges = useMemo<EditorEdge[]>(() => {
    if (!pipeline) return [];
    const sources = new Map(pipeline.nodes.map((node) => [node.id, conversationSource(pipeline, node)]));
    return pipeline.edges.map((edge) => ({
      id: `${edge.from}->${edge.to}`,
      from: edge.from,
      to: edge.to,
      satisfied: evaluations[edge.from]?.state === 'done',
      conversation: sources.get(edge.to) === edge.from,
    }));
  }, [pipeline, evaluations]);

  if (!project) return null;
  const counts = pipelineCounts(Object.values(evaluations).map((e) => e.state));
  const ready = pipeline ? nextToLaunch(pipeline, evaluations).length : 0;
  const auto = !!pipeline?.auto;

  const onConnect = (from: string, to: string) => {
    let error: ConnectError | undefined;
    conductor.editPipeline(key, (p, now) => {
      const result = connect(p, from, to, now);
      error = result.error;
      return result.pipeline;
    });
    if (error) toast.show({ text: t(`pipeline.linkError.${error}`), tone: 'error' });
  };

  const selectedLink = pipeline?.edges.find((e) => `${e.from}->${e.to}` === selectedEdge);
  const titleOf = (id: string) => evaluations[id]?.task.title || id;
  const linkTarget = selectedLink ? pipeline?.nodes.find((n) => n.id === selectedLink.to) : undefined;
  const linkSourceNode = selectedLink ? pipeline?.nodes.find((n) => n.id === selectedLink.from) : undefined;
  const linkCarries = !!(pipeline && selectedLink && linkTarget && conversationSource(pipeline, linkTarget) === selectedLink.from);
  const linkFromMachine = linkSourceNode?.lastRun?.machineId ?? linkSourceNode?.machineId ?? null;
  const linkNote =
    linkFromMachine && linkTarget?.machineId && linkFromMachine !== linkTarget.machineId
      ? t('pipeline.conversationMove', { from: machineOf(linkFromMachine)?.label ?? '', to: machineOf(linkTarget.machineId)?.label ?? '' })
      : t('pipeline.conversationSame');
  const toggleLinkConversation = (on: boolean) => {
    if (!selectedLink) return;
    conductor.editPipeline(key, (p, now) =>
      setConversation(p, selectedLink.to, on ? { mode: 'continue', from: selectedLink.from } : p.conversation === 'continue' ? { mode: 'new' } : undefined, now),
    );
  };

  const removeEdge = () => {
    if (selectedLink) conductor.editPipeline(key, (p, now) => disconnect(p, selectedLink.from, selectedLink.to, now));
    setSelectedEdge(null);
  };

  const toggleAuto = (value: boolean) => {
    if (value) setAutoConfirm(true);
    else void conductor.setAuto(key, false);
  };

  const startReady = async () => {
    setStarting(true);
    await conductor.evaluateProject(key, { allowAuto: false, force: true });
    setStarting(false);
  };

  const panel = selected ? (
    <NodePanel project={project} pipeline={pipeline!} evaluations={evaluations} nodeId={selected} onClose={() => setSelected(null)} />
  ) : selectedEdge && selectedLink ? (
    <View style={{ padding: 18, gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <Txt variant="heading" style={{ flex: 1 }}>
          {t('pipeline.linkTitle', { from: titleOf(selectedLink.from), to: titleOf(selectedLink.to) })}
        </Txt>
        <IconButton icon="x" size="sm" accessibilityLabel={t('common.close')} onPress={() => setSelectedEdge(null)} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Txt variant="uiStrong">{t('pipeline.conversation')}</Txt>
          <Txt variant="meta">{t('pipeline.conversationEdge', { from: titleOf(selectedLink.from), to: titleOf(selectedLink.to) })}</Txt>
        </View>
        <Switch value={linkCarries} onValueChange={toggleLinkConversation} accessibilityLabel={t('pipeline.conversationEdge', { from: titleOf(selectedLink.from), to: titleOf(selectedLink.to) })} />
      </View>
      {linkCarries ? <Txt variant="meta">{linkNote}</Txt> : null}
      <ButtonRow>
        <Button variant="secondary" icon="unlink" label={t('pipeline.removeLink')} onPress={removeEdge} />
      </ButtonRow>
    </View>
  ) : null;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingHorizontal: phone ? 12 : 18, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.line }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Switch value={auto} onValueChange={toggleAuto} accessibilityLabel={t('pipeline.auto')} disabled={!pipeline?.nodes.length} />
          <Txt variant="uiStrong">{t('pipeline.auto')}</Txt>
        </View>
        {!phone ? (
          <Txt variant="meta" numberOfLines={1} style={{ flexShrink: 1 }}>
            {pipeline?.nodes.length ? t('pipeline.counts', counts) : t('pipeline.autoHint')}
          </Txt>
        ) : null}
        <View style={{ flex: 1 }} />
        {!auto && ready ? <Button variant={selected ? 'secondary' : 'primary'} compact icon="play" label={t('pipeline.startReady')} loading={starting} onPress={() => void startReady()} /> : null}
        <Button variant="secondary" compact icon="plus" label={t('pipeline.addTasks')} onPress={() => setAdding(true)} />
        <IconButton icon="layout" accessibilityLabel={t('pipeline.arrange')} title={t('pipeline.arrange')} onPress={() => conductor.editPipeline(key, (p, now) => autoLayout(p, now))} />
        <IconButton icon="pencil" accessibilityLabel={t('pipeline.settings')} title={t('pipeline.settings')} onPress={() => setInstructions(true)} />
      </View>
      {!pipeline?.nodes.length ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <EmptyState icon="pipeline" title={t('pipeline.title')} text={t('pipeline.empty')} actionLabel={t('pipeline.emptyAction')} actionPrimary onAction={() => setAdding(true)} />
        </View>
      ) : (
        <View style={{ flex: 1, flexDirection: phone ? 'column' : 'row', minHeight: 0 }}>
          <NodeEditor
            style={{ flex: 1 }}
            showToolbar={!(phone && panel)}
            lanes={lanes}
            nodes={nodes}
            edges={edges}
            selectedId={selected}
            onSelect={(id) => {
              setSelected(id);
              if (id) setSelectedEdge(null);
            }}
            selectedEdgeId={selectedEdge}
            onSelectEdge={(id) => {
              setSelectedEdge(id);
              if (id) setSelected(null);
            }}
            onMoveNode={(id, laneId, x) => conductor.editPipeline(key, (p, now) => moveNode(p, id, laneId === UNASSIGNED ? null : laneId, x, now))}
            onConnect={onConnect}
            labels={{ unassignedLane: t('pipeline.unassignedLane'), emptyLane: t('pipeline.emptyLane'), fit: t('pipeline.fit'), zoomIn: t('pipeline.zoomIn'), zoomOut: t('pipeline.zoomOut') }}
          />
          {panel ? (
            <View
              style={
                phone
                  ? { maxHeight: '55%', borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.bg }
                  : { width: 320, borderLeftWidth: 1, borderLeftColor: colors.line, backgroundColor: colors.bg }
              }
            >
              {panel}
            </View>
          ) : null}
        </View>
      )}
      <AddTasksDialog visible={adding} onClose={() => setAdding(false)} project={project} pipeline={pipeline} doc={reference?.doc} />
      {pipeline ? <InstructionsDialog visible={instructions} onClose={() => setInstructions(false)} projectKey={key} pipeline={pipeline} /> : null}
      <Dialog
        visible={autoConfirm}
        onClose={() => setAutoConfirm(false)}
        icon="play"
        title={t('pipeline.autoOnTitle')}
        description={ready ? t('pipeline.autoOnText', { count: ready }) : t('pipeline.autoOnTextNone')}
        actions={
          <ButtonRow align="end">
            <Button variant="secondary" label={t('common.cancel')} onPress={() => setAutoConfirm(false)} />
            <Button
              variant="primary"
              label={t('pipeline.autoOn')}
              onPress={() => {
                setAutoConfirm(false);
                void conductor.setAuto(key, true);
              }}
            />
          </ButtonRow>
        }
      >
        <Txt variant="meta">{t('pipeline.autoHint')}</Txt>
      </Dialog>
    </View>
  );
}
