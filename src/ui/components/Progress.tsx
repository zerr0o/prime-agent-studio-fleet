import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '../theme-context';
import { Txt } from './Txt';

/** 4 px bar. value from 0 to 1. */
export function Progress({ value, accessibilityLabel, style }: { value: number; accessibilityLabel?: string; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const v = Math.max(0, Math.min(1, value));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(v * 100) }}
      style={[{ height: 4, borderRadius: 3, overflow: 'hidden', backgroundColor: colors.line }, style]}
    >
      <View style={{ width: `${v * 100}%`, height: 4, backgroundColor: colors.accent }} />
    </View>
  );
}

/** Muted label with a big tabular number at the right, and the bar under it when value is given. */
export function ProgressLabel({ label, stat, value, style }: { label: string; stat: string; value?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={style} accessible accessibilityLabel={`${label} ${stat}`}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: value != null ? 6 : 0 }}>
        <View style={{ flexShrink: 1 }}>
          <Txt variant="ui" tone="muted" numberOfLines={1}>
            {label}
          </Txt>
        </View>
        <Txt variant="stat">{stat}</Txt>
      </View>
      {value != null ? <Progress value={value} /> : null}
    </View>
  );
}
