import type { ReactNode } from 'react';
import { Pressable, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '../icons';
import { isTouch } from '../layout';
import { fontSize, layout, radius } from '../theme';
import { useTheme } from '../theme-context';
import { focusRing, touchSlop, usePressState, webTransition } from './interaction';
import { Txt } from './Txt';

export type TabItem = {
  key: string;
  label: string;
  icon?: IconName;
  iconColor?: string;
  count?: number | string;
  accessibilityLabel?: string;
};

type TabsProps = {
  tabs: TabItem[];
  activeKey: string;
  onChange: (key: string) => void;
};

function IdeTab({ tab, active, onPress, maxWidth }: { tab: TabItem; active: boolean; onPress: () => void; maxWidth: number }) {
  const { colors } = useTheme();
  const { hovered, focused, handlers } = usePressState();
  return (
    <Pressable
      {...handlers}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityLabel={tab.accessibilityLabel ?? tab.label}
      accessibilityState={{ selected: active }}
      hitSlop={touchSlop(layout.tabbarHeight)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        maxWidth,
        paddingTop: 10,
        paddingBottom: 9,
        paddingHorizontal: 13,
        backgroundColor: active ? colors.bg : hovered ? colors.surfaceHover : 'transparent',
        ...webTransition,
        ...focusRing(colors, focused, -2),
      }}
    >
      {active ? (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 12, right: 12, height: 2, backgroundColor: colors.accent, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 }}
        />
      ) : null}
      {tab.icon ? <Icon name={tab.icon} size={14} color={tab.iconColor ?? (active || hovered ? colors.text : colors.muted)} /> : null}
      <View style={{ flexShrink: 1, minWidth: 0 }}>
        <Txt variant="meta" numberOfLines={1} style={{ color: active || hovered ? colors.text : colors.muted, lineHeight: 15 }}>
          {tab.label}
        </Txt>
      </View>
      {tab.count != null ? (
        <Txt variant="caption" style={{ fontVariant: ['tabular-nums'] }}>
          {tab.count}
        </Txt>
      ) : null}
    </Pressable>
  );
}

/** IDE tabs on the sidebar color, 35 px. Active tab merges with the pane and has a 2 px accent line on top. */
export function TabBar({ tabs, activeKey, onChange, trailing, maxTabWidth = 240, style }: TabsProps & { trailing?: ReactNode; maxTabWidth?: number; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={[{ flexDirection: 'row', alignItems: 'center', minHeight: layout.tabbarHeight, paddingRight: 4, gap: 2, backgroundColor: colors.sidebar, borderBottomWidth: 1, borderBottomColor: colors.line }, style]}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'stretch' }}>
        {tabs.map((t) => (
          <IdeTab key={t.key} tab={t} active={t.key === activeKey} onPress={() => onChange(t.key)} maxWidth={maxTabWidth} />
        ))}
      </ScrollView>
      {trailing ? <View style={{ flexDirection: 'row', alignItems: 'center' }}>{trailing}</View> : null}
    </View>
  );
}

function UnderlineTab({ tab, active, onPress }: { tab: TabItem; active: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const { hovered, focused, handlers } = usePressState();
  return (
    <Pressable
      {...handlers}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityLabel={tab.accessibilityLabel ?? tab.label}
      accessibilityState={{ selected: active }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: isTouch ? 14 : 12,
        borderBottomWidth: 2,
        borderBottomColor: active ? colors.accent : 'transparent',
        marginBottom: -1,
        ...focusRing(colors, focused, -2),
      }}
    >
      <Txt variant="heading" style={{ fontWeight: '400', color: active || hovered ? colors.text : colors.muted }} numberOfLines={1}>
        {tab.label}
      </Txt>
      {tab.count != null ? (
        <Txt variant="meta" style={{ fontVariant: ['tabular-nums'] }}>
          ({tab.count})
        </Txt>
      ) : null}
    </Pressable>
  );
}

/** Views inside a panel ("Project / Session / Backlog"): 14 px text, 2 px accent underline. */
export function UnderlineTabs({ tabs, activeKey, onChange, paddingHorizontal = 24, style }: TabsProps & { paddingHorizontal?: number; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View style={[{ borderBottomWidth: 1, borderBottomColor: colors.line }, style]} accessibilityRole="tablist">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 25, paddingHorizontal }}>
        {tabs.map((t) => (
          <UnderlineTab key={t.key} tab={t} active={t.key === activeKey} onPress={() => onChange(t.key)} />
        ))}
      </ScrollView>
    </View>
  );
}

function PillTab({ tab, active, onPress }: { tab: TabItem; active: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const { hovered, focused, handlers } = usePressState();
  return (
    <Pressable
      {...handlers}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityLabel={tab.accessibilityLabel ?? tab.label}
      accessibilityState={{ selected: active }}
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: isTouch ? layout.touchTarget : 40,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        borderRadius: radius.pillButton,
        backgroundColor: active ? colors.accentBg : hovered ? colors.surfaceHover : 'transparent',
        ...webTransition,
        ...focusRing(colors, focused, -2),
      }}
    >
      {tab.icon ? <Icon name={tab.icon} size={14} color={active ? colors.text : colors.muted} /> : null}
      <Txt variant="ui" numberOfLines={1} style={{ color: active ? colors.text : hovered ? colors.text : colors.muted, flexShrink: 1, fontSize: fontSize.ui }}>
        {tab.label}
      </Txt>
      {tab.count != null ? (
        <Txt variant="caption" style={{ fontVariant: ['tabular-nums'] }}>
          {tab.count}
        </Txt>
      ) : null}
    </Pressable>
  );
}

/** Equal pills for sub-panels in a narrow column ("Session / Agents / Files"). */
export function PillTabs({ tabs, activeKey, onChange, style }: TabsProps & { style?: StyleProp<ViewStyle> }) {
  return (
    <View accessibilityRole="tablist" style={[{ flexDirection: 'row', gap: 3 }, style]}>
      {tabs.map((t) => (
        <PillTab key={t.key} tab={t} active={t.key === activeKey} onPress={() => onChange(t.key)} />
      ))}
    </View>
  );
}
