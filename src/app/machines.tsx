// Machines: the Studios driven by the app, with their connection and sync details.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import type { MachineConfig } from '@/domain/types';
import { MachineDialog } from '@/features/fleet/MachineDialog';
import { addressKind, connTone, maskToken } from '@/features/fleet/status';
import { formatTime, useT } from '@/i18n';
import { ScreenHeader } from '@/shell/ScreenHeader';
import { conductor, useFleet } from '@/state/hooks';
import { Banner, Button, ButtonRow, Card, Dialog, EmptyState, IconButton, KeyValue, MenuButton, StatusLabel, Txt, useToast } from '@/ui/components';
import { Icon } from '@/ui/icons';
import { useLayoutMode } from '@/ui/layout';

export default function Machines() {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const mode = useLayoutMode();
  const params = useLocalSearchParams<{ add?: string }>();
  const machines = useFleet((state) => state.machines);
  const runtimes = useFleet((state) => state.runtimes);
  const tokens = useFleet((state) => state.tokens);
  const lists = useFleet((state) => state.projectLists);
  const runs = useFleet((state) => state.runs);
  const [editing, setEditing] = useState<MachineConfig | undefined>();
  const [dialog, setDialog] = useState(false);
  const [removing, setRemoving] = useState<MachineConfig | undefined>();

  useEffect(() => {
    if (params.add) {
      setEditing(undefined);
      setDialog(true);
      router.setParams({ add: undefined });
    }
  }, [params.add, router]);

  const open = (machine?: MachineConfig) => {
    setEditing(machine);
    setDialog(true);
  };

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader
        crumbs={[t('machines.title')]}
        icon="machine"
        phoneActions={<IconButton icon="plus" accessibilityLabel={t('machines.add')} onPress={() => open()} />}
        actions={
          <>
            <IconButton icon="refresh" size="header" accessibilityLabel={t('common.refresh')} onPress={() => void conductor.refreshAll()} />
            <Button variant="secondary" compact icon="plus" label={t('machines.add')} onPress={() => open()} />
          </>
        }
      />
      <ScrollView contentContainerStyle={{ padding: mode === 'phone' ? 16 : 27, gap: 14, maxWidth: 980, width: '100%', alignSelf: 'center' }}>
        <Txt variant="body" tone="muted" style={{ marginBottom: 6 }}>
          {t('machines.subtitle')}
        </Txt>
        {!machines.length ? (
          <EmptyState icon="machine" title={t('home.noMachines')} text={t('machines.empty')} actionLabel={t('machines.add')} actionPrimary onAction={() => open()} />
        ) : null}
        {machines.map((machine) => {
          const runtime = runtimes[machine.key];
          const state = runtime?.state ?? 'unknown';
          const kind = addressKind(machine.baseUrl);
          const active = Object.values(runs).filter((live) => live.machineKey === machine.key && (live.run.status === 'running' || live.run.status === 'stopping')).length;
          const sync = runtime?.sync;
          const items = [
            { label: t('machines.version'), value: runtime?.info?.studioVersion ?? '·', mono: true },
            { label: t('machines.syncR2'), value: sync ? (sync.configured ? (sync.lastSync ? t('sync.lastSync', { time: formatTime(t.lang, sync.lastSync.at) }) : t('machines.syncOn')) : t('machines.syncOff')) : '·' },
            { label: t('machines.projectsCount'), value: String(lists[machine.key]?.length ?? '·') },
            { label: t('machines.runsCount'), value: String(active) },
            { label: t('machines.tokenShort'), value: maskToken(tokens[machine.key]) || '·', mono: true },
          ];
          const errorKey = runtime?.error && state !== 'online' ? runtime.error : null;
          return (
            <Card key={machine.key} identityColor={machine.color} style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Icon name="machine" size={16} color={machine.color} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt variant="heading" numberOfLines={1}>
                    {machine.label}
                  </Txt>
                  <Txt variant="caption" tone="muted" numberOfLines={1}>
                    {`${t(`machines.kind.${kind}`)} · `}
                    <Txt variant="mono" tone="muted" style={{ fontSize: 10 }}>
                      {machine.baseUrl.replace(/^https?:\/\//, '')}
                    </Txt>
                  </Txt>
                </View>
                <StatusLabel
                  tone={connTone(state)}
                  label={state === 'offline' && runtime?.lastSeenAt ? `${t('conn.offline')} · ${t('conn.lastSeen', { time: formatTime(t.lang, runtime.lastSeenAt) })}` : t(`conn.${state}`)}
                />
                <MenuButton
                  accessibilityLabel={t('common.more')}
                  align="end"
                  renderTrigger={() => <IconButton icon="more" accessibilityLabel={t('common.more')} />}
                  items={[
                    { key: 'edit', label: t('machines.edit'), icon: 'pencil', onPress: () => open(machine) },
                    { key: 'test', label: t('machines.test'), icon: 'refresh', onPress: () => void conductor.refreshMachine(machine.key) },
                    { divider: true },
                    { key: 'remove', label: t('machines.remove'), icon: 'trash', danger: true, onPress: () => setRemoving(machine) },
                  ]}
                />
              </View>
              <KeyValue items={items} />
              {errorKey ? <Banner tone={state === 'offline' ? 'quiet' : 'error'} icon={state === 'offline' ? 'wifi-off' : undefined} text={t(errorKey)} actionLabel={t('common.retry')} onAction={() => void conductor.refreshMachine(machine.key)} /> : null}
              {runtime?.missingScopes?.length ? <Banner tone="warning" text={t('machines.missingScopes', { scopes: runtime.missingScopes.join(', ') })} /> : null}
            </Card>
          );
        })}
      </ScrollView>
      <MachineDialog visible={dialog} machine={editing} onClose={() => setDialog(false)} />
      <Dialog
        visible={!!removing}
        onClose={() => setRemoving(undefined)}
        icon="trash"
        title={t('machines.removeTitle', { machine: removing?.label ?? '' })}
        description={t('machines.removeText')}
        actions={
          <ButtonRow align="end">
            <Button variant="secondary" label={t('common.cancel')} onPress={() => setRemoving(undefined)} />
            <Button
              variant="danger"
              label={t('machines.removeConfirm')}
              onPress={() => {
                if (removing) conductor.removeMachine(removing.key);
                setRemoving(undefined);
                toast.show({ text: t('machines.removed'), tone: 'success' });
              }}
            />
          </ButtonRow>
        }
      />
    </View>
  );
}
