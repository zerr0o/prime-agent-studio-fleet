// One run: live events, agent questions, transcript, follow-up messages, stop.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { isRunActive, type MessageItem } from '@/api/types';
import { readTask } from '@/domain/pipeline';
import { runTone } from '@/features/fleet/status';
import { formatDuration, formatTime, useT } from '@/i18n';
import { ScreenHeader } from '@/shell/ScreenHeader';
import { conductor, useFleet } from '@/state/hooks';
import { projectByKey } from '@/state/store';
import { Banner, Button, ButtonRow, Dialog, EmptyState, Segmented, StatusLabel, TextField, Txt, useToast } from '@/ui/components';
import { Icon } from '@/ui/icons';
import { useLayoutMode } from '@/ui/layout';
import { useTheme } from '@/ui/theme-context';
import { Prose } from './Prose';
import { QuestionCard } from './QuestionCard';

function Message({ message }: { message: MessageItem }) {
  const t = useT();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const text = message.text ?? '';
  const long = text.length > 700;
  if (message.role === 'user')
    return (
      <View style={{ alignSelf: 'flex-end', maxWidth: '88%', gap: 6 }}>
        <Txt variant="uiStrong" style={{ alignSelf: 'flex-end' }}>
          {t('run.you')}
        </Txt>
        <Pressable
          disabled={!long}
          onPress={() => setOpen((value) => !value)}
          accessibilityRole={long ? 'button' : undefined}
          style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft, borderRadius: 12, borderTopLeftRadius: 3, paddingVertical: 15, paddingHorizontal: 18, gap: 8 }}
        >
          <Txt variant="ui" selectable style={{ lineHeight: 19 }}>
            {long && !open ? `${text.slice(0, 600).trimEnd()}…` : text.slice(0, 20000)}
          </Txt>
          {long ? (
            <Txt variant="meta" tone="accentText">
              {open ? t('run.showLess') : t('run.showMore')}
            </Txt>
          ) : null}
        </Pressable>
      </View>
    );
  if (message.role !== 'assistant' || !(message.text || message.tools?.length || message.error)) return null;
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        <View style={{ width: 25, height: 25, borderRadius: 7, backgroundColor: colors.accentBg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="sparkles" size={14} color={colors.accent} />
        </View>
        <Txt variant="uiStrong">{t('run.agent')}</Txt>
        {message.model ? (
          <Txt variant="micro" style={{ fontFamily: undefined }}>
            {message.model}
          </Txt>
        ) : null}
        <View style={{ flex: 1 }} />
        <Txt variant="micro">{formatTime(t.lang, message.timestamp)}</Txt>
      </View>
      <View style={{ paddingLeft: 34, gap: 8 }}>
        {message.tools?.length ? (
          <Txt variant="meta">{`${t('run.agentActivity')} · ${t('run.tools', { count: message.tools.length })}`}</Txt>
        ) : null}
        {message.text ? <Prose text={message.text} /> : null}
        {message.error ? (
          <Txt variant="meta" tone="red">
            {message.error}
          </Txt>
        ) : null}
      </View>
    </View>
  );
}

