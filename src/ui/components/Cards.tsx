import type { ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius } from '../theme';
import { useTheme } from '../theme-context';
import { focusRing, usePressState, webTransition } from './interaction';
import { Txt } from './Txt';

export type CardProps = {
  children: ReactNode;
  /** Makes the card pressable: accent border on hover and focus. */
  onPress?: () => void;
  /** Identity color (machine, plan): drawn as a 3 px left border only. */
  identityColor?: string;
  padding?: number;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function Card({ children, onPress, identityColor, padding = 13, accessibilityLabel, style, testID }: CardProps) {
  const { colors } = useTheme();
  const { hovered, focused, handlers } = usePressState();
  const frame: ViewStyle = {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: onPress && (hovered || focused) ? colors.accent : colors.line,
    borderLeftWidth: identityColor ? 3 : 1,
    borderLeftColor: identityColor ?? (onPress && (hovered || focused) ? colors.accent : colors.line),
    borderRadius: radius.card,
    padding,
  };
  if (!onPress) {
    return (
      <View style={[frame, style]} testID={testID}>
        {children}
      </View>
    );
  }
  return (
    <Pressable
      {...handlers}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={({ pressed }) => [frame, { gap: 7 }, webTransition, pressed ? { backgroundColor: colors.surfaceHover } : null, focusRing(colors, focused), style]}
    >
      {children}
    </Pressable>
  );
}

export type KeyValueItem = { label: string; value: string | number | ReactNode; mono?: boolean };

/** Key and value list like .ps-kv: muted keys left, values right with tabular numbers. */
export function KeyValue({ items, framed, style }: { items: KeyValueItem[]; framed?: boolean; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        { gap: framed ? 15 : 12 },
        framed ? { padding: 20, borderWidth: 1, borderColor: colors.line, borderRadius: radius.menu, backgroundColor: colors.surface } : null,
        style,
      ]}
    >
      {items.map((it) => (
        <View key={it.label} style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24 }}>
          <View style={{ flexShrink: 0 }}>
            <Txt variant="ui" tone="muted">
              {it.label}
            </Txt>
          </View>
          <View style={{ flex: 1, alignItems: 'flex-end', minWidth: 0 }}>
            {typeof it.value === 'string' || typeof it.value === 'number' ? (
              <Txt variant={it.mono ? 'mono' : 'ui'} style={{ textAlign: 'right', fontVariant: ['tabular-nums'] }} selectable>
                {it.value}
              </Txt>
            ) : (
              it.value
            )}
          </View>
        </View>
      ))}
    </View>
  );
}
