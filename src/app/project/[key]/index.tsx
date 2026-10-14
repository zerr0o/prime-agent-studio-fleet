// Project overview: machines of the project with their connection and Roadmap sync status.
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, View } from 'react-native';

import { countSteps, visiblePlans } from '@/domain/roadmap';
import { ActivityFeed } from '@/features/fleet/ActivityFeed';
import { projectHref, useProjectKey } from '@/features/project/nav';
import { pipelineCounts } from '@/features/fleet/ProjectCard';
import { connDot, syncTone } from '@/features/fleet/status';
import { formatTime, useT } from '@/i18n';
import { conductor, useFleet, usePipeline, useProject } from '@/state/hooks';
import { Banner, Button, Card, Divider, MachineChip, Progress, SectionHeader, StatusLabel, Tag, Txt } from '@/ui/components';
import { useLayoutMode } from '@/ui/layout';
import { useTheme } from '@/ui/theme-context';

export default function ProjectOverview() {
  const t = useT();
  const key = useProjectKey();
  const router = useRouter();
  const mode = useLayoutMode();
  const { colors } = useTheme();
  const { project, copies, runtimes, statuses } = useProject(key);
  const { pipeline, evaluations } = usePipeline(key);
  const machines = useFleet((state) => state.machines);
  const runs = useFleet((state) => state.runs);
  const job = useFleet((state) => state.syncJobs[key]);
  const phone = mode === 'phone';

  const behind = useMemo(
    () => (project?.members ?? []).filter((m) => statuses[m.machineKey] === 'behind' || statuses[m.machineKey] === 'diverged'),
    [project, statuses],
  );
  if (!project) return null;
  const others = machines.filter((machine) => !project.members.some((member) => member.machineKey === machine.key));
  const label = (machineKey: string) => machines.find((m) => m.key === machineKey)?.label ?? '';
  const counts = pipeline ? pipelineCounts(Object.values(evaluations).map((e) => e.state)) : null;

  return (
    <ScrollView contentContainerStyle={{ padding: phone ? 16 : 27, gap: 22, maxWidth: 1100, width: '100%', alignSelf: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {!project.syncId ? <Tag label={t('project.local')} /> : null}
        <Txt variant="body" tone="muted" style={{ flexShrink: 1 }}>
          {t('home.machinesCount', { count: project.members.length })}
          {project.syncId ? ' · ' : ''}
          {project.syncId ? (
            <Txt variant="mono" tone="faint" style={{ fontSize: 10 }}>
              {project.syncId}
            </Txt>
          ) : null}
        </Txt>
      </View>

      {job?.running ? <Banner tone="info" text={job.phase ? t(`sync.phase.${job.phase}`, { machine: label(job.machineKey ?? '') }) : t('sync.running')} /> : null}
      {!job?.running && behind.length ? (
        <Banner
          tone="warning"
          text={t('sync.behindBanner', { count: behind.length, names: behind.map((m) => label(m.machineKey)).join(', ') })}
          actionLabel={t('sync.now')}
          onAction={() => void conductor.syncProject(key)}
        />
      ) : null}
      {!job?.running && job?.warnings.length ? job.warnings.map((warning, index) => <Banner key={index} tone="warning" text={t(warning.key, warning.params)} />) : null}

      <View style={{ gap: 10 }}>
        <SectionHeader label={t('project.machines')} paddingHorizontal={0} />
        <View style={{ borderTopWidth: 1, borderTopColor: colors.line }}>
          {project.members.map((member) => {
            const machine = machines.find((m) => m.key === member.machineKey);
            const runtime = runtimes[member.machineKey];
            const copy = copies[member.machineKey];
            const status = statuses[member.machineKey];
            let done = 0;
            let total = 0;
            for (const plan of visiblePlans(copy?.doc)) {
              const value = countSteps(plan.steps);
              done += value.done;
              total += value.total;
            }
            const active = Object.values(runs).filter((live) => live.projectKey === key && live.machineKey === member.machineKey && (live.run.status === 'running' || live.run.status === 'stopping')).length;
            const lastSync = runtime?.sync?.lastSync?.at;
            return (
              <View key={member.machineKey} style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: phone ? 'column' : 'row', gap: phone ? 10 : 18, alignItems: phone ? 'stretch' : 'center' }}>
                <View style={{ width: phone ? undefined : 220, gap: 4 }}>
                  <MachineChip name={machine?.label ?? member.name} color={machine?.color ?? colors.faint} status={connDot(runtime?.state)} muted={runtime?.state !== 'online'} />
                  <Txt variant="caption" numberOfLines={1}>
                    {member.name !== project.name ? `${member.name} · ` : ''}
                    {t(`conn.${runtime?.state ?? 'unknown'}`)}
                    {active ? ` · ${t('run.status.running')}` : ''}
                  </Txt>
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <StatusLabel tone={syncTone(status)} label={t(`sync.${status ?? 'unknown'}`)} />
                  <Txt variant="meta" numberOfLines={2}>
                    {t(`sync.hint.${status ?? 'unknown'}`)}
                  </Txt>
                </View>
                <View style={{ width: phone ? undefined : 220, gap: 6 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                    <Txt variant="meta" numberOfLines={1}>
                      {copy ? t('project.revision', { revision: copy.doc.revision }) : '·'}
                    </Txt>
                    <Txt variant="meta" numberOfLines={1} style={{ fontVariant: ['tabular-nums'] }}>
                      {total ? `${done}/${total}` : ''}
                    </Txt>
                  </View>
                  <Progress value={total ? done / total : 0} />
                  <Txt variant="caption" numberOfLines={1}>
                    {runtime?.sync?.configured === false ? t('machines.syncOff') : lastSync ? t('sync.lastSync', { time: formatTime(t.lang, lastSync) }) : t('sync.never')}
                  </Txt>
                </View>
              </View>
            );
          })}
        </View>
        {others.length ? (
          <Txt variant="meta" tone="faint">
            {t('project.otherMachines', { names: others.map((m) => m.label).join(', ') })}
          </Txt>
        ) : null}
      </View>

      <View style={{ flexDirection: phone ? 'column' : 'row', gap: 22, alignItems: 'flex-start' }}>
        <Card style={{ flex: phone ? undefined : 1, width: phone ? '100%' : undefined, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <Txt variant="heading">{t('project.pipelineSummary')}</Txt>
            {pipeline?.nodes.length ? <StatusLabel tone={pipeline.auto ? 'connected' : 'muted'} label={t(pipeline.auto ? 'home.pipelineAuto' : 'home.pipelineManual')} /> : null}
          </View>
          <Txt variant="meta">{counts && pipeline?.nodes.length ? t('pipeline.counts', counts) : t('project.noPipeline')}</Txt>
          <View style={{ flexDirection: 'row' }}>
            <Button variant="secondary" compact icon="pipeline" label={t('project.openPipeline')} onPress={() => router.replace(projectHref(key, 'pipeline') as never)} />
          </View>
        </Card>
        <View style={{ flex: phone ? undefined : 1, width: phone ? '100%' : undefined, gap: 10 }}>
          <SectionHeader label={t('project.activity')} paddingHorizontal={0} />
          <ActivityFeed projectKey={key} limit={12} />
        </View>
      </View>
      <Divider soft />
    </ScrollView>
  );
}