export function RunView({ runKey }: { runKey: string }) {
  const t = useT();
  const toast = useToast();
  const mode = useLayoutMode();
  const { colors } = useTheme();
  const live = useFleet((state) => state.runs[runKey]);
  const machines = useFleet((state) => state.machines);
  const projects = useFleet((state) => state.projects);
  const pipelines = useFleet((state) => state.pipelines);
  const copies = useFleet((state) => state.copies);
  const titles = useFleet((state) => state.sessionTitles);
  const [message, setMessage] = useState('');
  const [modeSend, setModeSend] = useState<'follow_up' | 'steer'>('follow_up');
  const [stopping, setStopping] = useState(false);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const scroller = useRef<ScrollView>(null);
  const active = live ? isRunActive(live.run.status) : false;

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  // The persisted conversation gives the prompt and earlier turns; live events merge into it.
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    const sessionId = live?.run.sessionId;
    if (!sessionId || loadedFor.current === `${runKey}|${sessionId}`) return;
    loadedFor.current = `${runKey}|${sessionId}`;
    setLoading(!live?.messages.length);
    void conductor
      .loadHistory(runKey)
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey, live?.run.sessionId]);

  const machine = live ? machines.find((m) => m.key === live.machineKey) : undefined;
  const project = live?.projectKey ? projectByKey({ projects } as never, live.projectKey) : undefined;
  const title = useMemo(() => {
    if (!live) return '';
    if (live.projectKey && live.nodeId) {
      const node = pipelines[live.projectKey]?.nodes.find((n) => n.id === live.nodeId);
      if (node) return readTask(node.ref, copies[live.projectKey] ?? {}).task.title;
    }
    return (live.run.sessionId && titles[live.run.sessionId]) || t('run.label', { time: formatTime(t.lang, live.run.startedAt) });
  }, [live, pipelines, copies, titles, t]);
  useEffect(() => {
    if (live?.projectKey && live.run.sessionId && !titles[live.run.sessionId]) void conductor.loadSessions(live.projectKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live?.projectKey, live?.run.sessionId]);

  if (!live)
    return (
      <View style={{ flex: 1 }}>
        <ScreenHeader crumbs={[t('tab.runs')]} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <EmptyState icon="session" title={t('tab.runs')} text={t('run.notFound')} />
        </View>
      </View>
    );

  const status = live.run.status;
  const statusKey = ['running', 'stopping', 'completed', 'failed', 'stopped'].includes(status) ? status : 'unknown';
  const started = Date.parse(live.run.startedAt);
  const ended = live.run.endedAt ? Date.parse(live.run.endedAt) : now;
  const pending = (live.run.interactions ?? []).filter((i) => i.status === 'pending');
  const phone = mode === 'phone';

  const send = async () => {
    const text = message.trim();
    if (!text) return;
    try {
      await conductor.sendMessage(runKey, text, modeSend);
      setMessage('');
    } catch {
      toast.show({ text: t('error.unknown'), tone: 'error' });
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader
        crumbs={[machine?.label ?? '', project?.name ?? '', title]}
        icon="machine"
        iconColor={machine?.color}
        actions={active ? <Button variant="secondary" compact icon="stop" label={t('run.stop')} onPress={() => setStopping(true)} /> : undefined}
      />
      <ScrollView ref={scroller} onContentSizeChange={() => active && scroller.current?.scrollToEnd({ animated: false })} contentContainerStyle={{ padding: phone ? 16 : 31, paddingHorizontal: phone ? 16 : 39, gap: 24, maxWidth: 880, width: '100%', alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
          <StatusLabel tone={runTone(status)} label={t(`run.status.${statusKey}`)} />
          <Txt variant="caption">{t('run.started', { time: formatTime(t.lang, live.run.startedAt) })}</Txt>
          {Number.isFinite(started) ? <Txt variant="caption">{t('run.duration', { value: formatDuration(ended - started) })}</Txt> : null}
          {live.run.model ? (
            <Txt variant="micro" style={{ fontFamily: undefined }}>
              {live.run.model}
            </Txt>
          ) : null}
        </View>
        {live.streamError && active ? <Banner tone="quiet" icon="wifi-off" text={t(live.streamError.key)} /> : null}
        {live.run.error ? <Banner tone="error" text={live.run.error} /> : null}
        {loading ? <Txt variant="meta">{t('common.loading')}</Txt> : null}
        {live.messages.map((item, index) => (
          <Message key={item.id ?? index} message={item} />
        ))}
        {live.text ? (
          <View style={{ paddingLeft: 34 }}>
            <Prose text={live.text} />
          </View>
        ) : null}
        {active && live.tools.length ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 34 }}>
            <Icon name="tool" size={14} color={colors.muted} />
            <Txt variant="meta">{`${t('run.agentActivity')} · ${t('run.tools', { count: live.tools.length })} · ${live.tools[live.tools.length - 1]?.name ?? ''}`}</Txt>
          </View>
        ) : null}
        {pending.map((interaction) => (
          <QuestionCard key={interaction.id} interaction={interaction} onAnswer={(response) => conductor.answer(runKey, interaction.id, response)} />
        ))}
        {live.statusNote && active ? <Txt variant="meta" tone="amber">{`${t('run.retrying')} ${live.statusNote === 'retrying' ? '' : live.statusNote}`.trim()}</Txt> : null}
      </ScrollView>
      {active && live.run.sessionId && !pending.length ? (
        <View style={{ paddingHorizontal: phone ? 14 : 32, paddingBottom: phone ? 14 : 22, paddingTop: 8, maxWidth: 940, width: '100%', alignSelf: 'center' }}>
          <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.composerLine, borderRadius: 13, padding: 14, gap: 10 }}>
            <TextField value={message} onChangeText={setMessage} placeholder={t('run.composerPlaceholder')} multiline minHeight={51} fill="surface" />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 240 }}>
                <Segmented
                  value={modeSend}
                  onChange={(value) => setModeSend(value as 'follow_up' | 'steer')}
                  options={[
                    { key: 'follow_up', label: t('run.followUp') },
                    { key: 'steer', label: t('run.steer') },
                  ]}
                />
              </View>
              <View style={{ flex: 1 }} />
              <Button variant="primary" icon="arrow-up" label={t('run.send', { machine: machine?.label ?? '' })} disabled={!message.trim()} onPress={() => void send()} />
            </View>
          </View>
        </View>
      ) : null}
      <Dialog
        visible={stopping}
        onClose={() => setStopping(false)}
        icon="stop"
        title={t('run.stopConfirmTitle')}
        description={t('run.stopConfirmText', { machine: machine?.label ?? '' })}
        actions={
          <ButtonRow align="end">
            <Button variant="secondary" label={t('common.cancel')} onPress={() => setStopping(false)} />
            <Button
              variant="danger"
              label={t('run.stopConfirm')}
              onPress={() => {
                setStopping(false);
                void conductor.stopRun(runKey);
              }}
            />
          </ButtonRow>
        }
      />
    </View>
  );
}

