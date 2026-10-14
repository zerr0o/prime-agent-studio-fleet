// Instructions injected in every task of the pipeline: Roadmap check (always), Git handoff, extra text.
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { composeInstructions, DEFAULT_GIT_TEXT } from '@/domain/instructions';
import type { Pipeline } from '@/domain/types';
import { useT } from '@/i18n';
import { conductor, useFleet } from '@/state/hooks';
import { Button, ButtonRow, Dialog, Divider, Segmented, Switch, TextField, Txt } from '@/ui/components';
import { useTheme } from '@/ui/theme-context';
import { fonts } from '@/ui/theme';

export function InstructionsDialog({ visible, onClose, projectKey, pipeline }: { visible: boolean; onClose(): void; projectKey: string; pipeline: Pipeline }) {
  const t = useT();
  const { colors } = useTheme();
  // The preview names a real machine of the pipeline when there is one.
  const sampleMachine = useFleet((state) => {
    const machineId = pipeline.nodes.find((node) => node.machineId)?.machineId;
    return state.machines.find((m) => (m.machineId ?? state.runtimes[m.key]?.info?.machineId) === machineId)?.label ?? '…';
  });
  const [git, setGit] = useState(pipeline.git);
  const [extra, setExtra] = useState(pipeline.extra);
  const [conversation, setConversation] = useState<'new' | 'continue'>(pipeline.conversation ?? 'new');
  useEffect(() => {
    if (visible) {
      setGit(pipeline.git);
      setExtra(pipeline.extra);
      setConversation(pipeline.conversation ?? 'new');
    }
  }, [visible, pipeline]);

  const preview = composeInstructions({
    language: t.lang,
    pipeline: { git, extra },
    ref: { kind: 'step', planId: 'plan-…', stepId: 'step-…' },
    taskTitle: '…',
    machineLabel: sampleMachine,
    doneDeps: [],
  });

  return (
    <Dialog
      visible={visible}
      onClose={onClose}
      icon="settings"
      width={560}
      title={t('pipeline.settingsTitle')}
      description={t('pipeline.settingsDesc')}
      closeLabel={t('common.close')}
      actions={
        <ButtonRow align="end">
          <Button variant="secondary" label={t('common.cancel')} onPress={onClose} />
          <Button
            variant="primary"
            label={t('pipeline.save')}
            onPress={() => {
              conductor.editPipeline(projectKey, (p, now) => ({ ...p, git, extra, conversation, updatedAt: now }));
              onClose();
            }}
          />
        </ButtonRow>
      }
    >
      <View style={{ gap: 14 }}>
        <View style={{ gap: 8 }}>
          <Txt variant="uiStrong">{t('pipeline.conversation')}</Txt>
          <Segmented
            value={conversation}
            onChange={(value) => setConversation(value as 'new' | 'continue')}
            options={[
              { key: 'new', label: t('pipeline.conversationNew') },
              { key: 'continue', label: t('pipeline.conversationContinue') },
            ]}
          />
          <Txt variant="meta" style={{ lineHeight: 17 }}>
            {t('pipeline.conversationHelp')}
          </Txt>
        </View>
        <Divider />
        <Txt variant="uiStrong">{t('pipeline.instructionsSection')}</Txt>
        <Txt variant="meta">{t('pipeline.checkRule')}</Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="uiStrong">{t('pipeline.gitRule')}</Txt>
            <Txt variant="meta">{t('pipeline.gitHelp')}</Txt>
          </View>
          <Switch value={git.enabled} onValueChange={(enabled) => setGit((g) => ({ ...g, enabled, text: g.text || DEFAULT_GIT_TEXT[t.lang] }))} accessibilityLabel={t('pipeline.gitRule')} />
        </View>
        {git.enabled ? <TextField value={git.text} onChangeText={(text) => setGit((g) => ({ ...g, text }))} multiline minHeight={84} fill="bg" /> : null}
        <TextField label={t('pipeline.extra')} value={extra} onChangeText={setExtra} placeholder={t('pipeline.extraPlaceholder')} multiline minHeight={64} fill="bg" />
        <View style={{ gap: 6 }}>
          <Txt variant="groupLabel">{t('pipeline.preview')}</Txt>
          <View style={{ backgroundColor: colors.code, borderWidth: 1, borderColor: colors.line, borderRadius: 9, padding: 12 }}>
            <Txt variant="mono" tone="muted" style={{ fontFamily: fonts.mono, fontSize: 10.5, lineHeight: 17 }} selectable>
              {preview}
            </Txt>
          </View>
        </View>
      </View>
    </Dialog>
  );
}
