// Overview: projects of every machine, grouped by project (top level of the app).
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, View } from 'react-native';

import { ActivityFeed } from '@/features/fleet/ActivityFeed';
import { ProjectCard } from '@/features/fleet/ProjectCard';
import { useT } from '@/i18n';
import { ScreenHeader } from '@/shell/ScreenHeader';
import { conductor, useFleet } from '@/state/hooks';
import { EmptyState, IconButton, MachineChip, Row, SectionHeader, Txt } from '@/ui/components';
import { useLayoutMode } from '@/ui/layout';
import { useTheme } from '@/ui/theme-context';

export default function Home() {
  const t = useT();
  const router = useRouter();
  const mode = useLayoutMode();
  const { colors } = useTheme();
  const machines = useFleet((state) => state.machines);
  const runtimes = useFleet((state) => state.runtimes);
  const projects = useFleet((state) => state.projects);
  const hydrated = useFleet((state) => state.hydrated);
  const hasActivity = useFleet((state) => state.activity.length > 0);
  const shared = useMemo(() => projects.filter((p) => p.members.length > 1), [projects]);
  const local = useMemo(() => projects.filter((p) => p.members.length <= 1), [projects]);
  const online = machines.filter((m) => runtimes[m.key]?.state === 'online').length;
  const wide = mode === 'desktop';

  const header = (
    <ScreenHeader
      crumbs={[t('nav.home')]}
      icon="layout"
      actions={<IconButton icon="refresh" size="header" accessibilityLabel={t('common.refresh')} onPress={() => void conductor.refreshAll()} />}
    />
  );

  if (hydrated && !machines.length)
    return (
      <View style={{ flex: 1 }}>
        {header}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <EmptyState
            icon="machine"
            title={t('home.noMachines')}
            text={t('home.noMachinesText')}
            actionLabel={t('nav.addMachine')}
            actionPrimary
            onAction={() => router.push('/machines?add=1' as never)}
          />
        </View>
      </View>
    );

  return (
    <View style={{ flex: 1 }}>
      {header}
      <ScrollView contentContainerStyle={{ padding: mode === 'phone' ? 16 : 27, gap: 24, maxWidth: 1320, width: '100%', alignSelf: 'center' }}>
        <Txt variant="body" tone="muted">
          {`${t('home.subtitle')} ${t('nav.footer', { count: machines.length, online })}.`}
        </Txt>
        <View style={{ flexDirection: wide && hasActivity ? 'row' : 'column', gap: 24, alignItems: 'flex-start' }}>
          <View style={{ flex: wide && hasActivity ? 1 : undefined, width: wide && hasActivity ? undefined : '100%', gap: 14 }}>
            <SectionHeader label={t('home.sharedProjects')} paddingHorizontal={0} />
            {shared.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
                {shared.map((project) => (
                  <View key={project.key} style={{ width: mode === 'phone' ? '100%' : 360, flexGrow: mode === 'phone' ? 0 : 1, maxWidth: mode === 'phone' ? undefined : 520 }}>
                    <ProjectCard project={project} />
                  </View>
                ))}
              </View>
            ) : (
              <Txt variant="meta" tone="faint">
                {t('home.noProjects')}
              </Txt>
            )}
            {local.length ? (
              <View style={{ marginTop: 12, gap: 4 }}>
                <SectionHeader label={t('home.localProjects')} paddingHorizontal={0} />
                <View style={{ borderTopWidth: 1, borderTopColor: colors.line }}>
                  {local.map((project) => {
                    const member = project.members[0];
                    const machine = machines.find((m) => m.key === member?.machineKey);
                    return (
                      <Row
                        key={project.key}
                        label={project.name}
                        icon="folder"
                        onPress={() => router.push(`/project/${encodeURIComponent(project.key)}` as never)}
                        trailing={machine ? <MachineChip name={machine.label} color={machine.color} variant="dot" /> : undefined}
                      />
                    );
                  })}
                </View>
              </View>
            ) : null}
          </View>
          {hasActivity ? (
            <View style={{ width: wide ? 340 : '100%', gap: 10 }}>
              <SectionHeader label={t('activity.title')} paddingHorizontal={0} />
              <ActivityFeed />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
