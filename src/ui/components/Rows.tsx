import type { ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '../icons';
import { isTouch, useLayoutMode } from '../layout';
import { fontSize, layout, radius } from '../theme';
import { useTheme } from '../theme-context';
import { focusRing, touchSlop, usePressState, useInert, webTransition } from './interaction';
import { Txt } from './Txt';

type RowBase = {
  label: string;
  onPress?: () => void;
  onLongPress?: () => void;
  active?: boolean;
  /** Leading icon (15 px). */
  icon?: IconName;
  /** Identity color: tints the icon and fills a folder. */
  iconColor?: string;
  fillIcon?: boolean;
  /** Leading 10 px identity dot instead of an icon. */
  dotColor?: string;
  /** Trailing slot: Dot, Count, IconButton... */
  trailing?: ReactNode;
  /** Left indent in px (children of a project: 33). */
  indent?: number;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

function useRowSize() {
  const mode = useLayoutMode();
  return { font: mode === 'phone' ? fontSize.body : fontSize.ui, minHeight: isTouch ? layout.touchTarget : layout.rowHeight };
}

/** Project or item row (.ps-row): 38 px, radius 6, 12 px muted, hover surface. */
export function Row({ label, onPress, onLongPress, active, icon, iconColor, fillIcon, dotColor, trailing, indent = 0, accessibilityLabel, style, testID }: RowBase) {
  const { colors } = useTheme();
  const { hovered, focused, handlers } = usePressState();
  const inert = useInert();
  const { font, minHeight } = useRowSize();
  const fg = active || hovered ? colors.text : colors.muted;
  return (
    <Pressable
      {...handlers}
      onPress={onPress}
      onLongPress={onLongPress}
      focusable={!inert}
      accessible={!inert}
      accessibilityRole={inert ? undefined : 'button'}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: !!active }}
      testID={testID}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          minHeight,
          paddingVertical: 8,
          paddingHorizontal: 5,
          marginLeft: indent,
          borderRadius: radius.sm,
          backgroundColor: hovered || pressed ? colors.surface : 'transparent',
          ...webTransition,
          ...focusRing(colors, focused, -2),
        },
        style,
      ]}
    >
      {dotColor ? (
        <View style={{ width: 15, alignItems: 'center' }}>
          <View style={{ width: 10, height: 10, borderRadius: 10, backgroundColor: dotColor }} />
        </View>
      ) : icon ? (
        <Icon name={icon} size={15} color={iconColor ?? colors.faint} fill={fillIcon ? iconColor : undefined} />
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="ui" numberOfLines={1} style={{ color: fg, fontSize: font }}>
          {label}
        </Txt>
      </View>
      {trailing}
    </Pressable>
  );
}

/** Conversation row under a project (.ps-subrow): active = accent background and text. */
export function SubRow({ label, onPress, onLongPress, active, icon, iconColor, dotColor, trailing, indent = 0, accessibilityLabel, style, testID }: RowBase) {
  const { colors } = useTheme();
  const { hovered, focused, handlers } = usePressState();
  const inert = useInert();
  const { font, minHeight } = useRowSize();
  const fg = active ? colors.accentText : hovered ? colors.text : colors.muted;
  return (
    <Pressable
      {...handlers}
      onPress={onPress}
      onLongPress={onLongPress}
      focusable={!inert}
      accessible={!inert}
      accessibilityRole={inert ? undefined : 'button'}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: !!active }}
      testID={testID}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 9,
          minHeight,
          marginBottom: 2,
          paddingVertical: 9,
          paddingHorizontal: 10,
          marginLeft: indent,
          borderRadius: radius.control,
          backgroundColor: active ? colors.accentBg : hovered || pressed ? colors.surface : 'transparent',
          ...webTransition,
          ...focusRing(colors, focused, -2),
        },
        style,
      ]}
    >
      {dotColor ? <View style={{ width: 8, height: 8, borderRadius: 8, backgroundColor: dotColor }} /> : null}
      {icon ? <Icon name={icon} size={14} color={iconColor ?? (active ? colors.accentText : colors.faint)} /> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="ui" numberOfLines={1} style={{ color: fg, fontSize: font, lineHeight: 17 }}>
          {label}
        </Txt>
      </View>
      {trailing}
    </Pressable>
  );
}

/** 22 px chevron button that turns 90 degrees when expanded. */
export function Disclosure({ expanded, onToggle, accessibilityLabel }: { expanded: boolean; onToggle: () => void; accessibilityLabel: string }) {
  const { colors } = useTheme();
  const { hovered, focused, handlers } = usePressState();
  return (
    <Pressable
      {...handlers}
      onPress={onToggle}
      hitSlop={touchSlop(22)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ expanded }}
      style={{ width: 22, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: radius.xs, ...focusRing(colors, focused, -2) }}
    >
      <View style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }}>
        <Icon name="chevron" size={12} color={hovered ? colors.text : colors.faint} />
      </View>
    </Pressable>
  );
}

/** Uppercase micro label with trailing actions (28 px). */
export function SectionHeader({ label, actions, paddingHorizontal = 21, style }: { label: string; actions?: ReactNode; paddingHorizontal?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 28, paddingHorizontal, paddingBottom: 8 }, style]}>
      <Txt variant="sectionLabel" accessibilityRole="header" numberOfLines={1}>
        {label}
      </Txt>
      {actions ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>{actions}</View> : null}
    </View>
  );
}
