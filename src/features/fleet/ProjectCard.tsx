// Card of a project on the overview: machines with their sync status, progress, pipeline.
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';

import { countSteps, visiblePlans } from '@/domain/roadmap';
import type { FleetProject } from '@/domain/types';
import { useT } from '@/i18n';
import { useFleet, usePipeline, useProject } from '@/state/hooks';
import { Card, Dot, MachineChip, Progress, StatusLabel, Txt } from '@/ui/components';
import { Icon } from '@/ui/icons';
import { useTheme } from '@/ui/theme-context';
import { connDot, syncTone } from './status';

export function pipelineCounts(states: string[]) {
  const count = (s: string) => states.filter((x) => x === s).length;
  return {
    done: count('done'),
    running: count('running'),
    ready: count('ready') + count('queued'),
    waiting: states.length - count('done') - count('running') - count('ready') - count('queued'),
  };
}

export function ProjectCard({ project }: { project: FleetProject }) {
  const t = useT();
  const router = useRouter();
  const { colors } = useTheme();
  const machines = useFleet((state) => state.machines);
  const runs = useFleet((state) => state.runs);
  const { statuses, reference, runtimes } = useProject(project.key);
  const { pipeline, evaluations } = usePipeline(project.key);
  const progress = useMemo(() => {
    if (!reference) return null;
    let done = 0;
    let total = 0;
    for (const plan of visiblePlans(reference.doc)) {
      const value = countSteps(plan.steps);
      done += value.done;
      total += value.total;
    }
    return { done, total };
  }, [reference]);
  const running = Object.values(runs).filter((live) => live.projectKey === project.key && (live.run.status === 'running' || live.run.status === 'stopping')).length;
  const counts = pipeline ? pipelineCounts(Object.values(evaluations).map((e) => e.state)) : null;

  return (
    <Card onPress={() => router.push(`/project/${encodeURIComponent(project.key)}` as never)} accessibilityLabel={project.name} style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        <Icon name="folder" size={15} color={colors.muted} />
        <Txt variant="heading" numberOfLines={1} style={{ flex: 1 }}>
          {project.name}
        </Txt>
        {running ? <StatusLabel tone="running" label={t('run.status.running')} /> : null}
      </View>
      <View style={{ gap: 7 }}>
        {project.members.map((member) => {
          const machine = machines.find((m) => m.key === member.machineKey);
          const runtime = runtimes[member.machineKey];
          return (
            <View key={member.machineKey} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <MachineChip name={machine?.label ?? member.name} color={machine?.color ?? colors.faint} variant="dot" status={connDot(runtime?.state)} muted={runtime?.state !== 'online'} style={{ flex: 1 }} />
              {project.members.length > 1 ? <StatusLabel tone={syncTone(statuses[member.machineKey])} label={t(`sync.${statuses[member.machineKey] ?? 'unknown'}`)} /> : null}
            </View>
          );
        })}
      </View>
      {progress && progress.total ? (
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Txt variant="meta">{t('roadmap.tasksChecked', { done: progress.done, count: progress.total })}</Txt>
            <Txt variant="meta" tone="accent" style={{ fontVariant: ['tabular-nums'] }}>
              {Math.round((progress.done / progress.total) * 100)}
              {t.lang === 'fr' ? '\u00a0%' : '%'}
            </Txt>
          </View>
          <Progress value={progress.done / progress.total} />
        </View>
      ) : (
        <Txt variant="caption">{project.members.length > 1 ? t('home.notLoaded') : t('home.machinesCount', { count: 1 })}</Txt>
      )}
      {pipeline && counts && pipeline.nodes.length ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <Dot kind={pipeline.auto ? 'connected' : 'idle'} size={5} />
          <Txt variant="caption" tone="muted" numberOfLines={1}>
            {`${t(pipeline.auto ? 'home.pipelineAuto' : 'home.pipelineManual')} · ${t('pipeline.counts', counts)}`}
          </Txt>
        </View>
      ) : null}
    </Card>
  );
}
