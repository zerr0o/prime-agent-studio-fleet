// Adds Roadmap tasks (open steps, plans, backlog items) to the pipeline, in a chosen lane.
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';

import type { RoadmapDocument } from '@/api/types';
import { assignTask, nodeIdFor } from '@/domain/pipeline';
import { flattenSteps, visiblePlans } from '@/domain/roadmap';
import type { FleetProject, Pipeline, TaskRef } from '@/domain/types';
import { useT } from '@/i18n';
import { conductor, useFleet } from '@/state/hooks';
import { Button, ButtonRow, Checkbox, Dialog, Select, Txt } from '@/ui/components';

type Candidate = { ref: TaskRef; title: string; group: string; depth: number };

export function AddTasksDialog({ visible, onClose, project, pipeline, doc }: { visible: boolean; onClose(): void; project: FleetProject; pipeline: Pipeline | undefined; doc: RoadmapDocument | undefined }) {
  const t = useT();
  const machines = useFleet((state) => state.machines);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [lane, setLane] = useState('unassigned');
  useEffect(() => {
    if (visible) setSelected({});
  }, [visible]);

  const candidates = useMemo(() => {
    const inPipeline = new Set((pipeline?.nodes ?? []).map((node) => node.id));
    const list: Candidate[] = [];
    for (const plan of visiblePlans(doc)) {
      for (const { step, depth } of flattenSteps(plan.steps)) {
        if (step.done) continue;
        const ref: TaskRef = { kind: 'step', planId: plan.id, stepId: step.id };
        if (!inPipeline.has(nodeIdFor(ref))) list.push({ ref, title: step.text, group: plan.title, depth });
      }
    }
    for (const entry of doc?.backlog?.items ?? []) {
      if (entry.done) continue;
      const ref: TaskRef = { kind: 'backlog', number: entry.number };
      if (!inPipeline.has(nodeIdFor(ref))) list.push({ ref, title: entry.text, group: t('roadmap.backlog'), depth: 0 });
    }
    return list;
  }, [doc, pipeline, t]);
  const count = Object.values(selected).filter(Boolean).length;
  const laneOptions = [
    { value: 'unassigned', label: t('pipeline.unassignedLane') },
    ...project.members.map((member) => {
      const machine = machines.find((m) => m.key === member.machineKey);
      return { value: member.machineId, label: machine?.label ?? member.name, color: machine?.color };
    }),
  ];

  const add = () => {
    conductor.editPipeline(project.key, (p, now) => {
      let next = p;
      for (const candidate of candidates)
        if (selected[nodeIdFor(candidate.ref)]) next = assignTask(next, candidate.ref, lane === 'unassigned' ? null : lane, now);
      return next;
    });
    onClose();
  };

  let lastGroup = '';
  return (
    <Dialog
      visible={visible}
      onClose={onClose}
      icon="pipeline"
      width={560}
      title={t('pipeline.addTitle')}
      description={t('pipeline.addDesc')}
      closeLabel={t('common.close')}
      actions={
        <ButtonRow align="end">
          <Button variant="secondary" label={t('common.cancel')} onPress={onClose} />
          <Button variant="primary" label={t('pipeline.addSelected', { count })} disabled={!count} onPress={add} />
        </ButtonRow>
      }
    >
      <View style={{ gap: 12 }}>
        <Select label={t('pipeline.addTo')} value={lane} options={laneOptions} onChange={setLane} />
        <ScrollView style={{ maxHeight: 360 }}>
          {!candidates.length ? (
            <Txt variant="meta">{t('pipeline.allInPipeline')}</Txt>
          ) : (
            candidates.map((candidate) => {
              const id = nodeIdFor(candidate.ref);
              const header = candidate.group !== lastGroup ? candidate.group : null;
              lastGroup = candidate.group;
              return (
                <View key={id}>
                  {header ? (
                    <Txt variant="sectionLabel" style={{ marginTop: 12, marginBottom: 4 }}>
                      {header}
                    </Txt>
                  ) : null}
                  <View style={{ paddingLeft: candidate.depth * 18, paddingVertical: 3 }}>
                    <Checkbox checked={!!selected[id]} label={candidate.title} onChange={(value) => setSelected((s) => ({ ...s, [id]: value }))} />
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      </View>
    </Dialog>
  );
}
