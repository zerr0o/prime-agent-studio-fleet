// Recent activity of the conductor (runs, syncs, pipeline steps).
import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { formatTime, useT } from '@/i18n';
import { useFleet } from '@/state/hooks';
import { Dot, Txt } from '@/ui/components';

export function ActivityFeed({ projectKey, limit = 30 }: { projectKey?: string; limit?: number }) {
  const t = useT();
  const router = useRouter();
  const activity = useFleet((state) => state.activity);
  const items = (projectKey ? activity.filter((item) => item.projectKey === projectKey) : activity).slice(0, limit);
  if (!items.length)
    return (
      <Txt variant="meta" tone="faint">
        {t('activity.empty')}
      </Txt>
    );
  return (
    <View style={{ gap: 2 }}>
      {items.map((item) => (
        <Pressable
          key={item.id}
          disabled={!item.runKey}
          onPress={() => item.runKey && router.push(`/run/${encodeURIComponent(item.runKey)}` as never)}
          style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingVertical: 6 }}
        >
          <Dot kind={item.tone === 'success' ? 'connected' : item.tone === 'error' ? 'error' : item.tone === 'warning' ? 'attention' : 'idle'} style={{ marginTop: 6 }} />
          <Txt variant="ui" tone="muted" style={{ flex: 1, lineHeight: 18 }}>
            {t(item.notice.key, item.notice.params)}
          </Txt>
          <Txt variant="caption" style={{ marginTop: 2, fontVariant: ['tabular-nums'] }}>
            {formatTime(t.lang, item.at)}
          </Txt>
        </Pressable>
      ))}
    </View>
  );
}
