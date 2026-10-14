// Assignment of a Roadmap task to a machine of the project (stored in the app pipeline).
import { View } from 'react-native';

import { nodeIdFor, removeNode, assignTask } from '@/domain/pipeline';
import type { FleetProject, NodeState, TaskRef } from '@/domain/types';
import { useT } from '@/i18n';
import { conductor, useFleet } from '@/state/hooks';
import { Button, MenuButton, Txt, type MenuItem } from '@/ui/components';
import { useTheme } from '@/ui/theme-context';

export function AssignMenu({ project, refTask, machineId, state, compact }: { project: FleetProject; refTask: TaskRef; machineId: string | null | undefined; state?: NodeState; compact?: boolean }) {
  const t = useT();
  const { colors } = useTheme();
  const machines = useFleet((s) => s.machines);
  const runtimes = useFleet((s) => s.runtimes);
  const inPipeline = state !== undefined;
  const assigned = machineId ? machines.find((m) => (m.machineId ?? runtimes[m.key]?.info?.machineId) === machineId) : undefined;
  const members = new Set(project.members.map((m) => m.machineId));

  const items: MenuItem[] = [
    { label: t('roadmap.assignTo'), section: true },
    ...machines.map((machine) => {
      const id = machine.machineId ?? runtimes[machine.key]?.info?.machineId;
      const hasProject = !!id && members.has(id);
      return {
        key: machine.key,
        label: machine.label,
        color: machine.color,
        checked: !!id && id === machineId,
        disabled: !hasProject,
        detail: hasProject ? undefined : t('roadmap.notOnMachine'),
        onPress: () => id && conductor.editPipeline(project.key, (p, now) => assignTask(p, refTask, id, now)),
      };
    }),
  ];
  if (inPipeline) {
    items.push({ divider: true });
    if (machineId) items.push({ key: 'unassign', label: t('roadmap.unassign'), icon: 'unlink', onPress: () => conductor.editPipeline(project.key, (p, now) => assignTask(p, refTask, null, now)) });
    items.push({ key: 'remove', label: t('roadmap.removeFromPipeline'), icon: 'trash', danger: true, onPress: () => conductor.editPipeline(project.key, (p, now) => removeNode(p, nodeIdFor(refTask), now)) });
  }

  return (
    <MenuButton
      accessibilityLabel={assigned ? `${t('roadmap.assignTo')} · ${assigned.label}` : t('roadmap.assign')}
      align="end"
      sheetTitle={t('roadmap.assignTo')}
      items={items}
      renderTrigger={() =>
        assigned || inPipeline ? (
          // One identity mark (the machine color), the machine name. State lives on the pipeline.
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 9, minHeight: compact ? 28 : 26, borderRadius: 7, borderWidth: 1, borderColor: colors.line, maxWidth: compact ? 170 : 190, alignSelf: 'flex-start' }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: assigned?.color ?? 'transparent', borderWidth: assigned ? 0 : 1, borderColor: colors.faint }} />
            <Txt variant="meta" tone={assigned ? 'text' : 'muted'} numberOfLines={1} style={{ flexShrink: 1, fontWeight: '500' }}>
              {assigned?.label ?? t('state.unassigned')}
            </Txt>
          </View>
        ) : (
          <Button variant="text" icon="plus" label={t('roadmap.assign')} />
        )
      }
    />
  );
}
