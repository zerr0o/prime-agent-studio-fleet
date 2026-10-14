// Project screen: header with breadcrumb and sync action, tabs, then the tab content.
import { Slot, usePathname, useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { View } from 'react-native';

import { projectHref, useProjectKey } from '@/features/project/nav';
import { useT } from '@/i18n';
import { ScreenHeader } from '@/shell/ScreenHeader';
import { conductor, useFleet, useProject } from '@/state/hooks';
import { Button, EmptyState, IconButton, TabBar } from '@/ui/components';

export default function ProjectLayout() {
  const t = useT();
  const key = useProjectKey();
  const router = useRouter();
  const pathname = usePathname();
  const { project } = useProject(key);
  const job = useFleet((state) => state.syncJobs[key]);
  const machines = useFleet((state) => state.machines);
  const runs = useFleet((state) => state.runs);
  const pipeline = useFleet((state) => state.pipelines[key]);

  useEffect(() => {
    conductor.setFocus(key);
    return () => conductor.setFocus(null);
  }, [key]);

  const tab = pathname.endsWith('/roadmap') ? 'roadmap' : pathname.endsWith('/pipeline') ? 'pipeline' : pathname.endsWith('/runs') ? 'runs' : 'overview';
  const runCount = useMemo(() => Object.values(runs).filter((live) => live.projectKey === key && (live.run.status === 'running' || live.run.status === 'stopping')).length, [runs, key]);
  const tabs = [
    { key: 'overview', label: t('tab.overview'), icon: 'layout' as const },
    { key: 'roadmap', label: t('tab.roadmap'), icon: 'roadmap' as const },
    { key: 'pipeline', label: t('tab.pipeline'), icon: 'pipeline' as const, count: pipeline?.nodes.length || undefined },
    { key: 'runs', label: t('tab.runs'), icon: 'session' as const, count: runCount || undefined },
  ];
  const phaseMachine = job?.machineKey ? machines.find((m) => m.key === job.machineKey)?.label ?? '' : '';
  const syncLabel = job?.running ? (job.phase ? t(`sync.phase.${job.phase}`, { machine: phaseMachine }) : t('sync.running')) : t('sync.now');

  if (!project)
    return (
      <View style={{ flex: 1 }}>
        <ScreenHeader crumbs={[t('nav.projects')]} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <EmptyState icon="folder" title={t('nav.projects')} text={t('project.notFound')} actionLabel={t('common.refresh')} onAction={() => void conductor.refreshAll()} />
        </View>
      </View>
    );

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader
        crumbs={[project.name, tabs.find((entry) => entry.key === tab)?.label ?? '']}
        icon="folder"
        phoneActions={
          project.syncId && project.members.length > 1 ? (
            <IconButton icon="sync" accessibilityLabel={syncLabel} disabled={job?.running} onPress={() => void conductor.syncProject(key)} />
          ) : (
            <IconButton icon="refresh" accessibilityLabel={t('common.refresh')} onPress={() => void conductor.refreshRoadmaps(key)} />
          )
        }
        actions={
          project.syncId && project.members.length > 1 ? (
            <Button variant="secondary" compact icon="sync" label={syncLabel} loading={job?.running} disabled={job?.running} onPress={() => void conductor.syncProject(key)} />
          ) : (
            <Button variant="secondary" compact icon="refresh" label={t('common.refresh')} onPress={() => void conductor.refreshRoadmaps(key)} />
          )
        }
      />
      <TabBar tabs={tabs} activeKey={tab} onChange={(next) => router.replace(projectHref(key, next === 'overview' ? '' : next) as never)} />
      <View style={{ flex: 1, minHeight: 0 }}>
        <Slot />
      </View>
    </View>
  );
}
