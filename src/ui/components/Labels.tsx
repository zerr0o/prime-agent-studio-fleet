import { View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '../icons';
import { fontSize, radius, weight } from '../theme';
import { useTheme } from '../theme-context';
import { alpha, fw } from './interaction';
import { Txt } from './Txt';

/** Shortcut hint written "Ctrl N". */
export function Kbd({ label, tint }: { label: string; tint?: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      accessible={false}
      style={{ borderWidth: 1, borderColor: tint ? alpha(colors.accentText, 0.19) : colors.line, borderRadius: radius.xs, paddingVertical: 2, paddingHorizontal: 4 }}
    >
      <Txt variant="micro" style={{ color: tint ? colors.muted : colors.faint, lineHeight: 11 }} numberOfLines={1}>
        {label}
      </Txt>
    </View>
  );
}

/** Uppercase 8 px pill ("LOCAL"). */
export function Tag({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.xs, paddingVertical: 4, paddingHorizontal: 6, alignSelf: 'center' }}>
      <Txt variant="micro" style={{ fontSize: 8, fontWeight: fw(weight.bold), letterSpacing: 1, textTransform: 'uppercase', color: colors.muted, lineHeight: 10 }} numberOfLines={1}>
        {label}
      </Txt>
    </View>
  );
}

/** Rounded badge. accent: news ("Update available"). solid: "This address", "Read-only". */
export function Badge({ label, variant = 'accent', icon }: { label: string; variant?: 'accent' | 'solid'; icon?: IconName }) {
  const { colors } = useTheme();
  const solid = variant === 'solid';
  const fg = solid ? colors.accentText : colors.accent;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        alignSelf: 'flex-start',
        paddingVertical: solid ? 1 : 3,
        paddingHorizontal: 8,
        borderRadius: radius.full,
        borderWidth: 1,
        borderColor: solid ? 'transparent' : alpha(colors.accent, 0.45),
        backgroundColor: solid ? colors.accentBg : alpha(colors.accent, 0.14),
      }}
    >
      {icon ? <Icon name={icon} size={12} color={fg} /> : null}
      <Txt variant="caption" numberOfLines={1} style={{ color: fg, fontSize: solid ? fontSize.meta : fontSize.caption, fontWeight: fw(solid ? weight.bold : weight.regular), lineHeight: solid ? 18 : 14 }}>
        {label}
      </Txt>
    </View>
  );
}

/** 10 px tabular number pushed to the right of a row. */
export function Count({ value, style }: { value: number | string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ marginLeft: 'auto', flexShrink: 0 }, style]}>
      <Txt variant="caption" style={{ fontVariant: ['tabular-nums'] }}>
        {value}
      </Txt>
    </View>
  );
}

/** 1 px line. soft = structural separator (lineSoft). */
export function Divider({ soft, vertical, inset = 0, style }: { soft?: boolean; vertical?: boolean; inset?: number; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const color = soft ? colors.lineSoft : colors.line;
  return (
    <View
      accessible={false}
      style={[
        vertical ? { width: 1, alignSelf: 'stretch', marginVertical: inset } : { height: 1, alignSelf: 'stretch', marginHorizontal: inset },
        { backgroundColor: color },
        style,
      ]}
    />
  );
}
