// Runs of a project on every machine: in progress first, then recent ones.
import { useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { isRunActive } from '@/api/types';
import { readTask } from '@/domain/pipeline';
import { runTone } from '@/features/fleet/status';
import { runHref, useProjectKey } from '@/features/project/nav';
import { formatDuration, formatTime, useT } from '@/i18n';
import { conductor, useFleet } from '@/state/hooks';
import { Dot, EmptyState, MachineChip, SectionHeader, StatusLabel, Txt } from '@/ui/components';
import { useLayoutMode } from '@/ui/layout';
import { useTheme } from '@/ui/theme-context';

export function RunList() {
  const t = useT();
  const key = useProjectKey();
  const router = useRouter();
  const mode = useLayoutMode();
  const { colors } = useTheme();
  const runs = useFleet((state) => state.runs);
  const machines = useFleet((state) => state.machines);
  const pipelines = useFleet((state) => state.pipelines);
  const copies = useFleet((state) => state.copies);
  const titles = useFleet((state) => state.sessionTitles);
  useEffect(() => {
    void conductor.loadSessions(key);
  }, [key]);

  const list = useMemo(
    () => Object.values(runs).filter((live) => live.projectKey === key).sort((a, b) => b.run.startedAt.localeCompare(a.run.startedAt)),
    [runs, key],
  );
  const active = list.filter((live) => isRunActive(live.run.status));
  const recent = list.filter((live) => !isRunActive(live.run.status));
  const phone = mode === 'phone';

  const row = (live: (typeof list)[number]) => {
    const machine = machines.find((m) => m.key === live.machineKey);
    const node = live.nodeId ? pipelines[key]?.nodes.find((n) => n.id === live.nodeId) : undefined;
    const title = node ? readTask(node.ref, copies[key] ?? {}).task.title : (live.run.sessionId && titles[live.run.sessionId]) || t('run.label', { time: formatTime(t.lang, live.run.startedAt) });
    const status = live.run.status;
    const statusKey = ['running', 'stopping', 'completed', 'failed', 'stopped'].includes(status) ? status : 'unknown';
    const started = Date.parse(live.run.startedAt);
    const ended = live.run.endedAt ? Date.parse(live.run.endedAt) : Date.now();
    const pending = (live.run.interactions ?? []).some((i) => i.status === 'pending');
    return (
      <Pressable
        key={live.key}
        onPress={() => router.push(runHref(live.key) as never)}
        accessibilityRole="button"
        style={({ hovered }: { hovered?: boolean }) => ({ flexDirection: phone ? 'column' : 'row', alignItems: phone ? 'stretch' : 'center', gap: phone ? 6 : 16, paddingVertical: 12, paddingHorizontal: 10, borderRadius: 7, backgroundColor: hovered ? colors.surface : 'transparent', borderBottomWidth: 1, borderBottomColor: colors.line })}
      >
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Txt variant="ui" numberOfLines={1}>
            {title}
          </Txt>
          <Txt variant="caption" numberOfLines={1}>
            {`${formatTime(t.lang, live.run.startedAt)}${Number.isFinite(started) ? ` · ${formatDuration(ended - started)}` : ''}${node ? ` · ${t('tab.pipeline')}` : ''}`}
          </Txt>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          {pending ? <Dot kind="attention" /> : null}
          {machine ? <MachineChip name={machine.label} color={machine.color} variant="dot" /> : null}
          <StatusLabel tone={runTone(status)} label={t(`run.status.${statusKey}`)} />
        </View>
      </Pressable>
    );
  };

  if (!list.length)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <EmptyState icon="session" title={t('tab.runs')} text={t('run.empty')} />
      </View>
    );

  return (
    <ScrollView contentContainerStyle={{ padding: phone ? 16 : 27, gap: 18, maxWidth: 980, width: '100%', alignSelf: 'center' }}>
      {active.length ? (
        <View style={{ gap: 6 }}>
          <SectionHeader label={t('run.active')} paddingHorizontal={0} />
          {active.map(row)}
        </View>
      ) : null}
      {recent.length ? (
        <View style={{ gap: 6 }}>
          <SectionHeader label={t('run.recent')} paddingHorizontal={0} />
          {recent.map(row)}
        </View>
      ) : null}
    </ScrollView>
  );
}
