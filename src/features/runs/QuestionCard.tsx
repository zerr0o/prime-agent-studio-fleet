// An agent question, inline, answered on purpose (never automatically).
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import type { Interaction, InteractionResponse } from '@/api/types';
import { useT } from '@/i18n';
import { Button, ButtonRow, Dot, TextField, Txt, useToast } from '@/ui/components';
import { useTheme } from '@/ui/theme-context';

export function QuestionCard({ interaction, onAnswer }: { interaction: Interaction; onAnswer(response: InteractionResponse): Promise<void> }) {
  const t = useT();
  const toast = useToast();
  const { colors } = useTheme();
  const [choice, setChoice] = useState<string | null>(null);
  const [text, setText] = useState(interaction.prefill ?? '');
  const [busy, setBusy] = useState(false);
  const method = interaction.method ?? 'input';
  // Studio drops its own "other answer" sentinel when a free-text answer is allowed (public/questions.js).
  const options = (interaction.options ?? []).filter((option) => !(interaction.allowCustom && option === 'Autre réponse / Other answer'));
  const freeText = method === 'input' || method === 'editor' || (method === 'select' && interaction.allowCustom);

  const send = async (response: InteractionResponse) => {
    setBusy(true);
    try {
      await onAnswer(response);
    } catch {
      toast.show({ text: t('error.unknown'), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const value = text.trim() || choice;
  return (
    // Studio question recipe: inline in the thread, aligned with the agent text, never a card.
    <View style={{ gap: 12, paddingLeft: 34 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Dot kind="attention" />
        <Txt variant="ui" tone="muted">
          {t('run.question')}
        </Txt>
      </View>
      {interaction.title ? <Txt style={{ fontSize: 16, fontWeight: '600', color: colors.text, lineHeight: 22 }}>{interaction.title}</Txt> : null}
      {interaction.message ? (
        <Txt variant="body" tone="text" selectable>
          {interaction.message}
        </Txt>
      ) : null}
      {method === 'select'
        ? options.map((option, index) => {
            const detail = interaction.optionDetails?.[(interaction.options ?? []).indexOf(option)];
            const selected = choice === option;
            return (
              <Pressable
                key={`${index}-${option}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => {
                  setChoice(option);
                  setText('');
                }}
                style={({ hovered }: { hovered?: boolean }) => ({
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  gap: 10,
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: 8,
                  backgroundColor: selected || hovered ? colors.surfaceHover : 'transparent',
                  minHeight: 44,
                })}
              >
                <View style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: selected ? colors.accent : colors.muted, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                  {selected ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent }} /> : null}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt style={{ fontSize: 14, color: colors.text }}>{detail?.label ?? option}</Txt>
                  {detail?.description ? <Txt variant="meta">{detail.description}</Txt> : null}
                </View>
              </Pressable>
            );
          })
        : null}
      {freeText ? (
        <TextField
          value={text}
          onChangeText={(next) => {
            setText(next);
            if (next) setChoice(null);
          }}
          placeholder={interaction.placeholder || t('run.answerPlaceholder')}
          multiline={method === 'editor'}
          minHeight={method === 'editor' ? 90 : undefined}
          fill="surface"
        />
      ) : null}
      {method === 'confirm' ? (
        <ButtonRow style={{ gap: 18 }}>
          <Button variant="primary" label={t('run.confirmYes')} loading={busy} onPress={() => void send({ confirmed: true })} />
          <Button variant="secondary" label={t('run.confirmNo')} disabled={busy} onPress={() => void send({ confirmed: false })} />
        </ButtonRow>
      ) : (
        <ButtonRow style={{ gap: 18 }}>
          <Button variant="primary" label={t('run.sendAnswer')} loading={busy} disabled={!value} onPress={() => value && void send({ value })} />
          <Button variant="secondary" label={t('run.skip')} disabled={busy} onPress={() => void send({ cancelled: true })} />
        </ButtonRow>
      )}
      <Txt variant="ui" tone="muted">
        {t('run.questionWaiting')}
      </Txt>
    </View>
  );
}
