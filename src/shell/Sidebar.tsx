// Sidebar: brand, add a machine, search, pending questions, projects (by machine count), machines.
import { usePathname, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { formatTime, useT } from '@/i18n';
import { useFleet } from '@/state/hooks';
import { pendingQuestions, type FleetState } from '@/state/store';
import { memberStatuses } from '@/domain/syncStatus';
import type { FleetProject, MemberSyncStatus } from '@/domain/types';
import { Button, Count, Disclosure, Dot, Row, SearchField, SectionHeader, SubRow, Tag, Txt, type DotKind } from '@/ui/components';
import { Icon } from '@/ui/icons';
import { fw } from '@/ui/components/interaction';
import { fontSize, weight } from '@/ui/theme';
import { useTheme } from '@/ui/theme-context';

export const syncDot = (status: MemberSyncStatus | undefined): DotKind =>
  status === 'synced' ? 'connected' : status === 'latest' ? 'unread' : status === 'behind' || status === 'diverged' ? 'attention' : 'idle';

export function Brand() {
  const { colors } = useTheme();
  const t = useT();
  return (
    <View style={{ height: 88, paddingHorizontal: 23, flexDirection: 'row', alignItems: 'center', gap: 11 }}>
      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="pipeline" size={22} color={colors.accentInk} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt style={{ fontSize: fontSize.brand, fontWeight: fw(weight.heavy), letterSpacing: -1.1, lineHeight: 26 }}>prime</Txt>
        <Txt variant="micro" tone="muted" style={{ fontSize: 8, letterSpacing: 1.6, textTransform: 'uppercase', marginTop: 2, fontWeight: fw(weight.semi) }}>
          {t('app.sub')}
        </Txt>
      </View>
      <Tag label="API v1" />
    </View>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const projects = useFleet((state) => state.projects);
  const machines = useFleet((state) => state.machines);
  const runtimes = useFleet((state) => state.runtimes);
  const copies = useFleet((state) => state.copies);
  const runs = useFleet((state) => state.runs);
  const questions = useMemo(() => pendingQuestions({ runs } as FleetState), [runs]);

  const go = (href: string) => {
    router.push(href as never);
    onNavigate?.();
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects;
  }, [projects, query]);
  const shared = filtered.filter((p) => p.members.length > 1);
  const local = filtered.filter((p) => p.members.length <= 1);
  const activeByProject = useMemo(() => {
    const map: Record<string, number> = {};
    for (const live of Object.values(runs))
      if (live.projectKey && (live.run.status === 'running' || live.run.status === 'stopping')) map[live.projectKey] = (map[live.projectKey] ?? 0) + 1;
    return map;
  }, [runs]);
  const activeByMachine = useMemo(() => {
    const map: Record<string, number> = {};
    for (const live of Object.values(runs))
      if (live.run.status === 'running' || live.run.status === 'stopping') map[live.machineKey] = (map[live.machineKey] ?? 0) + 1;
    return map;
  }, [runs]);
  const online = machines.filter((m) => runtimes[m.key]?.state === 'online').length;

  const projectRow = (project: FleetProject) => {
    const href = `/project/${encodeURIComponent(project.key)}`;
    const active = pathname.startsWith(`/project/${encodeURIComponent(project.key)}`) || pathname.startsWith(`/project/${project.key}`);
    const statuses = memberStatuses(project, copies[project.key] ?? {}, runtimes);
    const attention = Object.values(statuses).some((s) => s === 'behind' || s === 'diverged');
    const running = activeByProject[project.key] ?? 0;
    const expanded = open[project.key] ?? false;
    return (
      <View key={project.key}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {project.members.length > 1 ? (
            <Disclosure expanded={expanded} onToggle={() => setOpen((o) => ({ ...o, [project.key]: !expanded }))} accessibilityLabel={project.name} />
          ) : (
            <View style={{ width: 22 }} />
          )}
          <Row
            style={{ flex: 1 }}
            label={project.name}
            icon="folder"
            active={active}
            onPress={() => go(href)}
            trailing={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {running ? <Dot kind="running" /> : attention ? <Dot kind="attention" /> : null}
                {project.members.length > 1 ? <Count value={project.members.length} /> : null}
              </View>
            }
          />
        </View>
        {expanded
          ? project.members.map((member) => {
              const machine = machines.find((m) => m.key === member.machineKey);
              return (
                <SubRow
                  key={member.machineKey}
                  indent={33}
                  label={machine?.label ?? member.name}
                  dotColor={machine?.color}
                  onPress={() => go(href)}
                  trailing={
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Txt variant="caption" tone="faint" numberOfLines={1}>
                        {t(`sync.${statuses[member.machineKey] ?? 'unknown'}`)}
                      </Txt>
                      <Dot kind={syncDot(statuses[member.machineKey])} size={5} />
                    </View>
                  }
                />
              );
            })
          : null}
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.sidebar }}>
      <Brand />
      <View style={{ paddingHorizontal: 16, paddingBottom: 18, gap: 8 }}>
        <Button variant="tinted" icon="plus" label={t('nav.addMachine')} onPress={() => go('/machines?add=1')} />
      </View>
      <View style={{ paddingHorizontal: 16, paddingBottom: 6 }}>
        <SearchField value={query} onChangeText={setQuery} placeholder={t('nav.searchProjects')} accessibilityLabel={t('nav.searchProjects')} />
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 20 }}>
        {questions.length ? (
          <View style={{ marginTop: 10 }}>
            <SectionHeader label={t('nav.questions')} paddingHorizontal={11} />
            {questions.map(({ live, interaction }) => (
              <SubRow
                key={`${live.key}:${interaction.id}`}
                label={interaction.title || t('run.question')}
                icon="question"
                iconColor={colors.amber}
                onPress={() => go(`/run/${encodeURIComponent(live.key)}`)}
                trailing={<Dot kind="attention" />}
              />
            ))}
          </View>
        ) : null}
        <View style={{ marginTop: 14 }}>
          <SectionHeader label={t('nav.projects')} paddingHorizontal={11} />
          {shared.length ? (
            <Txt variant="groupLabel" tone="faint" style={{ marginTop: 10, marginBottom: 7, marginHorizontal: 12 }}>
              {t('nav.shared')}
            </Txt>
          ) : null}
          {shared.map(projectRow)}
          {local.length ? (
            <Txt variant="groupLabel" tone="faint" style={{ marginTop: 16, marginBottom: 7, marginHorizontal: 12 }}>
              {t('nav.local')}
            </Txt>
          ) : null}
          {local.map(projectRow)}
        </View>
        <View style={{ marginTop: 18 }}>
          <SectionHeader label={t('nav.machines')} paddingHorizontal={11} />
          {machines.map((machine) => {
            const runtime = runtimes[machine.key];
            const state = runtime?.state ?? 'unknown';
            const kind: DotKind = state === 'online' ? 'connected' : state === 'offline' || state === 'unknown' || state === 'connecting' ? 'idle' : 'error';
            const runningCount = activeByMachine[machine.key] ?? 0;
            return (
              <Row
                key={machine.key}
                label={machine.label}
                icon="machine"
                iconColor={machine.color}
                active={pathname === '/machines'}
                onPress={() => go('/machines')}
                trailing={
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {runningCount ? <Dot kind="running" /> : <Dot kind={kind} />}
                    {runningCount ? <Count value={runningCount} /> : null}
                  </View>
                }
              />
            );
          })}
        </View>
      </ScrollView>
      <View style={{ borderTopWidth: 1, borderTopColor: colors.lineSoft, paddingTop: 14, paddingBottom: 12, paddingHorizontal: 10, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, paddingBottom: 6 }}>
          <Dot kind={online ? 'connected' : 'idle'} size={5} />
          <Txt variant="caption" tone="faint" style={{ flex: 1 }} numberOfLines={1}>
            {t('nav.footer', { count: machines.length, online })}
          </Txt>
          <Txt variant="micro" tone="faint" style={{ fontFamily: undefined }}>
            v1.0.0
          </Txt>
        </View>
        <Row label={t('nav.home')} icon="layout" active={pathname === '/'} onPress={() => go('/')} />
        <Row label={t('nav.machines')} icon="machine" active={pathname === '/machines'} onPress={() => go('/machines')} />
        <Row label={t('nav.settings')} icon="preferences" active={pathname === '/settings'} onPress={() => go('/settings')} />
      </View>
    </View>
  );
}

export { formatTime };
